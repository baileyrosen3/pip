import { message, object } from './config';
import type { Configuration } from './config';
import type { LiveCallbacks, LiveProvider, ToolCall, ToolOutput } from './live-provider';
import { sessionInstructions, sessionTools } from './session';
import { OpenClients } from './open-clients';
import { OpenVAD } from './open-vad';

/** Turn-based brain; the phone protocol and desktop tool choreography stay in Voice. */
export class OpenLive implements LiveProvider {
  readonly provider = 'open' as const;
  connected = false;
  private signature = '';
  private history: Record<string, unknown>[] = [];
  private session = new AbortController();
  private reply: AbortController | undefined;
  private turns: Promise<void> = Promise.resolve();
  private holding = false;
  private held: Uint8Array[] = [];
  private playing = false;
  private responding = false;
  private pendingCalls: ToolCall[] = [];
  private toolsDone: (() => void) | undefined;
  private clients: OpenClients;
  private vad: OpenVAD;
  constructor(private config: Configuration, private callbacks: LiveCallbacks) {
    this.clients = new OpenClients(config);
    this.vad = new OpenVAD(() => this.interrupt(), pcm => this.enqueue(pcm, false));
  }
  connect(context: string) {
    this.close(false); this.session = new AbortController(); this.connected = true;
    this.signature = JSON.stringify([this.config.settings, this.config.secrets.open]);
    this.history = [{ role: 'system', content: sessionInstructions(this.config.settings, 'open') + '\n\nThe app transcribes each turn and only requests a response for an addressed turn. Answer this request now; never pretend to hear live audio.' + (!this.config.secrets.openaiKey ? '\nWeb research is not configured. Do not claim to search the web; say briefly when current facts cannot be verified.' : '') }];
    if (context) this.history.push({ role: 'user', content: 'Earlier session context (do not answer):\n' + context });
    // Load the model and cache Pip's long instructions + tools while the user starts talking, so the first
    // answer doesn't pay for a cold model load and ~2,500 tokens of prompt (about 10 s on an integrated GPU).
    void this.clients.warm(this.history, this.tools(), this.session.signal).catch(() => {});
    queueMicrotask(() => { if (this.connected) this.callbacks.ready(false); });
  }
  private tools() {
    return sessionTools(this.config.settings).filter(tool => tool.name !== 'web_research' || !!this.config.secrets.openaiKey).map(({ type, ...fn }) => ({ type, function: fn }));
  }
  close(_reset: boolean) {
    this.connected = false; this.session.abort(); this.reply?.abort(); this.toolsDone?.(); this.toolsDone = undefined;
    this.vad.reset(); this.held = []; this.holding = false; this.playing = false; this.responding = false; this.pendingCalls = []; this.turns = Promise.resolve();
  }
  configure() { return this.signature !== JSON.stringify([this.config.settings, this.config.secrets.open]); }
  audio(bytes: Uint8Array) {
    if (!this.connected) return;
    if (this.holding) this.held.push(bytes.slice()); else this.vad.audio(bytes);
  }
  beginAsk() { this.interrupt(); this.vad.reset(); this.held = []; this.holding = true; }
  endAsk(_responseActive: boolean) {
    const pcm = Buffer.concat(this.held); this.held = []; this.holding = false; this.vad.reset();
    if (pcm.length < 4800) { this.callbacks.emptyCommit(); return; }
    this.enqueue(pcm, true);
  }
  private enqueue(pcm: Uint8Array, asked: boolean) {
    const session = this.session, id = crypto.randomUUID();
    // Capture Voice's held/addressed state now, not after an earlier slow transcription.
    this.callbacks.userTurn(id);
    this.turns = this.turns.then(async () => {
      if (session.signal.aborted) return;
      try {
        const text = await this.clients.transcribe(pcm, session.signal);
        if (session.signal.aborted) return;
        this.callbacks.userWords(id, text, true);
        if (!text) { this.callbacks.emptyCommit(); return; }
        this.history.push({ role: 'user', content: text });
        const mode = this.config.settings.replyMode;
        if (asked || mode === 'talk' || mode === 'name' && /\bpip\b/i.test(text)) await this.answer();
        else this.callbacks.emptyCommit();
      } catch (error) {
        if (!session.signal.aborted) { this.callbacks.error(message(error), false); this.callbacks.responseDone(); }
      }
    });
  }
  respond() { void this.answer(); }
  sayHi() { this.history.push({ role: 'user', content: 'Say a quick cheerful hi in under eight words.' }); void this.answer(); }
  playback(on: boolean) { this.playing = on; }
  interrupt() {
    if (!this.responding && !this.playing) return;
    this.reply?.abort(); this.toolsDone?.(); this.toolsDone = undefined;
    if (this.pendingCalls.length) {
      this.callbacks.cancelTools(this.pendingCalls.map(call => call.id));
      for (const call of this.pendingCalls) this.history.push({ role: 'tool', tool_call_id: call.id, content: 'Interrupted by the user.' });
      this.pendingCalls = [];
    }
    this.responding = false; this.playing = false; this.callbacks.interrupted();
  }
  async toolResults(results: ToolOutput[]) {
    if (!this.pendingCalls.length || this.reply?.signal.aborted) return;
    for (const result of results) this.history.push({ role: 'tool', tool_call_id: result.id, content: result.text });
    for (const result of results) if (result.image) this.history.push({ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + result.image } }] });
    this.pendingCalls = []; this.toolsDone?.(); this.toolsDone = undefined;
  }
  private async answer() {
    this.interrupt();
    const controller = new AbortController(), session = this.session;
    this.reply = controller; this.responding = true;
    const signal = AbortSignal.any([session.signal, controller.signal]), id = crypto.randomUUID();
    this.callbacks.responseStart(id);
    let speech = Promise.resolve(), sentence = '';
    const speak = (text: string) => {
      if (!text.trim() || !this.config.settings.voice) return;
      speech = speech.then(async () => {
        if (signal.aborted) return;
        const pcm = await this.clients.speech(text.trim(), signal);
        if (signal.aborted) return;
        this.playing = true;
        for (let offset = 0; offset < pcm.length; offset += 4800) this.callbacks.audio(pcm.subarray(offset, offset + 4800), { id, index: 0 });
      });
      // Attach rejection handling immediately while chat is still streaming.
      void speech.catch(() => {});
    };
    try {
      while (!signal.aborted) {
        let text = '';
        const calls = new Map<number, ToolCall>();
        for await (const delta of this.clients.chat(this.history, this.tools(), signal)) {
          if (signal.aborted) return;
          if (typeof delta.content === 'string') {
            text += delta.content; sentence += delta.content; this.callbacks.text(delta.content);
            let match: RegExpExecArray | null;
            while ((match = /^([\s\S]*?[.!?](?:["”']?)(?:\s+|$))/.exec(sentence))) {
              speak(match[1]); sentence = sentence.slice(match[1].length);
            }
          }
          if (Array.isArray(delta.tool_calls)) for (const raw of delta.tool_calls) {
            const part = object(raw), index = typeof part.index === 'number' ? part.index : 0;
            const call = calls.get(index) ?? { id: '', name: '', arguments: '' };
            if (typeof part.id === 'string') call.id += part.id;
            if (part.function) { const fn = object(part.function); if (typeof fn.name === 'string') call.name += fn.name; if (typeof fn.arguments === 'string') call.arguments += fn.arguments; }
            calls.set(index, call);
          }
        }
        if (signal.aborted) return;
        const complete = [...calls.values()];
        this.history.push({ role: 'assistant', content: text || null, ...(complete.length ? { tool_calls: complete.map(call => ({ id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments } })) } : {}) });
        if (!complete.length) break;
        this.pendingCalls = complete;
        await new Promise<void>(resolve => { this.toolsDone = resolve; this.callbacks.tools(complete); });
      }
      speak(sentence); await speech;
    } catch (error) { if (!signal.aborted) this.callbacks.error(message(error), false); }
    finally {
      if (this.reply === controller) {
        this.responding = false;
        if (!signal.aborted) this.callbacks.responseDone();
      }
    }
  }
}
