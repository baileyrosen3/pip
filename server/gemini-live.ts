import { Configuration, geminiBase, message, object } from './config';
import { geminiConnection, geminiSetup } from './gemini-session';
import { friendlyLiveError, liveMessage } from './live-provider';
import type { LiveCallbacks, LiveProvider, ToolCall, ToolOutput } from './live-provider';
import { PCMResampler24To16 } from './resampler';
/** Raw BidiGenerateContent, documented at https://ai.google.dev/api/live. No SDK or browser key. */
export class GeminiLive implements LiveProvider {
  readonly provider = 'gemini' as const;
  private socket: WebSocket | null = null;
  private ready = false;
  private timeout: NodeJS.Timeout | undefined;
  private goAwayTimer: NodeJS.Timeout | undefined;
  private messages: Promise<void> = Promise.resolve();
  private resampler = new PCMResampler24To16();
  private resumeHandle: string | undefined;
  private resumable = false;
  private goingAway = false;
  private responseOpen = false;
  private generationDone = false;
  private busy = false;
  private manualActivity = false;
  private manualAudioBytes = 0;
  private inputID = '';
  private inputText = '';
  private signature = '';
  private connectionKey = '';
  private lastImageAt = -Infinity;
  private pendingCalls = new Set<string>();
  constructor(private config: Configuration, private callbacks: LiveCallbacks) {}
  get connected() { return this.ready && this.socket?.readyState === WebSocket.OPEN; }
  connect(context: string) {
    this.close(false);
    const handle = this.resumable ? this.resumeHandle : undefined;
    this.connectionKey = this.config.key('gemini');
    const { url, setup } = geminiConnection(this.config.settings, geminiBase, this.connectionKey, handle);
    this.signature = JSON.stringify(geminiSetup(this.config.settings));
    const socket = new WebSocket(url.href); this.socket = socket; socket.binaryType = 'arraybuffer';
    this.timeout = setTimeout(() => { if (this.socket === socket && !this.ready) socket.close(); }, 20_000);
    socket.onopen = () => { if (this.socket === socket) socket.send(JSON.stringify({ setup })); };
    socket.onmessage = event => {
      this.messages = this.messages.then(async () => {
        if (this.socket !== socket) return;
        const packet = await liveMessage(event.data); if (this.socket !== socket) return;
        if ('setupComplete' in packet) {
          this.ready = true; clearTimeout(this.timeout);
          if (context && !handle) this.send({ clientContent: { turns: [{ role: 'user', parts: [{ text: "Context from this session's notes. Stay silent; this is not a new request.\n" + context }] }], turnComplete: false } });
          this.callbacks.ready(!!handle); return;
        }
        this.handle(packet);
      }).catch(error => { console.error(`Pip Gemini frame: ${message(error)}`); this.callbacks.error('Gemini sent an unreadable live update. Try asking again.', false); });
    };
    socket.onerror = () => { if (this.socket === socket) console.error('Pip: Gemini live connection error.'); };
    socket.onclose = event => {
      if (this.socket !== socket) return;
      this.socket = null; this.ready = false; clearTimeout(this.timeout); clearTimeout(this.goAwayTimer);
      if (handle && /resum|session.*(?:expir|invalid)|handle/i.test(event.reason)) { this.resumeHandle = undefined; this.resumable = false; this.callbacks.reconnect(); return; }
      this.callbacks.disconnected(event.code, event.reason);
    };
  }
  close(reset: boolean) {
    clearTimeout(this.timeout); clearTimeout(this.goAwayTimer);
    const socket = this.socket; this.socket = null; this.ready = false; socket?.close(1000);
    this.resampler.reset(); this.responseOpen = false; this.generationDone = false; this.busy = false; this.manualActivity = false; this.manualAudioBytes = 0;
    this.inputID = ''; this.inputText = ''; this.goingAway = false; this.pendingCalls.clear();
    if (reset) { this.resumeHandle = undefined; this.resumable = false; }
  }
  configure() { return this.connectionKey !== this.config.key('gemini') || this.signature !== JSON.stringify(geminiSetup(this.config.settings)); }
  audio(bytes: Uint8Array) {
    if (!this.connected) return;
    const pcm = this.resampler.process(bytes); this.sendAudio(pcm);
    if (this.manualActivity) this.manualAudioBytes += bytes.length;
  }
  beginAsk() {
    if (!this.connected || this.config.settings.replyMode !== 'hold' || this.manualActivity) return;
    this.manualActivity = true; this.manualAudioBytes = 0; this.startInputTurn();
    this.send({ realtimeInput: { activityStart: {} } });
  }
  endAsk(responseActive: boolean) {
    if (this.config.settings.replyMode === 'hold') {
      if (!this.manualActivity) this.beginAsk();
      this.sendAudio(this.resampler.flush());
      this.send({ realtimeInput: { activityEnd: {} } }); this.manualActivity = false;
      if (this.inputID) this.callbacks.userTurn(this.inputID);
      if (this.manualAudioBytes === 0 && !responseActive) this.respond();
    } else if (!responseActive) this.respond();
  }
  respond() {
    this.generationDone = false;
    this.send({ clientContent: { turns: [{ role: 'user', parts: [{ text: 'Pip, the user explicitly asked you to answer by holding the screen. Answer or act on their most recent spoken question, using earlier words as context.' }] }], turnComplete: true } });
  }
  sayHi() { this.generationDone = false; this.send({ clientContent: { turns: [{ role: 'user', parts: [{ text: 'Pip, reply with a quick, cheerful hi in under eight words.' }] }], turnComplete: true } }); }
  async toolResults(results: ToolOutput[]) {
    const socket = this.socket;
    const valid = results.filter(result => this.pendingCalls.has(result.id));
    // Live vision is realtimeInput.video (JPEG), at no more than one frame per second. Feed it before releasing the blocking tool.
    for (const result of valid) if (result.image) {
      const delay = Math.max(0, 1000 - (performance.now() - this.lastImageAt));
      if (delay) await Bun.sleep(delay);
      if (this.socket !== socket || !this.connected) return;
      this.send({ realtimeInput: { video: { mimeType: 'image/jpeg', data: result.image } } }); this.lastImageAt = performance.now();
    }
    if (this.socket !== socket || !this.connected) return;
    const responses = valid.filter(result => this.pendingCalls.has(result.id)).map(result => ({ id: result.id, name: result.name, response: { result: result.text } }));
    for (const response of responses) this.pendingCalls.delete(response.id);
    if (responses.length) { this.generationDone = false; this.send({ toolResponse: { functionResponses: responses } }); }
    // Gemini resumes generation itself after toolResponse; response.create is an OpenAI-only operation.
  }
  private sendAudio(pcm: Uint8Array) {
    if (pcm.length) this.send({ realtimeInput: { audio: { mimeType: 'audio/pcm;rate=16000', data: Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength).toString('base64') } } });
  }
  private send(packet: Record<string, unknown>) {
    if (this.connected) { try { this.socket!.send(JSON.stringify(packet)); } catch { console.error('Pip: Gemini live send failed.'); } }
  }
  private startInputTurn() {
    this.inputID = crypto.randomUUID(); this.inputText = ''; this.generationDone = false; this.callbacks.userTurn(this.inputID);
  }
  private handle(event: Record<string, unknown>) {
    if (event.sessionResumptionUpdate) {
      const update = object(event.sessionResumptionUpdate); this.resumable = update.resumable === true;
      if (this.resumable && typeof update.newHandle === 'string' && update.newHandle) this.resumeHandle = update.newHandle;
      if (this.goingAway && this.resumable && !this.busy && !this.pendingCalls.size) this.callbacks.reconnect();
    }
    if (event.goAway) {
      const notice = object(event.goAway);
      if (typeof notice.timeLeft !== 'string' || !/^\d+(?:\.\d+)?s$/.test(notice.timeLeft)) throw new Error('Invalid Gemini GoAway duration.');
      this.goingAway = true;
      const socket = this.socket, delay = Math.max(0, parseFloat(notice.timeLeft) * 1000 - 500);
      clearTimeout(this.goAwayTimer); this.goAwayTimer = setTimeout(() => { if (this.socket === socket) this.callbacks.reconnect(); }, delay);
      if (this.resumable && !this.busy && !this.pendingCalls.size) this.callbacks.reconnect();
    }
    if (event.voiceActivity) {
      const activity = object(event.voiceActivity);
      if (activity.type === 'ACTIVITY_START' && !this.manualActivity) this.startInputTurn();
      if (activity.type === 'ACTIVITY_END' && !this.inputID) this.startInputTurn();
    }
    if (event.toolCallCancellation) {
      const cancellation = object(event.toolCallCancellation);
      const ids = Array.isArray(cancellation.ids) ? cancellation.ids.filter((id): id is string => typeof id === 'string') : [];
      for (const id of ids) this.pendingCalls.delete(id);
      this.callbacks.cancelTools(ids);
    }
    if (event.toolCall) {
      const tool = object(event.toolCall), calls: ToolCall[] = [];
      if (Array.isArray(tool.functionCalls)) for (const raw of tool.functionCalls) {
        const call = object(raw);
        if (typeof call.id !== 'string' || typeof call.name !== 'string') throw new Error('Invalid Gemini function call.');
        calls.push({ id: call.id, name: call.name, arguments: JSON.stringify(call.args ? object(call.args) : {}) }); this.pendingCalls.add(call.id);
      }
      if (calls.length) { this.busy = true; this.callbacks.tools(calls); }
    }
    if (event.serverContent) {
      const content = object(event.serverContent);
      if (content.interrupted === true) { this.responseOpen = false; this.generationDone = true; this.callbacks.interrupted(); }
      if (content.inputTranscription) {
        const transcription = object(content.inputTranscription);
        if (typeof transcription.text === 'string') { if (!this.inputID) this.startInputTurn(); this.inputText += transcription.text; this.callbacks.userWords(this.inputID, this.inputText, true); }
      }
      if (content.interimInputTranscription) {
        const transcription = object(content.interimInputTranscription);
        if (typeof transcription.text === 'string') { if (!this.inputID) this.startInputTurn(); this.callbacks.userWords(this.inputID, transcription.text, false); }
      }
      if (content.interrupted !== true && (content.outputTranscription || content.modelTurn)) {
        if (!this.responseOpen) { this.responseOpen = true; this.generationDone = false; this.busy = true; this.callbacks.responseStart(); }
        if (content.modelTurn) {
          const turn = object(content.modelTurn);
          if (Array.isArray(turn.parts)) for (const raw of turn.parts) {
            const part = object(raw); if (part.thought === true || !part.inlineData) continue;
            const inline = object(part.inlineData);
            if (typeof inline.mimeType !== 'string' || !inline.mimeType.startsWith('audio/pcm') || typeof inline.data !== 'string') continue;
            const rate = /rate=(\d+)/.exec(inline.mimeType);
            if (rate && rate[1] !== '24000') throw new Error('Gemini returned audio at an unsupported sample rate.');
            this.callbacks.audio(Buffer.from(inline.data, 'base64'));
          }
        }
        // Captions come only from outputAudioTranscription, never private thinking parts.
        if (content.outputTranscription) { const transcript = object(content.outputTranscription); if (typeof transcript.text === 'string') this.callbacks.text(transcript.text); }
      }
      if (content.generationComplete === true || content.turnComplete === true || (content.waitingForInput === true && !this.manualActivity)) {
        // Proactive audio can finish a turn without producing a modelTurn. That still ends an explicit ask.
        if (!this.generationDone) { this.responseOpen = false; this.generationDone = true; this.callbacks.responseDone(); }
        if (content.turnComplete === true && content.interactionStatus !== 'IN_PROGRESS') {
          this.busy = false; this.inputID = ''; this.inputText = '';
          if (this.goingAway && this.resumable && !this.pendingCalls.size) this.callbacks.reconnect();
        }
      }
    }
    if (event.error) {
      const error = object(event.error), text = typeof error.message === 'string' ? error.message : String(error.status || 'Live request failed.');
      const fatal = /resource_exhausted|quota|rate.?limit|unauth|permission|api.?key/i.test(text + String(error.status));
      this.callbacks.error(friendlyLiveError('gemini', text), fatal);
    }
  }
}
