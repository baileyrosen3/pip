import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { atomicJSON, command, Configuration, geminiBase, isProvider, message, object, openaiBase } from './config';
import type { Provider } from './config';
import { friendlyLiveError } from './live-provider';
export type EntryKind = 'heard' | 'asked' | 'reply' | 'report' | 'transcript';
export type Entry = { id: string; kind: EntryKind; text: string; time: number; itemID?: string; speaker?: string };
export type PendingChunk = { index: number; started: number };
export type Session = { id: string; started: number; ended?: number; entries: Entry[]; notesPath: string; pending: PendingChunk[]; provider?: Provider; recordingChunk?: PendingChunk };
export function displayEntries(session: Session) {
  const properUntil = Math.max(-Infinity, ...session.entries.filter(e => e.kind === 'transcript').map(e => e.time));
  return session.entries.filter(e => e.text && !(e.kind === 'heard' && e.time <= properUntil)).sort((a, b) => a.time - b.time);
}
const clock = (time: number) => new Date(time * 1000).toLocaleTimeString('en-US');
export function exportText(session: Session) {
  const labels: Record<EntryKind, string> = { heard: 'You', asked: 'You asked', reply: 'Pip', report: 'Research', transcript: 'Speaker' };
  return [`Pip session, ${new Date(session.started * 1000).toLocaleString('en-US')}`, '', ...displayEntries(session).map(e => `[${clock(e.time)}] ${e.kind === 'transcript' ? `Speaker ${e.speaker || '?'}` : labels[e.kind]}: ${e.text}`)].join('\n');
}
function parseSession(value: unknown, path: string): Session {
  const raw = object(value);
  if (typeof raw.id !== 'string' || typeof raw.started !== 'number' || !Array.isArray(raw.entries)) throw new Error('Invalid saved session.');
  if (raw.provider !== undefined && !isProvider(raw.provider)) throw new Error('Invalid saved session brain.');
  const entries: Entry[] = raw.entries.map(value => {
    const e = object(value);
    if (typeof e.id !== 'string' || !['heard', 'asked', 'reply', 'report', 'transcript'].includes(String(e.kind)) || typeof e.text !== 'string' || typeof e.time !== 'number') throw new Error('Invalid saved transcript entry.');
    return { id: e.id, kind: e.kind as EntryKind, text: e.text, time: e.time, ...(typeof e.itemID === 'string' ? { itemID: e.itemID } : {}), ...(typeof e.speaker === 'string' ? { speaker: e.speaker } : {}) };
  });
  const pending: PendingChunk[] = Array.isArray(raw.pending) ? raw.pending.map(value => { const p = object(value); if (typeof p.index !== 'number' || typeof p.started !== 'number') throw new Error('Invalid saved chunk.'); return { index: p.index, started: p.started }; }) : [];
  if (raw.recordingChunk) {
    const chunk = object(raw.recordingChunk);
    if (typeof chunk.index === 'number' && typeof chunk.started === 'number' && !pending.some(p => p.index === chunk.index)) pending.push({ index: chunk.index, started: chunk.started });
  }
  return { id: raw.id, started: raw.started, ended: typeof raw.ended === 'number' ? raw.ended : entries.at(-1)?.time ?? raw.started, entries, notesPath: path, pending, provider: isProvider(raw.provider) ? raw.provider : 'openai' };
}
export class Notes {
  root = '';
  sessions: Session[] = [];
  current: Session | null = null;
  onChange: () => void = () => {};
  onError: (text: string) => void = () => {};
  private rawFD: number | null = null;
  private rawPath = '';
  private chunkBytes = 0;
  private chunkIndex = 0;
  private chunkStarted = 0;
  private jobs = new Map<string, Promise<void>>();
  private notesEnabled: boolean;
  constructor(private config: Configuration) { this.notesEnabled = config.settings.notes; }
  async init() {
    let documents = join(homedir(), 'Documents');
    try { documents = (await command(['xdg-user-dir', 'DOCUMENTS'])).trim() || documents; } catch {}
    this.root = process.env.PIPCTL_NOTES_DIR || join(documents, 'Pip Notes');
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    const readme = join(this.root, 'README.md');
    if (!existsSync(readme)) writeFileSync(readme, `# Pip Notes\n\nMeeting notes recorded by Pip (the face living on your phone screen). One folder per listening session, named by start time.\n\nIn each session folder:\n- \`notes.md\`: the full transcript with timestamps and speaker labels, plus your questions to Pip, Pip's replies and any research reports, in time order. Start here.\n- \`session.json\`: the same data, structured.\n- \`audio/\`: the raw recording, as five-minute AAC chunks.\n\nSpeaker letters (A, B, …) are assigned per five-minute chunk, so the same letter can mean different people in different chunks. Lines marked "(live)" are a rough live transcript for audio that hasn't been fully transcribed yet.\n`, { mode: 0o600 });
    for (const directory of readdirSync(this.root, { withFileTypes: true })) {
      if (!directory.isDirectory()) continue;
      const path = join(this.root, directory.name);
      try {
        const session = parseSession(JSON.parse(readFileSync(join(path, 'session.json'), 'utf8')), path);
        this.sessions.push(session);
        for (const pending of session.pending) {
          const raw = join(path, 'audio', `chunk-${String(pending.index).padStart(3, '0')}.pcm`);
          const audio = raw.replace(/\.pcm$/, '.m4a');
          if (existsSync(raw) || existsSync(audio)) this.processChunk(session, pending, raw);
        }
      } catch (error) { console.error(`Pip notes: ${directory.name}: ${message(error)}`); }
    }
    this.sessions.sort((a, b) => b.started - a.started);
  }
  configure() {
    if (this.notesEnabled === this.config.settings.notes) return;
    this.notesEnabled = this.config.settings.notes;
    if (!this.notesEnabled) this.flushChunk();
    if (this.current) this.persist(this.current);
    if (!this.notesEnabled) return;
    for (const session of this.sessions) for (const pending of session.pending) {
      const raw = join(session.notesPath, 'audio', `chunk-${String(pending.index).padStart(3, '0')}.pcm`);
      if (existsSync(raw) || existsSync(raw.replace(/\.pcm$/, '.m4a'))) this.processChunk(session, pending, raw);
    }
  }
  start() {
    this.end();
    const started = Date.now() / 1000, date = new Date(started * 1000);
    const two = (n: number) => String(n).padStart(2, '0');
    const id = crypto.randomUUID();
    const path = join(this.root, `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}.${two(date.getMinutes())} ${id.slice(0, 8)}`);
    mkdirSync(path, { recursive: true, mode: 0o700 });
    const session: Session = { id, started, entries: [], notesPath: path, pending: [], provider: this.config.settings.provider };
    this.current = session; this.sessions.unshift(session); this.chunkIndex = 0;
    this.persist(session);
  }
  end() {
    const session = this.current;
    if (!session) return;
    this.flushChunk(); this.current = null;
    session.ended = Date.now() / 1000;
    session.entries = session.entries.filter(e => e.text);
    if (!session.entries.length && !session.pending.length && session.ended - session.started < 20) {
      this.sessions = this.sessions.filter(s => s !== session); rmSync(session.notesPath, { recursive: true, force: true }); this.onChange();
    } else this.persist(session);
  }
  turn(itemID: string, asked: boolean, text?: string) {
    const session = this.current;
    if (!session) return;
    let entry = session.entries.find(e => e.itemID === itemID);
    if (!entry) { entry = { id: crypto.randomUUID(), kind: asked ? 'asked' : 'heard', text: '', time: Date.now() / 1000, itemID }; session.entries.push(entry); }
    if (asked) entry.kind = 'asked';
    if (text !== undefined) entry.text = text.trim();
    this.persist(session);
  }
  add(kind: 'reply' | 'report', text: string, id?: string) {
    if (!this.current || !text.trim()) return;
    const entry = id ? this.current.entries.find(entry => entry.id === id && entry.kind === kind) : undefined;
    if (entry) entry.text = text.trim();
    else this.current.entries.push({ id: id || crypto.randomUUID(), kind, text: text.trim(), time: Date.now() / 1000 });
    this.persist(this.current);
  }
  append(audio: Uint8Array) {
    if (!this.config.settings.notes || !this.current || !audio.length) return;
    // Five minutes of PCM16 mono at 24 kHz. Stream to disk instead of retaining a session in RAM.
    const capacity = 24000 * 2 * 300;
    let offset = 0;
    while (offset < audio.length) {
      if (this.rawFD === null) {
        mkdirSync(join(this.current.notesPath, 'audio'), { recursive: true, mode: 0o700 });
        this.chunkStarted = Date.now() / 1000;
        this.rawPath = join(this.current.notesPath, 'audio', `chunk-${String(this.chunkIndex).padStart(3, '0')}.pcm`);
        this.rawFD = openSync(this.rawPath, 'w', 0o600); this.chunkBytes = 0;
        this.current.recordingChunk = { index: this.chunkIndex, started: this.chunkStarted };
        this.persist(this.current);
      }
      const count = Math.min(audio.length - offset, capacity - this.chunkBytes);
      writeSync(this.rawFD, audio, offset, count); offset += count; this.chunkBytes += count;
      if (this.chunkBytes >= capacity) this.flushChunk();
    }
  }
  private flushChunk() {
    if (this.rawFD === null || !this.current) return;
    closeSync(this.rawFD); this.rawFD = null;
    const pending = { index: this.chunkIndex++, started: this.chunkStarted };
    delete this.current.recordingChunk;
    this.current.pending.push(pending); this.persist(this.current);
    this.processChunk(this.current, pending, this.rawPath);
    this.chunkBytes = 0;
  }
  private processChunk(session: Session, pending: PendingChunk, raw: string) {
    if (!this.config.settings.notes) return;
    const id = `${session.id}:${pending.index}`;
    if (this.jobs.has(id)) return;
    const job = (async () => {
      try {
        const audio = raw.replace(/\.pcm$/, '.m4a');
        if (existsSync(raw)) {
          const temporary = `${audio}.tmp.m4a`;
          await command(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-f', 's16le', '-ar', '24000', '-ac', '1', '-i', raw, '-c:a', 'aac', '-b:a', '64k', temporary], 90_000);
          renameSync(temporary, audio); rmSync(raw);
        }
        if (!this.config.settings.notes) return;
        const provider = session.provider ?? 'openai';
        const key = this.config.key(provider);
        if (!key) throw new Error(`No ${provider === 'gemini' ? 'Gemini' : 'OpenAI'} key; recording saved for transcription after a restart with a key.`);
        let segments: { speaker: string; start: number; end: number; text: string }[] = [];
        if (provider === 'gemini') {
          const json = await this.postGemini(audio, key);
          if (!Array.isArray(json.segments)) throw new Error('Gemini transcription returned no segments.');
          for (const value of json.segments) {
            const raw = object(value);
            if (typeof raw.speaker !== 'string' || !raw.speaker.trim() || typeof raw.text !== 'string' || !raw.text.trim() || typeof raw.start !== 'number' || !Number.isFinite(raw.start) || raw.start < 0 || typeof raw.end !== 'number' || !Number.isFinite(raw.end) || raw.end < raw.start) throw new Error('Gemini transcription returned an invalid segment.');
            const part = { speaker: raw.speaker.trim(), start: raw.start, end: raw.end, text: raw.text.trim() };
            const previous = segments.at(-1);
            if (previous && previous.speaker === part.speaker && part.start - previous.end < 2.5) { previous.text += ' ' + part.text; previous.end = part.end; }
            else segments.push(part);
          }
        } else try {
          const json = await this.post(audio, key, { model: 'gpt-4o-transcribe-diarize', response_format: 'diarized_json', chunking_strategy: 'auto' });
          if (!Array.isArray(json.segments)) throw new Error('Diarized transcription returned no segments.');
          for (const value of json.segments) {
            const raw = object(value);
            if (typeof raw.text !== 'string' || !raw.text.trim()) continue;
            const part = { speaker: typeof raw.speaker === 'string' ? raw.speaker : '?', start: Number(raw.start) || 0, end: Number(raw.end) || 0, text: raw.text.trim() };
            const previous = segments.at(-1);
            if (previous && previous.speaker === part.speaker && part.start - previous.end < 2.5) { previous.text += ' ' + part.text; previous.end = part.end; }
            else segments.push(part);
          }
        } catch (error) {
          if (!this.config.settings.notes) return;
          console.error(`Pip: diarized transcription failed (${message(error)}), trying gpt-transcribe`);
          const json = await this.post(audio, key, { model: 'gpt-transcribe', response_format: 'json' });
          if (typeof json.text === 'string' && json.text.trim()) segments = [{ speaker: '?', start: 0, end: 0, text: json.text.trim() }];
        }
        for (const part of segments) session.entries.push({ id: crypto.randomUUID(), kind: 'transcript', text: part.text, time: pending.started + part.start, speaker: part.speaker });
        session.entries.sort((a, b) => a.time - b.time); session.pending = session.pending.filter(p => p.index !== pending.index); this.persist(session);
      } catch (error) {
        const detail = message(error); console.error(`Pip transcription: ${detail}`);
        const provider = session.provider ?? 'openai';
        const reason = /quota|rate.?limit|resource_exhausted|api.?key|unauth|permission|transcription 40[13]/i.test(detail) ? friendlyLiveError(provider, detail) : `${provider === 'gemini' ? 'Gemini' : 'OpenAI'} could not finish that recording's transcription.`;
        this.onError(`${reason} Your recording is saved for transcription after a restart with a working key.`);
      }
      finally { this.jobs.delete(id); }
    })();
    this.jobs.set(id, job);
  }
  private async postGemini(audio: string, key: string) {
    const responseSchema = {
      type: 'object',
      properties: {
        segments: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              speaker: { type: 'string' },
              start: { type: 'number' },
              end: { type: 'number' },
              text: { type: 'string' },
            },
            required: ['speaker', 'start', 'end', 'text'],
            propertyOrdering: ['speaker', 'start', 'end', 'text'],
          },
        },
      },
      required: ['segments'],
      propertyOrdering: ['segments'],
    };
    const data = Buffer.from(await Bun.file(audio).arrayBuffer()).toString('base64');
    const response = await fetch(`${geminiBase}/v1beta/models/gemini-3.8-flash:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ parts: [
          { text: 'Transcribe this audio. Return consecutive speech segments with the speaker label, start and end time in seconds from the beginning of this audio, and exact spoken text. Use a stable speaker label within this audio. Return an empty segments array when there is no intelligible speech.' },
          { inlineData: { mimeType: 'audio/mp4', data } },
        ] }],
        generationConfig: { responseMimeType: 'application/json', responseJsonSchema: responseSchema },
      }),
      signal: AbortSignal.timeout(300_000),
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 160);
      if (response.status === 429 || /quota|rate.?limit|resource_exhausted/i.test(detail)) throw new Error(`Gemini free-tier quota or rate limit reached. The audio is saved for later transcription.${detail ? ` ${detail}` : ''}`);
      throw new Error(`Gemini transcription ${response.status}: ${detail}`);
    }
    const result = object(await response.json());
    if (!Array.isArray(result.candidates)) throw new Error('Gemini transcription returned no candidates.');
    const candidate = object(result.candidates[0]);
    const content = object(candidate.content);
    if (!Array.isArray(content.parts)) throw new Error('Gemini transcription returned no content.');
    const text = content.parts.map(part => {
      const raw = object(part);
      if (raw.thought === true) return '';
      if (typeof raw.text !== 'string') throw new Error('Gemini transcription returned a non-text content part.');
      return raw.text;
    }).join('');
    if (!text.trim()) throw new Error('Gemini transcription returned empty output.');
    return object(JSON.parse(text));
  }
  private async post(audio: string, key: string, fields: Record<string, string>) {
    const body = new FormData();
    for (const [key, value] of Object.entries(fields)) body.set(key, value);
    body.set('file', Bun.file(audio), 'chunk.m4a');
    const response = await fetch(`${openaiBase}/audio/transcriptions`, { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body, signal: AbortSignal.timeout(300_000) });
    if (!response.ok) throw new Error(`Transcription ${response.status}: ${(await response.text()).slice(0, 160)}`);
    return object(await response.json());
  }
  private persist(session: Session) {
    const json = this.full(session);
    atomicJSON(join(session.notesPath, 'session.json'), { ...session, transcribing: session.pending.length });
    const out = [`# Pip session: ${new Date(session.started * 1000).toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' })}`, ''];
    if (session.ended) { const minutes = Math.trunc((session.ended - session.started) / 60); out.push(`Ended ${clock(session.ended)} (${Math.trunc(minutes / 60)}h ${minutes % 60}m).`); }
    else out.push(this.config.settings.notes ? 'Session awake; meeting notes are on.' : 'Session awake; meeting notes are off. No session audio is being recorded.');
    if (session.pending.length) out.push(`${session.pending.length} recording chunk(s) ${this.config.settings.notes ? 'queued for transcription; this file updates when they are done.' : 'saved; transcription resumes when you turn meeting notes on.'}`);
    if (json.questionCount) out.push(`You asked Pip ${json.questionCount} question(s); they're marked inline below.`);
    out.push('', '## Transcript', '');
    for (const entry of displayEntries(session)) {
      switch (entry.kind) {
        case 'transcript': out.push(`**[${clock(entry.time)}] Speaker ${entry.speaker || '?'}:** ${entry.text}`); break;
        case 'heard': out.push(`[${clock(entry.time)}] (live) ${entry.text}`); break;
        case 'asked': out.push(`> **[${clock(entry.time)}] You asked Pip:** ${entry.text}`); break;
        case 'reply': out.push(`> **Pip:** ${entry.text}`); break;
        case 'report': out.push('> **Research report:**\n' + entry.text.split('\n').map(line => '> ' + line).join('\n')); break;
      }
      out.push('');
    }
    writeFileSync(join(session.notesPath, 'notes.md.tmp'), out.join('\n'), { mode: 0o600 }); renameSync(join(session.notesPath, 'notes.md.tmp'), join(session.notesPath, 'notes.md')); this.onChange();
  }
  list() { return this.sessions.map(s => { const full = this.full(s); return { id: s.id, started: s.started, ended: s.ended, summary: full.summary, questionCount: full.questionCount, transcribing: s.pending.length, notesPath: s.notesPath }; }); }
  full(session: Session) {
    const entries = displayEntries(session);
    const summary = session.entries.find(e => e.kind === 'asked' && e.text)?.text || entries.find(e => e.kind === 'transcript' || e.kind === 'heard')?.text || 'Nothing said yet';
    const path = session.notesPath.startsWith(homedir() + '/') ? '~' + session.notesPath.slice(homedir().length) : session.notesPath;
    const root = this.root.startsWith(homedir() + '/') ? '~' + this.root.slice(homedir().length) : this.root;
    return { ...session, summary, questionCount: session.entries.filter(e => e.kind === 'asked').length, transcribing: session.pending.length, displayEntries: entries, exportText: exportText(session), agentPrompt: `I recorded a meeting with my Pip app on ${new Date(session.started * 1000).toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' })}. The notes are on my Linux computer in ${path}\n\n- notes.md: the full transcript with timestamps and speaker labels (A, B, … per five-minute chunk), plus my questions to Pip, its replies and research reports. Start here.\n- session.json: the same data, structured.\n- audio/: the original recording in five-minute chunks.\n\nAll my sessions are in ${root}/, one folder per session (see README.md there). Read the notes, then help me with: ` };
  }
  recentText() { return this.current ? displayEntries(this.current).filter(e => e.kind !== 'report').map(e => (e.kind === 'reply' ? 'Pip: ' : '') + e.text).join('\n').slice(-6000) : ''; }
  async finish() { this.end(); await Promise.all(this.jobs.values()); }
}
