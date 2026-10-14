import { Configuration, message, object, openaiBase } from './config';
import { friendlyLiveError, liveMessage } from './live-provider';
import type { LiveCallbacks, LiveProvider, ToolOutput } from './live-provider';
import { gptLiveSession } from './gptlive-session';

const CLOSE_TIMEOUT_MS = 15_000;
const USER_FRAGMENT_GAP_MS = 900;
const PLAYBACK_SETTLE_MS = 160;

/** GPT-Live's primary WebSocket: continuous 24 kHz PCM input and playback-driven captions. */
export class GPTLive implements LiveProvider {
  readonly provider = 'gptlive' as const;
  private socket: WebSocket | null = null;
  private timeout: NodeJS.Timeout | undefined;
  private userTimer: NodeJS.Timeout | undefined;
  private playbackTimer: NodeJS.Timeout | undefined;
  private messages: Promise<void> = Promise.resolve();
  private ready = false;
  private closing = false;
  private signature = '';
  private connectionKey = '';
  private inputRemainder: Uint8Array | null = null;
  private responseActive = false;
  private outputQueued = false;
  private userId = '';
  private userText = '';
  private pendingCalls = new Map<string, { delegationId: string; responseId: string }>();
  private completedCalls = new Set<string>();
  private responseIDs = new Map<string, string>();
  private seenItems = new Set<string>();
  private eventSequence = 0;
  private closingSockets = new Map<WebSocket, { timer: NodeJS.Timeout; promise: Promise<void>; resolve: () => void }>();
  private responseCalls = new Map<string, Set<string>>();
  private completedResponses = new Set<string>();
  private continuedResponses = new Set<string>();
  private callResponses = new Map<string, string>();
  private playbackDrained = false;
  private captionID = crypto.randomUUID();
  private outputSpeaking = false;
  private outputQuietMs = 0;
  private preRoll: Buffer[] = [];
  private preRollBytes = 0;

  constructor(private config: Configuration, private callbacks: LiveCallbacks) {}
  get connected() { return this.ready && this.socket?.readyState === WebSocket.OPEN; }

  connect(context: string) {
    void this.close(false);
    this.connectionKey = this.config.key('openai');
    this.signature = JSON.stringify(gptLiveSession(this.config.settings));
    const url = new URL(openaiBase.replace(/^http/, 'ws') + '/live/sessions');
    const socket = new WebSocket(url.href, { headers: { Authorization: `Bearer ${this.connectionKey}` } });
    socket.binaryType = 'arraybuffer';
    this.socket = socket;
    this.ready = false;
    this.closing = false;
    this.timeout = setTimeout(() => {
      if (this.socket === socket && !this.ready) {
        this.callbacks.error(friendlyLiveError(this.provider, 'Session startup timed out.'), false);
        socket.close();
      }
    }, 20_000);
    socket.onopen = () => {
      if (this.socket !== socket) return;
      const session = gptLiveSession(this.config.settings, context);
      this.sendOn(socket, { type: 'session.start', event_id: this.eventID('start'), session });
    };
    socket.onmessage = event => {
      this.messages = this.messages.then(async () => {
        if (this.socket !== socket && !this.closingSockets.has(socket)) return;
        const packet = await liveMessage(event.data);
        if (this.socket === socket && !this.closing) {
          this.handle(packet, socket);
        } else if (this.closingSockets.has(socket)) {
          if (packet.type === 'session.closed') this.handle(packet, socket);
          else if (packet.type === 'error') console.error(`Pip GPT-Live closing session: ${JSON.stringify(packet.error)}`);
        }
      }).catch(error => {
        console.error(`Pip GPT-Live frame: ${message(error)}`);
        if (this.socket === socket && !this.closing) this.callbacks.error('GPT-Live sent an unreadable update.', false);
      });
    };
    socket.onerror = () => {
      if (this.socket === socket) console.error('Pip: GPT-Live connection error.');
      else if (this.closingSockets.has(socket)) console.error('Pip GPT-Live: connection error while finalizing session.');
    };
    socket.onclose = event => {
      const active = this.socket === socket;
      const closing = this.closingSockets.get(socket);
      if (!active && !closing) return;
      if (active) {
        this.socket = null;
        this.ready = false;
        clearTimeout(this.timeout);
      }
      if (closing) {
        clearTimeout(closing.timer);
        this.closingSockets.delete(socket);
        console.error('Pip GPT-Live: transport closed before session.closed; final usage is unconfirmed.');
        closing.resolve();
      }
      if (!active || this.closing) return;
      this.callbacks.disconnected(event.code, event.reason);
    };
  }

  close(_reset: boolean): Promise<void> {
    clearTimeout(this.timeout);
    clearTimeout(this.userTimer);
    clearTimeout(this.playbackTimer);
    const socket = this.socket;
    if (socket && socket.readyState === WebSocket.OPEN && this.ready && !this.closing) {
      this.closing = true;
      this.ready = false;
      this.socket = null;
      let resolve!: () => void;
      const promise = new Promise<void>(done => { resolve = done; });
      const timer = setTimeout(() => {
        if (this.closingSockets.get(socket)?.promise !== promise) return;
        this.closingSockets.delete(socket);
        console.error('Pip GPT-Live: session.close timed out before session.closed; final usage is unconfirmed.');
        resolve();
        socket.close();
      }, CLOSE_TIMEOUT_MS);
      this.closingSockets.set(socket, { timer, promise, resolve });
      this.sendOn(socket, { type: 'session.close', event_id: this.eventID('close') });
    } else {
      this.socket = null;
      this.ready = false;
      if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000);
    }
    this.captionID = crypto.randomUUID(); this.outputSpeaking = false; this.outputQuietMs = 0; this.preRoll.length = 0; this.preRollBytes = 0;
    this.responseActive = false; this.outputQueued = false; this.playbackDrained = false;
    this.inputRemainder = null;
    this.userId = '';
    this.userText = '';
    this.pendingCalls.clear();
    this.completedCalls.clear();
    this.responseIDs.clear();
    this.seenItems.clear();
    this.responseCalls.clear();
    this.completedResponses.clear();
    this.continuedResponses.clear();
    this.callResponses.clear();
    return Promise.all([...this.closingSockets.values()].map(closing => closing.promise)).then(() => undefined);
  }

  configure() {
    return this.connectionKey !== this.config.key('openai') ||
      this.signature !== JSON.stringify(gptLiveSession(this.config.settings));
  }

  audio(bytes: Uint8Array) {
    if (!this.connected || this.closing || !bytes.length) return;
    const prior = this.inputRemainder;
    let audio = bytes;
    if (prior?.length) {
      audio = new Uint8Array(prior.length + bytes.length);
      audio.set(prior); audio.set(bytes, prior.length);
      this.inputRemainder = null;
    }
    const completeLength = audio.length - audio.length % 2;
    if (completeLength !== audio.length) this.inputRemainder = audio.slice(completeLength);
    if (!completeLength) return;
    this.send({ type: 'session.input_audio.append', audio: Buffer.from(audio.buffer, audio.byteOffset, completeLength).toString('base64') });
  }

  beginAsk() {
    this.captionID = crypto.randomUUID();
    if (this.config.settings.replyMode === 'hold') this.appendInstruction('The user is holding the screen to ask a question. Listen without answering or delegating yet. Wait for the app to say they have finished holding.');
  }
  endAsk(responseActive: boolean) {
    if (this.config.settings.replyMode === 'hold') {
      clearTimeout(this.playbackTimer); this.responseActive = false; this.playbackDrained = false;
      this.appendInstruction('The user has finished holding the screen. This is an explicit request to answer or act on their most recent spoken question now, using earlier conversation as context. Delegate if a tool is needed, then give the brief verified answer.');
    } else if (!responseActive) this.respond();
  }
  respond() {
    this.appendInstruction('Respond to the user’s most recent request now, then pause and listen.');
  }
  sayHi() {
    this.captionID = crypto.randomUUID();
    this.appendInstruction('Say a brief, cheerful hi to the user, then pause and listen.');
  }

  playback(on: boolean) {
    if (on) {
      clearTimeout(this.playbackTimer);
      this.outputQueued = true;
      this.playbackDrained = false;
      if (!this.responseActive) {
        this.responseActive = true;
        this.callbacks.responseStart(this.captionID);
      }
      return;
    }
    this.outputQueued = false;
    this.playbackDrained = true;
    clearTimeout(this.playbackTimer);
    if (!this.responseActive) return;
    this.playbackTimer = setTimeout(() => {
      if (this.outputQueued || !this.responseActive) return;
      this.responseActive = false; this.callbacks.responseDone();
    }, PLAYBACK_SETTLE_MS);
  }

  async toolResults(results: ToolOutput[]) {
    if (!this.connected || !results.length) return;
    const completed: ToolOutput[] = [];
    for (const result of results) {
      if (!this.pendingCalls.has(result.id) || this.completedCalls.has(result.id)) continue;
      this.completedCalls.add(result.id);
      this.pendingCalls.delete(result.id);
      completed.push(result);
    }
    const responseKeys = new Set<string>();
    for (const result of completed) {
      this.send({
        type: 'response.item.create', event_id: this.eventID('tool-output'),
        item: { type: 'function_call_output', call_id: result.id, output: result.text },
      });
      if (result.image) {
        this.send({
          type: 'response.item.create', event_id: this.eventID('tool-image'),
          item: { type: 'message', role: 'user', content: [{ type: 'input_image', image_url: `data:image/jpeg;base64,${result.image}` }] },
        });
      }
      const responseKey = this.callResponses.get(result.id);
      if (responseKey) responseKeys.add(responseKey);
    }
    for (const responseKey of responseKeys) this.continueResponse(responseKey);
  }

  private handle(event: Record<string, unknown>, socket: WebSocket) {
    switch (event.type) {
      case 'session.started':
        if (socket !== this.socket || this.closing) return;
        clearTimeout(this.timeout);
        this.ready = true;
        this.callbacks.ready(false);
        break;
      case 'session.closed': {
        const active = socket === this.socket;
        const closing = this.closingSockets.get(socket);
        if (closing) {
          clearTimeout(closing.timer);
          this.closingSockets.delete(socket);
          closing.resolve();
        }
        if (active) {
          this.socket = null;
          this.ready = false;
          this.closing = false;
          if (!closing) this.callbacks.disconnected(1000, 'Session closed.');
        } else if (!this.socket) {
          this.closing = false;
        }
        if (socket.readyState < WebSocket.CLOSING) socket.close(1000);
        break;
      }
      case 'session.output_audio.delta':
        if (typeof event.delta === 'string') this.outputAudio(Buffer.from(event.delta, 'base64'));
        break;
      case 'session.output_transcript.delta':
        if (typeof event.delta !== 'string') break;
        if (!this.responseActive) {
          this.responseActive = true;
          this.playbackDrained = false;
          this.callbacks.responseStart(this.captionID);
        }
        clearTimeout(this.playbackTimer);
        this.callbacks.text(event.delta);
        if (!this.outputQueued) this.playback(false);
        break;
      case 'session.input_transcript.delta':
        this.inputTranscript(event);
        break;
      case 'response.event':
        this.responseEvent(event);
        break;
      case 'session.delegation.created': {
        const delegation = event.delegation && typeof event.delegation === 'object' ? object(event.delegation) : {};
        if (typeof delegation.id === 'string') this.responseIDs.set(delegation.id, '');
        break;
      }
      case 'error':
        this.handleError(event);
        break;
    }
  }

  private responseEvent(envelope: Record<string, unknown>) {
    if (!envelope.event || typeof envelope.event !== 'object') return;
    const event = object(envelope.event);
    const delegationId = typeof envelope.delegation_id === 'string' ? envelope.delegation_id : '';
    if (event.type === 'response.created' && typeof event.response === 'object' && event.response) {
      const response = object(event.response);
      if (typeof response.id === 'string') this.responseIDs.set(delegationId, response.id);
      return;
    }
    if (event.type === 'response.completed') {
      const response = event.response && typeof event.response === 'object' ? object(event.response) : {};
      const responseKey = (typeof response.id === 'string' ? response.id : this.responseIDs.get(delegationId)) || delegationId;
      this.completedResponses.add(responseKey);
      this.continueResponse(responseKey);
      return;
    }
    if (event.type !== 'response.output_item.done' || !event.item || typeof event.item !== 'object') return;
    const item = object(event.item);
    if (item.type !== 'function_call' || typeof item.call_id !== 'string' || typeof item.name !== 'string') return;
    const id = item.call_id;
    if (this.pendingCalls.has(id) || this.completedCalls.has(id) || this.seenItems.has(id)) return;
    this.seenItems.add(id);
    const responseId = this.responseIDs.get(delegationId) || (typeof event.response_id === 'string' ? event.response_id : '');
    const responseKey = responseId || delegationId;
    this.pendingCalls.set(id, { delegationId, responseId });
    this.callResponses.set(id, responseKey);
    let calls = this.responseCalls.get(responseKey);
    if (!calls) this.responseCalls.set(responseKey, calls = new Set());
    calls.add(id);
    // Backend work belongs to the same addressed request even if a spoken backchannel has drained.
    // Resume that response identity before Voice checks permissions; this does not authorize a new turn.
    this.callbacks.responseStart(this.captionID);
    this.callbacks.tools([{ id, name: item.name, arguments: typeof item.arguments === 'string' ? item.arguments : '{}' }]);
  }

  private continueResponse(responseKey: string) {
    if (!responseKey || !this.completedResponses.has(responseKey) || this.continuedResponses.has(responseKey)) return;
    const calls = this.responseCalls.get(responseKey);
    if (!calls || [...calls].some(id => !this.completedCalls.has(id))) return;
    this.continuedResponses.add(responseKey);
    this.send({ type: 'response.create', event_id: this.eventID('continue') });
    this.responseCalls.delete(responseKey);
    this.completedResponses.delete(responseKey);
    for (const id of calls) this.callResponses.delete(id);
  }

  /** GPT-Live keeps producing quiet PCM while the mic runs. Gate only idle silence, preserving a 200ms preroll and 400ms tail. */
  private outputAudio(pcm: Buffer) {
    if (!pcm.length) return;
    if (pcm.length % 2) throw new Error('GPT-Live returned incomplete PCM samples.');
    let squares = 0;
    for (let offset = 0; offset < pcm.length; offset += 2) { const sample = pcm.readInt16LE(offset); squares += sample * sample; }
    const audible = squares > (pcm.length / 2) * 132 * 132;
    if (audible) {
      this.outputQuietMs = 0;
      if (!this.outputSpeaking) {
        this.outputSpeaking = true;
        for (const frame of this.preRoll) this.forwardAudio(frame);
        this.preRoll.length = 0; this.preRollBytes = 0;
      }
      this.forwardAudio(pcm);
    } else if (this.outputSpeaking && (this.outputQuietMs += pcm.length / 48) <= 400) this.forwardAudio(pcm);
    else {
      this.outputSpeaking = false;
      this.preRoll.push(pcm); this.preRollBytes += pcm.length;
      while (this.preRoll.length > 1 && this.preRollBytes > 9600) this.preRollBytes -= this.preRoll.shift()!.length;
      if (this.preRollBytes > 9600) { this.preRoll[0] = pcm.subarray(pcm.length - 9600); this.preRollBytes = 9600; }
    }
  }
  private forwardAudio(pcm: Buffer) {
    if (!this.responseActive) { this.responseActive = true; this.callbacks.responseStart(this.captionID); }
    this.outputQueued = true; this.playbackDrained = false; clearTimeout(this.playbackTimer); this.callbacks.audio(pcm);
  }
  private inputTranscript(event: Record<string, unknown>) {
    if (typeof event.delta !== 'string') return;
    const start = typeof event.start_ms === 'number' ? event.start_ms : null;
    if (!this.userId || (start !== null && this.userText && start - this.lastUserEnd > 1200)) {
      clearTimeout(this.userTimer);
      if (this.userId && this.userText) this.callbacks.userWords(this.userId, this.userText, true);
      if (this.responseActive && this.outputQueued) this.interrupt();
      this.captionID = crypto.randomUUID();
      this.userId = `gptlive-user-${crypto.randomUUID()}`;
      this.userText = '';
      this.callbacks.userTurn(this.userId);
    }
    if (typeof event.end_ms === 'number') this.lastUserEnd = event.end_ms;
    this.userText += event.delta;
    this.callbacks.userWords(this.userId, this.userText, false);
    clearTimeout(this.userTimer);
    const id = this.userId;
    this.userTimer = setTimeout(() => {
      if (this.userId !== id) return;
      this.callbacks.userWords(id, this.userText, true);
      this.userId = '';
      this.userText = '';
    }, USER_FRAGMENT_GAP_MS);
  }

  private lastUserEnd = 0;


  private handleError(event: Record<string, unknown>) {
    const error = event.error && typeof event.error === 'object' ? object(event.error) : {};
    const code = typeof error.code === 'string' ? error.code : '';
    const text = typeof error.message === 'string' ? error.message : 'The live request failed.';
    if (/interrupted|moderation|output_audio.*(?:blocked|stopped)/i.test(`${code} ${text}`)) this.interrupt();
    const fatal = /invalid_api_key|authentication|quota|rate.?limit|resource_exhausted/i.test(`${code} ${text}`);
    this.callbacks.error(friendlyLiveError(this.provider, text), fatal);
  }

  interrupt() {
    this.appendInstruction('The user has interrupted. Stop speaking immediately, listen, and respond to their new request when they finish.');
    this.responseActive = false;
    this.playbackDrained = false;
    this.outputQueued = false;
    this.captionID = crypto.randomUUID(); this.outputSpeaking = false; this.outputQuietMs = 0; this.preRoll.length = 0; this.preRollBytes = 0;
    clearTimeout(this.playbackTimer);
    this.callbacks.interrupted();
  }


  private appendInstruction(content: string) {
    if (this.connected) this.send({ type: 'session.instructions.append', event_id: this.eventID('instruction'), delegation_id: null, content });
  }

  private eventID(kind: string) { return `pip-${kind}-${++this.eventSequence}`; }
  private send(packet: Record<string, unknown>) { if (this.connected && !this.closing) this.sendOn(this.socket!, packet); }
  private sendOn(socket: WebSocket, packet: Record<string, unknown>) {
    if (socket.readyState === WebSocket.OPEN) {
      try { socket.send(JSON.stringify(packet)); }
      catch (error) { console.error(`Pip GPT-Live send: ${message(error)}`); }
    }
  }
}
