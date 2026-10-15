import { Messages, packet } from './messages';

/** Actual HTTP/SSE boundary, no provider internals replaced. */
export function mockOpen(options: { transcript?: string | string[]; screen?: boolean; slow?: boolean; blockFirstSTT?: boolean; speechWav?: boolean; down?: 'stt' | 'llm' | 'tts' } = {}) {
  const requests = new Messages('type');
  let chats = 0, stts = 0, cancelled = false;
  const continuation = Promise.withResolvers<void>();
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path.endsWith('/models')) return Response.json({ data: [{ id: 'fixture' }] });
    if (path.endsWith('/audio/transcriptions')) {
      const form = await request.formData();
      requests.push({ type: 'stt', file: form.get('file'), model: form.get('model') });
      if (options.blockFirstSTT && stts++ === 0) await continuation.promise;
      if (options.down === 'stt') return new Response('unavailable', { status: 503 });
      return Response.json({ text: Array.isArray(options.transcript) ? options.transcript.shift() ?? '' : options.transcript ?? 'Pip, hello there.' });
    }
    if (path.endsWith('/audio/speech')) {
      requests.push({ type: 'tts', ...packet(await request.json()) });
      if (options.down === 'tts') return new Response('unavailable', { status: 503 });
      if (options.speechWav) {
        // Independent fixture: 100 ms of stereo, 48 kHz PCM16 (not phone format).
        const wav = Buffer.alloc(44 + 19200); wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4);
        wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22);
        wav.writeUInt32LE(48000, 24); wav.writeUInt32LE(192000, 28); wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34);
        wav.write('data', 36); wav.writeUInt32LE(19200, 40);
        for (let offset = 44; offset < wav.length; offset += 2) wav.writeInt16LE(800, offset);
        return new Response(wav, { headers: { 'Content-Type': 'audio/wav' } });
      }
      return new Response(new Int16Array(2400).fill(800), { headers: { 'Content-Type': 'audio/pcm' } });
    }
    if (path.endsWith('/chat/completions')) {
      const body = packet(await request.json()); requests.push({ type: 'chat', ...body });
      if (options.down === 'llm') return new Response('unavailable', { status: 503 });
      const tool = options.screen && chats++ === 0;
      const stream = new ReadableStream<Uint8Array>({ async start(controller) {
        const send = (delta: Record<string, unknown>) => controller.enqueue(new TextEncoder().encode('data: ' + JSON.stringify({ choices: [{ delta }] }) + '\n\n'));
        try {
          if (tool) {
            send({ tool_calls: [{ index: 0, id: 'screen-1', type: 'function', function: { name: 'look_at_screen', arguments: '{' } }] });
            send({ tool_calls: [{ index: 0, function: { arguments: '}' } }] });
          }
          else {
            send({ content: 'Hello' });
            if (options.slow) await continuation.promise;
            send({ content: ' there.' });
          }
          controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n')); controller.close();
        } catch { cancelled = true; }
        finally { requests.push({ type: 'streamDone' }); }
      }, cancel() { cancelled = true; } });
      return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
    }
    return new Response('Not found', { status: 404 });
  } });
  const baseURL = `http://127.0.0.1:${server.port}/v1`;
  return { kind: 'open' as const, baseURL, settings: { stt: { baseUrl: baseURL, model: 'fixture' }, llm: { baseUrl: baseURL, model: 'fixture' }, tts: { baseUrl: baseURL, model: 'fixture', voice: 'af_heart' } }, requests, release: continuation.resolve, get cancelled() { return cancelled; }, stop() { continuation.resolve(); server.stop(true); } };
}
