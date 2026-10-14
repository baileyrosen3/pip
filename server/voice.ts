import { Configuration, message } from './config';
import { Notes } from './notes';
import { Tools } from './tools';
import { OpenAILive } from './openai-live';
import { GeminiLive } from './gemini-live';
import { GPTLive } from './gptlive-live';
import { friendlyLiveError } from './live-provider';
import type { AudioItem, LiveCallbacks, LiveProvider, PlaybackItem, ToolCall, ToolOutput } from './live-provider';
export type VoiceState = 'asleep' | 'waking' | 'listening' | 'asking' | 'thinking' | 'speaking';
export type PhonePacket = Record<string, unknown>;
/** Provider-independent phone state, notes and local tool choreography. Keys and wire formats stay in server adapters. */
export class Voice {
  state: VoiceState = 'asleep';
  micOn = false;
  private live: LiveProvider | null = null;
  private wantAwake = false;
  private connectedOnce = false;
  private holding = false;
  private askWhenReady = false;
  private awaitingQuestion = false;
  private askedItems = new Set<string>();
  private cancelledCalls = new Set<string>();
  private transcript = '';
  private responseActive = false;
  private responseID: string | undefined;
  private responseWasAllowed = false;
  private playingAudio = false;
  private nameAudio: { pcm: Uint8Array; item?: AudioItem }[] = [];
  private nameAudioBytes = 0;
  private nameAudioOverflow = false;
  private closing = new Set<Promise<void>>();
  private sleepAfterReply = false;
  private chirped = false;
  private toolsRunning = 0;
  private toolChain: Promise<void> = Promise.resolve();
  private replyAllowed = true;
  private pendingChirps = 0;
  private chirpTimers = new Set<NodeJS.Timeout>();
  private reconnectTimer: NodeJS.Timeout | undefined;
  private attempt = 0;
  private generation = 0;
  private autoSleepTimer: NodeJS.Timeout | undefined;
  private idleElapsed = 0;
  private idleUpdatedAt = performance.now();
  private idlePaused = true;
  private drowsy = false;
  private autoSleepMinutes: number;
  // Only isolated test servers set this; production always uses real minutes.
  private readonly timeScale = Number(process.env.PIPCTL_TEST_TIME_SCALE) > 0 ? Number(process.env.PIPCTL_TEST_TIME_SCALE) : 1;
  broadcast: (packet: PhonePacket) => void = () => {};
  mic: (on: boolean) => void = () => {};
  audioOut?: (pcm: Uint8Array, item?: AudioItem) => void;
  audioStop?: () => void;
  constructor(private config: Configuration, private notes: Notes, private tools: Tools) { this.autoSleepMinutes = config.settings.autoSleep; }
  private refreshIdle(reset = false) {
    clearTimeout(this.autoSleepTimer);
    const now = performance.now();
    if (!this.idlePaused) this.idleElapsed += now - this.idleUpdatedAt;
    this.idleUpdatedAt = now;
    if (reset || this.autoSleepMinutes !== this.config.settings.autoSleep) {
      this.idleElapsed = 0; this.autoSleepMinutes = this.config.settings.autoSleep;
      if (this.drowsy) { this.drowsy = false; this.tools.activity(null); }
    }
    this.idlePaused = !this.wantAwake || !this.autoSleepMinutes || this.holding || this.responseActive || this.playingAudio || !!this.toolsRunning || !!this.pendingChirps || this.state === 'thinking' || this.state === 'waking';
    if (this.idlePaused) {
      if (this.drowsy) { this.drowsy = false; this.tools.activity(null); }
      return;
    }
    const remaining = this.autoSleepMinutes * 60_000 * this.timeScale - this.idleElapsed;
    if (remaining <= 0) { this.sleep(); return; }
    const warning = 20_000 * this.timeScale;
    if (remaining <= warning && !this.drowsy) { this.drowsy = true; this.tools.activity('drowsy'); }
    this.autoSleepTimer = setTimeout(() => this.refreshIdle(), Math.max(1, this.drowsy ? remaining : remaining - warning));
  }
  hear() { if (this.wantAwake) this.refreshIdle(true); }
  private setState(state: VoiceState) {
    if (this.state !== state) { this.state = state; this.broadcast({ t: 'state', state }); }
    this.refreshIdle();
  }
  private missingKey() {
    return this.config.settings.provider === 'gemini' ? 'Add a Gemini key (free at aistudio.google.com/apikey) or switch to OpenAI in settings.' : 'Add an OpenAI key at platform.openai.com/api-keys, or choose Gemini · free in Brain settings.';
  }
  wake() {
    if (this.state !== 'asleep') return;
    if (!this.config.hasKey) { this.error(this.missingKey()); return; }
    this.wantAwake = true; this.connectedOnce = false; this.attempt = 0;
    this.replyAllowed = this.config.settings.replyMode === 'talk';
    this.refreshIdle(true);
    this.setState('waking'); this.tools.awake(true); this.connect();
  }
  sleep() {
    this.wantAwake = false; this.generation++; clearTimeout(this.reconnectTimer);
    for (const timer of this.chirpTimers) clearTimeout(timer); this.chirpTimers.clear(); this.pendingChirps = 0;
    const live = this.live; this.live = null; this.stopAudio(); this.closeProvider(live, true);
    this.micOn = false; this.mic(false); this.notes.end(); this.tools.awake(false);
    this.askedItems.clear(); this.cancelledCalls.clear(); this.awaitingQuestion = false; this.transcript = ''; this.responseActive = false; this.responseID = undefined; this.responseWasAllowed = false;
    this.sleepAfterReply = false; this.holding = false; this.askWhenReady = false; this.toolsRunning = 0;
    this.tools.activity(null); this.setState('asleep');
  }
  async finish() { this.sleep(); await Promise.all(this.closing); }
  private closeProvider(provider: LiveProvider | null, reset: boolean) {
    try {
      const result = provider?.close(reset);
      if (result) {
        const closing = result.catch(error => console.error(`Pip: closing live session: ${message(error)}`));
        this.closing.add(closing); void closing.finally(() => this.closing.delete(closing));
      }
    } catch (error) { console.error(`Pip: closing live session: ${message(error)}`); }
  }
  toggle() { if (this.state === 'asleep') this.wake(); else this.sleep(); }
  beginAsk() {
    this.holding = true; this.replyAllowed = this.config.settings.replyMode !== 'hold'; this.stopAudio(); this.caption('', false);
    this.refreshIdle();
    if (this.state === 'asleep') { this.wake(); return; }
    this.live?.beginAsk?.();
    if (this.state === 'listening' || this.state === 'speaking') this.setState('asking');
  }
  endAsk() {
    if (!this.holding) return;
    this.holding = false;
    if (!this.live?.connected || this.state === 'waking') { this.askWhenReady = this.wantAwake; return; }
    this.ask();
  }
  private ask() {
    this.transcript = ''; this.nameAudio.length = 0; this.nameAudioBytes = 0; this.nameAudioOverflow = false;
    this.askWhenReady = false; this.replyAllowed = true; this.setState('thinking'); this.awaitingQuestion = true;
    const alreadyResponding = this.responseActive;
    this.responseActive = true; this.live?.endAsk(alreadyResponding);
  }
  sayHi() {
    if (!this.live?.connected) { this.wake(); return; }
    this.replyAllowed = true; this.responseActive = true; this.live.sayHi();
    this.refreshIdle();
  }
  audio(bytes: Uint8Array) {
    if (!this.micOn || !this.wantAwake || bytes.length % 2) return;
    this.notes.append(bytes); this.live?.audio(bytes);
  }
  playback(on: boolean, items?: PlaybackItem[]) {
    if (!this.wantAwake || !this.voiceEnabled()) return;
    this.playingAudio = on; this.tools.playback(on); this.live?.playback?.(on, items);
    if (on) this.setState('speaking'); else this.finishIfQuiet();
  }
  bargeIn() { if (this.wantAwake && this.live?.provider === 'gptlive') this.live.interrupt?.(); }
  private voiceEnabled() { return this.config.settings.voice || this.config.settings.provider === 'gptlive'; }
  private stopAudio() {
    this.playingAudio = false; this.tools.playback(false); this.audioStop?.();
    this.nameAudio.length = 0; this.nameAudioBytes = 0; this.nameAudioOverflow = false;
  }
  private sendAudio(pcm: Uint8Array, item?: AudioItem) {
    this.playingAudio = true; this.tools.playback(true); this.setState('speaking'); this.audioOut?.(pcm, item);
  }
  private flushNameAudio() {
    if (!this.nameAudioOverflow) for (const packet of this.nameAudio) this.sendAudio(packet.pcm, packet.item);
    this.nameAudio.length = 0; this.nameAudioBytes = 0;
  }
  configure() {
    this.refreshIdle();
    if (!this.wantAwake || !this.live) return;
    if (!this.config.hasKey) { this.sleep(); this.error(this.missingKey()); return; }
    if (this.live.provider !== this.config.settings.provider) {
      // A provider switch starts a new notes session so queued chunks retain the brain/key they were recorded with.
      this.sleep(); this.tools.shell.send({ op: 'report', state: 'hide' }); this.wake(); return;
    }
    if (this.live.configure()) this.reconnect(true);
  }
  private connect() {
    if (!this.wantAwake) return;
    this.generation++; this.cancelledCalls.clear();
    try {
      if (!this.live) this.live = this.createProvider();
      this.live.connect(this.connectedOnce ? this.notes.recentText() : '');
    } catch (error) { this.error(friendlyLiveError(this.config.settings.provider, message(error))); this.reconnect(false); }
  }
  private createProvider(): LiveProvider {
    let provider: LiveProvider;
    const current = () => this.wantAwake && this.live === provider;
    const callbacks: LiveCallbacks = {
      ready: () => {
        if (!current()) return;
        this.attempt = 0;
        if (!this.connectedOnce) { this.notes.start(); this.connectedOnce = true; this.micOn = true; this.mic(true); this.chirp(2); }
        if (this.holding || this.askWhenReady) provider.beginAsk?.();
        if (this.askWhenReady) this.ask(); else this.setState(this.holding ? 'asking' : 'listening');
      },
      responseStart: id => {
        if (!current()) return;
        const continuing = id !== undefined && this.responseID === id;
        if (!continuing) { this.transcript = ''; this.chirped = false; this.responseWasAllowed = this.allowed(); }
        else if (this.responseWasAllowed) this.replyAllowed = true;
        this.responseID = id; this.responseActive = true; this.tools.activity(null);
        this.nameAudio.length = 0; this.nameAudioBytes = 0; this.nameAudioOverflow = false;
        this.refreshIdle();
      },
      text: delta => { if (!current()) return; this.transcript += delta; this.showReply(); },
      audio: (pcm, item) => {
        if (!current() || !this.voiceEnabled() || !pcm.length || pcm.length % 2) return;
        if (this.allowed()) this.sendAudio(pcm, item);
        else {
          // Keep a short, bounded lead-in if native audio arrives just before the name transcription.
          this.nameAudioBytes += pcm.length;
          if (this.nameAudioBytes <= 960_000 && !this.nameAudioOverflow) this.nameAudio.push({ pcm, item });
          else { this.nameAudio.length = 0; this.nameAudioOverflow = true; }
          provider.playback?.(false);
        }
      },
      responseDone: () => {
        if (!current()) return;
        this.responseActive = false; this.awaitingQuestion = false;
        if (this.transcript && this.allowed()) { this.caption(this.transcript, true); this.notes.add('reply', this.transcript, this.responseID); }
        if (this.responseID === undefined) this.transcript = '';
        this.nameAudio.length = 0; this.nameAudioBytes = 0; this.nameAudioOverflow = false;
        if (!this.toolsRunning && provider.provider !== 'openai' && this.config.settings.replyMode !== 'talk') this.replyAllowed = false;
        this.finishIfQuiet();
      },
      userTurn: id => {
        if (!current()) return;
        this.hear();
        const talk = this.config.settings.replyMode === 'talk', asked = this.holding || this.awaitingQuestion || talk;
        if (asked) this.askedItems.add(id);
        if (this.awaitingQuestion && !this.holding) this.awaitingQuestion = false;
        if (provider.provider !== 'openai' && this.config.settings.replyMode === 'name' && !this.responseActive && !this.toolsRunning) this.replyAllowed = asked;
        if (talk && !this.holding && (this.state === 'listening' || this.state === 'speaking')) this.setState('thinking');
        this.notes.turn(id, asked);
      },
      userWords: (id, text, final) => {
        if (!current()) return;
        if (text.trim()) this.hear();
        const addressed = this.config.settings.replyMode === 'name' && /\bpip\b/i.test(text), alreadyAsked = this.askedItems.has(id);
        if (addressed) { this.askedItems.add(id); this.replyAllowed = true; this.responseWasAllowed = true; this.flushNameAudio(); this.showReply(); }
        if (addressed && final && !alreadyAsked && !this.responseActive && provider.provider === 'openai') { this.setState('thinking'); this.responseActive = true; provider.respond(); }
        this.notes.turn(id, this.askedItems.has(id), text);
      },
      tools: calls => {
        if (!current()) return;
        this.toolsRunning++;
        if (this.state !== 'speaking') this.setState('thinking');
        const generation = this.generation;
        this.toolChain = this.toolChain.then(() => this.runTools(calls, provider, generation)).catch(error => { if (current()) this.error(message(error)); });
      },
      cancelTools: ids => { if (!current()) return; for (const id of ids) this.cancelledCalls.add(id); if (ids.length) this.tools.home(); },
      interrupted: () => {
        if (!current()) return;
        this.responseActive = false; this.transcript = ''; this.stopAudio(); this.caption('', false); this.finishIfQuiet();
      },
      emptyCommit: () => { if (current()) { this.awaitingQuestion = false; this.finishIfQuiet(); } },
      error: (text, fatal) => { if (!current()) return; if (fatal) this.sleep(); this.error(text); },
      disconnected: (code, reason) => {
        if (!current()) return;
        // 1007 = the provider rejected what we sent (e.g. an unsupported session setting): reconnecting would loop forever.
        if (code === 1007 || code === 1008 || code === 4001 || code === 4003 || code === 1013 || /resource_exhausted|quota|rate.?limit|api.?key|unauth|prepayment credits (?:are )?depleted/i.test(reason)) {
          console.error(`Pip: ${provider.provider} live closed (${code}): ${reason || 'no reason given'}`);
          const text = friendlyLiveError(provider.provider, reason || (code === 1013 ? 'Rate limit' : 'Authentication or session setup refused. Check the API key and model access.'));
          this.sleep(); this.error(text); return;
        }
        console.error(`Pip: ${provider.provider} live disconnected (${code}${reason ? `: ${reason}` : ''}); reconnecting.`); this.reconnect(false);
      },
      reconnect: () => { if (current()) this.reconnect(true); },
    };
    provider = this.config.settings.provider === 'gemini' ? new GeminiLive(this.config, callbacks) : this.config.settings.provider === 'gptlive' ? new GPTLive(this.config, callbacks) : new OpenAILive(this.config, callbacks);
    return provider;
  }
  private reconnect(immediate: boolean) {
    if (!this.wantAwake) return;
    this.generation++; this.stopAudio(); this.closeProvider(this.live, false); this.responseActive = false; this.toolsRunning = 0; this.transcript = '';
    this.tools.home(); this.tools.activity(null); clearTimeout(this.reconnectTimer);
    const delay = immediate ? 0 : Math.min(30_000, 2000 + this.attempt++ * 3000);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }
  private allowed() {
    if (this.live?.provider === 'openai' || this.config.settings.replyMode === 'talk') return true;
    return this.config.settings.replyMode === 'hold' ? this.replyAllowed && !this.holding : this.replyAllowed || this.holding;
  }
  private showReply() {
    if (!this.transcript.trim() || !this.allowed()) return;
    if (!this.chirped) { this.chirped = true; this.setState('speaking'); this.chirp(Math.min(5, Math.max(3, this.transcript.trim().split(/\s+/).length))); }
    this.caption(this.transcript, false);
  }
  private caption(text: string, done: boolean) { this.tools.caption(text, done); this.broadcast({ t: 'caption', text, done }); }
  error(text: string) { this.tools.activity('error'); this.broadcast({ t: 'error', message: text }); this.tools.caption(text, true); }
  private chirp(syllables: number) {
    if (this.voiceEnabled()) return;
    this.broadcast({ t: 'chirp', syllables }); this.pendingChirps++;
    this.refreshIdle();
    this.tools.shell.send({ op: 'talkTest', seconds: ((syllables - 1) * 108 + 158) / 1000 });
    const timer = setTimeout(() => { this.chirpTimers.delete(timer); this.pendingChirps = Math.max(0, this.pendingChirps - 1); this.finishIfQuiet(); }, (syllables - 1) * 108 + 158);
    this.chirpTimers.add(timer);
  }
  private async runTools(calls: ToolCall[], provider: LiveProvider, generation: number) {
    const current = () => this.live === provider && this.wantAwake && this.generation === generation;
    const results: ToolOutput[] = [];
    try {
      for (const call of calls) {
        if (!current()) return;
        if (this.cancelledCalls.has(call.id)) continue;
        if (!this.allowed()) { results.push({ ...call, text: 'The app has not received an addressed or held request. Stay silent and do not act until the user says Pip or finishes holding the screen.' }); continue; }
        if (call.name === 'go_to_sleep') this.sleepAfterReply = true;
        const output = await this.tools.run(call.name, call.arguments);
        if (!current()) return;
        if (this.cancelledCalls.has(call.id)) continue;
        const marker = '\n---REPORT---\n';
        if (call.name === 'web_research' && output.text.includes(marker)) this.notes.add('report', output.text.split(marker).slice(1).join(marker));
        results.push({ id: call.id, name: call.name, text: output.text, image: output.image });
      }
      if (results.length && current()) { this.responseActive = true; await provider.toolResults(results); }
    } finally {
      if (current()) { this.toolsRunning = Math.max(0, this.toolsRunning - 1); this.finishIfQuiet(); }
    }
  }
  private finishIfQuiet() {
    this.refreshIdle();
    if (this.pendingChirps || this.playingAudio || this.responseActive || this.toolsRunning) return;
    this.tools.activity(null);
    if (this.sleepAfterReply) { this.sleep(); return; }
    if (this.state === 'speaking' || this.state === 'thinking') this.setState(this.holding ? 'asking' : 'listening');
  }
}
