import type { ServerWebSocket } from 'bun';
import { Messages, packet, type Packet } from './messages';

export type BrainKind = 'openai' | 'gemini' | 'gptlive';
type Connection = { audioBytes: number; turn: number };
export type BrainScript = {
  reply?: string;
  transcript?: string;
  /** Exercise managed Responses delegation, with lifecycle output deliberately empty. */
  delegatedScreen?: boolean;
  /** Return true to replace the default protocol handling, e.g. to script tools or a close. */
  onMessage?: (message: Packet, socket: ServerWebSocket<Connection>) => boolean | void;
  onRequest?: (request: Request) => Response | Promise<Response> | undefined;
};
export interface MockBrain {
  kind: BrainKind;
  baseURL: string;
  messages(type?: string): Packet[];
  waitFor(type: string, predicate?: (value: Packet) => boolean, timeout?: number): Promise<Packet>;
  send(value: Packet): void;
  stop(): Promise<void>;
}

/** Local wire-protocol brain; received packets and send() also support custom scenarios. */
export function mockBrain(kind: BrainKind, script: BrainScript = {}): MockBrain {
  const received = new Messages('type');
  const sockets = new Set<ServerWebSocket<Connection>>();
  const reply = script.reply ?? 'Hello from Pip.';
  const transcript = script.transcript ?? 'Pip, say hello.';
  const send = (socket: ServerWebSocket<Connection>, value: Packet) => { socket.send(JSON.stringify(value)); };
  const answer = (socket: ServerWebSocket<Connection>) => {
    if (!socket.data.audioBytes) return;
    socket.data.audioBytes = 0;
    const id = `mock-turn-${++socket.data.turn}`;
    if (kind === 'openai') {
      send(socket, { type: 'input_audio_buffer.committed', item_id: id });
      send(socket, { type: 'conversation.item.input_audio_transcription.completed', item_id: id, transcript });
      send(socket, { type: 'response.created', response: { id: `reply-${id}` } });
      send(socket, { type: 'response.output_audio_transcript.delta', delta: reply });
      send(socket, { type: 'response.done', response: { status: 'completed', output: [] } });
    } else if (kind === 'gemini') {
      send(socket, { serverContent: { inputTranscription: { text: transcript } } });
      send(socket, { serverContent: { outputTranscription: { text: reply } } });
      send(socket, { serverContent: { generationComplete: true, turnComplete: true } });
    } else {
      send(socket, { type: 'session.input_transcript.delta', delta: transcript, start_ms: 0, end_ms: 100 });
      if (script.delegatedScreen) {
        send(socket, { type: 'session.delegation.created', delegation: { id: 'mock-delegation', target: 'responses', response_id: 'mock-response' } });
        send(socket, { type: 'response.event', delegation_id: 'mock-delegation', event: { type: 'response.created', response: { id: 'mock-response' } } });
        send(socket, { type: 'response.event', delegation_id: 'mock-delegation', event: { type: 'response.output_item.done', item: { type: 'function_call', call_id: 'mock-screen-call', name: 'look_at_screen', arguments: '{}' } } });
        send(socket, { type: 'response.event', delegation_id: 'mock-delegation', event: { type: 'response.completed', response: { id: 'mock-response', output: [] } } });
        return;
      }
      send(socket, { type: 'session.output_transcript.delta', delta: reply });
      // GPT-Live finishes a caption after the phone's playback drains; no response.done frame.
    }
  };
  const server = Bun.serve<Connection>({
    hostname: '127.0.0.1', port: 0,
    async fetch(request, server) {
      if (request.headers.get('upgrade')?.toLowerCase() === 'websocket') {
        if (server.upgrade(request, { data: { audioBytes: 0, turn: 0 } })) return;
      }
      // Recording/transcription also stays local on revisions where meeting notes default on.
      const path = new URL(request.url).pathname;
      const scripted = script.onRequest?.(request);
      if (scripted !== undefined) return scripted;
      if (request.method === 'POST' && path.endsWith('/audio/transcriptions')) {
        await request.arrayBuffer();
        return Response.json({ segments: [] });
      }
      if (request.method === 'POST' && path.endsWith(':generateContent')) {
        await request.arrayBuffer();
        return Response.json({ candidates: [{ content: { parts: [{ text: '{"segments":[]}' }] } }] });
      }
      return new Response('Unknown mock brain route', { status: 404 });
    },
    websocket: {
      open(socket) {
        sockets.add(socket);
        if (kind === 'openai') send(socket, { type: 'session.created', session: { id: 'mock-session' } });
      },
      message(socket, raw) {
        try {
          const value = packet(JSON.parse(typeof raw === 'string' ? raw : raw.toString()));
          // Gemini packets have no type discriminator; give journal entries their wire envelope name.
          received.push(kind === 'gemini' ? { ...value, type: Object.keys(value)[0] } : value);
          if (script.onMessage?.(value, socket) === true) return;
          if (kind === 'openai') {
            if (value.type === 'session.update') send(socket, { type: 'session.updated', session: value.session });
            if (value.type === 'input_audio_buffer.append' && typeof value.audio === 'string') socket.data.audioBytes += Buffer.from(value.audio, 'base64').length;
            if (value.type === 'input_audio_buffer.commit') answer(socket);
          } else if (kind === 'gemini') {
            if (value.setup) send(socket, { setupComplete: {} });
            if (value.realtimeInput) {
              const input = packet(value.realtimeInput);
              if (input.audio) {
                const audio = packet(input.audio);
                if (typeof audio.data === 'string') socket.data.audioBytes += Buffer.from(audio.data, 'base64').length;
              }
              if (input.activityEnd || input.audioStreamEnd) answer(socket);
            }
            if (value.clientContent && packet(value.clientContent).turnComplete) answer(socket);
          } else {
            if (value.type === 'session.start') send(socket, { type: 'session.started', session: { id: 'mock-session' } });
            if (value.type === 'session.input_audio.append' && typeof value.audio === 'string') socket.data.audioBytes += Buffer.from(value.audio, 'base64').length;
            if (value.type === 'session.instructions.append' && typeof value.content === 'string' && /finished holding|Respond to the user/.test(value.content)) answer(socket);
            if (script.delegatedScreen && value.type === 'response.create') {
              const output = received.messages('response.item.create').some(entry => packet(entry.item).type === 'function_call_output');
              const image = received.messages('response.item.create').some(entry => packet(entry.item).type === 'message');
              if (!output || !image) throw new Error('Continuation requires a tool result and backend image.');
              send(socket, { type: 'session.output_audio.delta', delta: Buffer.from(new Int16Array(2400).fill(2000).buffer).toString('base64') });
              send(socket, { type: 'session.output_transcript.delta', delta: reply });
            }
            if (value.type === 'session.close') send(socket, { type: 'session.closed', session: { id: 'mock-session' } });
          }
        } catch (error) {
          received.fail(error instanceof Error ? error : new Error(String(error)));
          socket.close(1011, 'Mock brain script failed');
        }
      },
      close(socket) { sockets.delete(socket); },
    },
  });
  return {
    kind, baseURL: `http://127.0.0.1:${server.port}`,
    messages: received.messages.bind(received), waitFor: received.waitFor.bind(received),
    send(value: Packet) { for (const socket of sockets) send(socket, value); },
    async stop() {
      received.fail(new Error('Mock brain stopped.'));
      for (const socket of sockets) socket.close(1000);
      await server.stop(true);
    },
  };
}
