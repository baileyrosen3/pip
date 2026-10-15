import { message, object } from './config';
import type { Configuration, OpenEndpoint } from './config';

export function pcmWav(pcm: Uint8Array) {
  const wav = Buffer.alloc(44 + pcm.length);
  wav.write('RIFF'); wav.writeUInt32LE(36 + pcm.length, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(24000, 24); wav.writeUInt32LE(48000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(pcm.length, 40); wav.set(pcm, 44); return wav;
}

/** WAV responses carry their own rate/channels; raw pcm is the API's PCM16/24 kHz contract. */
export function speechPCM(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 12 || new TextDecoder().decode(bytes.subarray(0, 4)) !== 'RIFF') {
    if (bytes.length % 2) throw new Error('TTS returned incomplete PCM16 audio.');
    return bytes;
  }
  let format = 0, channels = 0, rate = 0, bits = 0, audio: Uint8Array | undefined;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const id = new TextDecoder().decode(bytes.subarray(offset, offset + 4)), length = view.getUint32(offset + 4, true), start = offset + 8;
    if (id === 'fmt ' && length >= 16 && start + 16 <= bytes.length) {
      format = view.getUint16(start, true); channels = view.getUint16(start + 2, true); rate = view.getUint32(start + 4, true); bits = view.getUint16(start + 14, true);
    }
    if (id === 'data') { audio = bytes.subarray(start, Math.min(start + length, bytes.length)); break; }
    offset = start + length + (length % 2);
  }
  if (!audio || !channels || !rate || !((format === 1 && bits === 16) || (format === 3 && bits === 32))) throw new Error('TTS must return PCM16 or float32 WAV audio.');
  if (format === 1 && channels === 1 && rate === 24000) return audio.subarray(0, audio.length - audio.length % 2);
  const input = new DataView(audio.buffer, audio.byteOffset, audio.byteLength), stride = channels * bits / 8;
  const frames = Math.floor(audio.length / stride), count = Math.floor(frames * 24000 / rate), output = new Uint8Array(count * 2), target = new DataView(output.buffer);
  for (let i = 0; i < count; i++) {
    const position = i * rate / 24000, left = Math.floor(position), right = Math.min(left + 1, frames - 1), fraction = position - left;
    let value = 0;
    for (let c = 0; c < channels; c++) {
      const a = left * stride + c * bits / 8, b = right * stride + c * bits / 8;
      const first = format === 1 ? input.getInt16(a, true) : input.getFloat32(a, true) * 32767;
      const second = format === 1 ? input.getInt16(b, true) : input.getFloat32(b, true) * 32767;
      value += first + (second - first) * fraction;
    }
    target.setInt16(i * 2, Math.max(-32768, Math.min(32767, Math.round(value / channels))), true);
  }
  return output;
}

export class OpenClients {
  constructor(private config: Configuration) {}
  async request(endpoint: OpenEndpoint, path: string, body: FormData | Record<string, unknown>, signal: AbortSignal) {
    const settings = this.config.settings.open[endpoint], key = this.config.openKey(endpoint);
    try {
      const response = await fetch(settings.baseUrl + path, {
        method: 'POST', headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}), ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }) },
        body: body instanceof FormData ? body : JSON.stringify(body), signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}${response.status === 401 || response.status === 403 ? ' (check the endpoint key)' : ''}`);
      return response;
    } catch (error) {
      if (signal.aborted) throw error;
      const service = endpoint === 'llm' ? 'LLM' : endpoint === 'stt' ? 'speech-to-text' : 'text-to-speech';
      const local = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(settings.baseUrl).hostname);
      const fix = local ? endpoint === 'llm' ? `Start Ollama: OLLAMA_VULKAN=1 OLLAMA_IGPU_ENABLE=1 OLLAMA_CONTEXT_LENGTH=16384 ollama serve; pull the model: ollama pull ${settings.model}.` : 'Start Speaches: docker start pip-open-speaches (see README Open brain setup).' : 'Check its base URL, model and optional API key in Brain → Advanced.';
      throw new Error(`Open ${service} service unavailable (${message(error)}). ${fix}`);
    }
  }
  async transcribe(pcm: Uint8Array, signal: AbortSignal) {
    const form = new FormData(); form.set('model', this.config.settings.open.stt.model); form.set('response_format', 'json');
    form.set('file', new File([pcmWav(pcm)], 'turn.wav', { type: 'audio/wav' }));
    const json = object(await (await this.request('stt', '/audio/transcriptions', form, signal)).json());
    if (typeof json.text !== 'string') throw new Error('Open speech-to-text returned no transcription text.');
    return json.text.trim();
  }
  async *chat(messages: Record<string, unknown>[], tools: Record<string, unknown>[], signal: AbortSignal) {
    const settings = this.config.settings.open.llm;
    const response = await this.request('llm', '/chat/completions', { model: settings.model, messages, tools, stream: true }, signal);
    if (!response.body) throw new Error('Open LLM returned no chat stream.');
    const reader = response.body.getReader(), decoder = new TextDecoder(); let pending = '';
    try {
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        pending += decoder.decode(value, { stream: true });
        let end: number;
        while ((end = pending.indexOf('\n')) !== -1) {
          const line = pending.slice(0, end).trim(); pending = pending.slice(end + 1);
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim(); if (data === '[DONE]') return;
          const packet = object(JSON.parse(data));
          if (packet.error) throw new Error('Open LLM rejected the chat request. Check the model and tools support.');
          if (!Array.isArray(packet.choices)) continue;
          for (const raw of packet.choices) { const choice = object(raw); if (choice.delta) yield object(choice.delta); }
        }
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
  async speech(text: string, signal: AbortSignal) {
    const settings = this.config.settings.open.tts;
    const response = await this.request('tts', '/audio/speech', { model: settings.model, voice: settings.voice, input: text, response_format: 'wav' }, signal);
    return speechPCM(new Uint8Array(await response.arrayBuffer()));
  }
}
