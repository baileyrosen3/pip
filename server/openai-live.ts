import { Configuration, message, object, openaiBase } from './config';
import { model, realtimeSession } from './session';
import { friendlyLiveError, liveMessage } from './live-provider';
import type { AudioItem, LiveCallbacks, LiveProvider, PlaybackItem, ToolCall, ToolOutput } from './live-provider';
export class OpenAILive implements LiveProvider {
  readonly provider = 'openai' as const;
  private socket: WebSocket | null = null;
  private timeout: NodeJS.Timeout | undefined;
  private signature = '';
  private connectionKey = '';
  private messages: Promise<void> = Promise.resolve();
  private connectionVoice = '';
  private connectionSpeech = false;
  private responding = false;
  private interruptedResponse = false;
  private audioItems = new Map<string, { item: AudioItem; durationMs: number; playedMs: number }>();
  private lastAudio: { item: AudioItem; durationMs: number; playedMs: number } | undefined;
  private truncating = new Set<string>();
  constructor(private config: Configuration, private callbacks: LiveCallbacks) {}
  get connected() { return this.socket?.readyState === WebSocket.OPEN; }
  connect(context: string) {
    this.close(false);
    const url = new URL(openaiBase.replace(/^http/, 'ws') + '/realtime'); url.searchParams.set('model', model);
    this.connectionKey = this.config.key('openai'); this.connectionVoice = this.config.settings.voiceName; this.connectionSpeech = this.config.settings.voice;
    const socket = new WebSocket(url.href, { headers: { Authorization: `Bearer ${this.connectionKey}` } });
    this.socket = socket; socket.binaryType = 'arraybuffer';
    this.timeout = setTimeout(() => { if (this.socket === socket && !this.connected) socket.close(); }, 20_000);
    socket.onopen = () => {
      if (this.socket !== socket) return;
      clearTimeout(this.timeout); this.signature = '';
      this.configure();
      if (context) this.send({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: "(Context: what I said earlier in this session, from my notes. Don't reply to this.)\n" + context }] } });
      this.callbacks.ready(false);
    };
    socket.onmessage = event => {
      this.messages = this.messages.then(async () => { if (this.socket !== socket) return; const packet = await liveMessage(event.data); if (this.socket === socket) this.handle(packet); }).catch(error => console.error(`Pip OpenAI frame: ${message(error)}`));
    };
    socket.onerror = () => { if (this.socket === socket) console.error('Pip: OpenAI live connection error.'); };
    socket.onclose = event => { if (this.socket !== socket) return; this.socket = null; clearTimeout(this.timeout); this.callbacks.disconnected(event.code, event.reason); };
  }
  close(_reset: boolean) {
    clearTimeout(this.timeout); const socket = this.socket; this.socket = null; socket?.close(1000);
    this.responding = false; this.interruptedResponse = false; this.audioItems.clear(); this.truncating.clear(); this.lastAudio = undefined;
  }
  configure() {
    if (this.connectionKey && (this.connectionKey !== this.config.key('openai') || this.connectionVoice !== this.config.settings.voiceName || this.connectionSpeech !== this.config.settings.voice)) return true;
    const session = realtimeSession(this.config.settings), signature = JSON.stringify(session);
    if (signature !== this.signature && this.connected) { this.signature = signature; this.send({ type: 'session.update', session }); }
    return false;
  }
  audio(bytes: Uint8Array) { this.send({ type: 'input_audio_buffer.append', audio: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64') }); }
  beginAsk() { if (this.config.settings.voice) this.interruptOutput(true); }
  playback(_on: boolean, items?: PlaybackItem[]) {
    for (const progress of items || []) {
      const audio = this.audioItems.get(progress.id) || (this.lastAudio?.item.id === progress.id ? this.lastAudio : undefined);
      if (!audio || audio.item.index !== progress.index) continue;
      audio.playedMs = Math.min(audio.durationMs, Math.round(progress.playedMs));
      if (this.truncating.delete(progress.id) && audio.playedMs < audio.durationMs) {
        this.send({ type: 'conversation.item.truncate', item_id: progress.id, content_index: progress.index, audio_end_ms: audio.playedMs });
      }
      if (audio.playedMs >= audio.durationMs) this.audioItems.delete(progress.id);
    }
  }
  private interruptOutput(cancel: boolean) {
    if (!this.responding && !this.audioItems.size) return;
    for (const id of this.audioItems.keys()) this.truncating.add(id);
    this.interruptedResponse = true;
    if (cancel && this.responding) this.send({ type: 'response.cancel' });
    this.callbacks.interrupted();
  }
  endAsk(responseActive: boolean) { this.send({ type: 'input_audio_buffer.commit' }); if (!responseActive) this.respond(); }
  respond() { this.send({ type: 'response.create' }); }
  sayHi() { this.send({ type: 'response.create', response: { instructions: 'Reply with a quick, cheerful hi in under eight words.' } }); }
  async toolResults(results: ToolOutput[]) {
    for (const result of results) this.send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: result.id, output: result.text } });
    for (const result of results) if (result.image) this.send({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_image', image_url: 'data:image/jpeg;base64,' + result.image }] } });
    this.respond();
  }
  private send(packet: Record<string, unknown>) {
    if (this.connected) { try { this.socket!.send(JSON.stringify(packet)); } catch (error) { console.error(`Pip OpenAI send: ${message(error)}`); } }
  }
  private handle(event: Record<string, unknown>) {
    switch (event.type) {
      case 'response.created': this.responding = true; this.interruptedResponse = false; this.callbacks.responseStart(); break;
      case 'response.output_audio.delta': {
        if (this.interruptedResponse || typeof event.delta !== 'string') break;
        const pcm = Buffer.from(event.delta, 'base64');
        let item: AudioItem | undefined;
        if (typeof event.item_id === 'string') {
          const index = typeof event.content_index === 'number' ? event.content_index : 0;
          let audio = this.audioItems.get(event.item_id) || (this.lastAudio?.item.id === event.item_id && this.lastAudio.item.index === index ? this.lastAudio : undefined);
          if (!audio) audio = { item: { id: event.item_id, index }, durationMs: 0, playedMs: 0 };
          audio.durationMs += pcm.length / 48; this.audioItems.set(event.item_id, audio); this.lastAudio = audio; item = audio.item;
        }
        this.callbacks.audio(pcm, item); break;
      }
      case 'response.output_text.delta':
      case 'response.output_audio_transcript.delta': if (!this.interruptedResponse && typeof event.delta === 'string') this.callbacks.text(event.delta); break;
      case 'input_audio_buffer.speech_started': if (this.config.settings.voice) this.interruptOutput(false); break;
      case 'response.cancelled': if (!this.interruptedResponse) this.interruptOutput(false); break;
      case 'input_audio_buffer.committed': if (typeof event.item_id === 'string') this.callbacks.userTurn(event.item_id); break;
      case 'conversation.item.input_audio_transcription.completed': if (typeof event.item_id === 'string' && typeof event.transcript === 'string') this.callbacks.userWords(event.item_id, event.transcript, true); break;
      case 'response.done': {
        this.responding = false;
        const response = event.response ? object(event.response) : {};
        if (response.status === 'cancelled' && !this.interruptedResponse) this.interruptOutput(false);
        if (response.status === 'failed') {
          const details = response.status_details ? object(response.status_details) : {}, error = details.error ? object(details.error) : {};
          this.callbacks.error(friendlyLiveError('openai', typeof error.message === 'string' ? error.message : 'Could not finish the reply.'), false);
        }
        const calls: ToolCall[] = [];
        if (response.status !== 'cancelled' && response.status !== 'failed' && Array.isArray(response.output)) for (const raw of response.output) {
          const call = object(raw);
          if (call.type === 'function_call' && typeof call.call_id === 'string' && typeof call.name === 'string') calls.push({ id: call.call_id, name: call.name, arguments: typeof call.arguments === 'string' ? call.arguments : '{}' });
        }
        // Keep finishIfQuiet behind the pending-tool counter, as in the original Realtime bridge.
        if (calls.length) this.callbacks.tools(calls);
        this.callbacks.responseDone(); break;
      }
      case 'error': {
        const error = event.error ? object(event.error) : {};
        if (error.code === 'input_audio_buffer_commit_empty') { this.callbacks.emptyCommit(); break; }
        if (error.code === 'conversation_already_has_active_response') break;
        const text = typeof error.message === 'string' ? error.message : 'The live request failed.';
        const fatal = error.code === 'invalid_api_key' || /quota|rate.?limit|resource_exhausted/i.test(String(error.code));
        this.callbacks.error(friendlyLiveError('openai', text), fatal); break;
      }
    }
  }
}
