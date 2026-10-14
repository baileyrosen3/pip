import { Messages, packet, type Packet } from './messages';

/** Real phone WebSocket: JSON controls, PCM16/24 kHz microphone frames, observable replies. */
export class Phone {
  private received = new Messages('t');
  readonly audio: Uint8Array[] = [];
  private closed: Promise<void>;
  private finishClose: () => void;
  private constructor(private socket: WebSocket) {
    const { promise, resolve } = Promise.withResolvers<void>();
    this.closed = promise; this.finishClose = resolve;
    socket.binaryType = 'arraybuffer';
    socket.onmessage = event => {
      try {
        if (typeof event.data === 'string') this.received.push(packet(JSON.parse(event.data)));
        else if (event.data instanceof ArrayBuffer) this.audio.push(new Uint8Array(event.data));
      } catch (error) { this.received.fail(error instanceof Error ? error : new Error(String(error))); }
    };
    socket.onclose = event => {
      this.received.fail(new Error(`Phone closed (${event.code}): ${event.reason}`));
      this.finishClose();
    };
    socket.onerror = () => this.received.fail(new Error('Phone WebSocket failed.'));
  }
  static async connect(url: string) {
    const socket = new WebSocket(url);
    const phone = new Phone(socket);
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    const opened = () => resolve();
    const failed = () => reject(new Error('Phone could not connect.'));
    socket.addEventListener('open', opened);
    socket.addEventListener('error', failed);
    socket.addEventListener('close', failed);
    const timer = setTimeout(() => reject(new Error('Phone connection timed out.')), 2000);
    try {
      await promise;
      phone.hello();
      return phone;
    } catch (error) { await phone.close(); throw error; }
    finally {
      clearTimeout(timer);
      socket.removeEventListener('open', opened);
      socket.removeEventListener('error', failed);
      socket.removeEventListener('close', failed);
    }
  }
  send(value: Packet) { this.socket.send(JSON.stringify(value)); }
  hello(name = 'Harness phone') { this.send({ t: 'hello', name, clientId: 'harness-phone' }); }
  wake() { this.send({ t: 'wake' }); }
  sleep() { this.send({ t: 'sleep' }); }
  askStart() { this.send({ t: 'askStart' }); }
  askEnd() { this.send({ t: 'askEnd' }); }
  streamPCM(samples: Int16Array | Uint8Array) {
    const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
    if (bytes.length % 2) throw new Error('Microphone PCM must contain complete 16-bit samples.');
    this.socket.send(bytes);
  }
  messages(type?: string) { return this.received.messages(type); }
  waitFor(type: string, predicate?: (value: Packet) => boolean, timeout?: number) { return this.received.waitFor(type, predicate, timeout); }
  async close() {
    if (this.socket.readyState === WebSocket.CLOSED) return;
    this.socket.close(1000);
    await this.closed;
  }
}
