import { chmodSync, existsSync, lstatSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { Listener, Socket } from 'bun';
import { message, object } from './config';
type ShellClient = { role: 'overlay' | 'bar' | null; buffer: string; decoder: TextDecoder };
type Pending = { socket: Socket<ShellClient>; timer: NodeJS.Timeout; resolve: (value: Record<string, unknown>) => void; reject: (reason: Error) => void };
const retained: Record<string, true> = { settings: true, status: true, monitor: true, mouse: true, mode: true, awake: true, brainMood: true, gaze: true, speechTarget: true, caption: true, dragging: true, report: true, activity: true };
export class Shell {
  readonly path = process.env.PIPCTL_SHELL_SOCKET || join(process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid?.() || 1000}`, 'pip', 'shell.sock');
  private listener: Listener<ShellClient> | undefined;
  private clients = new Set<Socket<ShellClient>>();
  private pending = new Map<string, Pending>();
  private state = new Map<string, Record<string, unknown>>();
  private overlay: Socket<ShellClient> | undefined;
  onEvent: (event: Record<string, unknown>, role: 'overlay' | 'bar') => void = () => {};
  onChange: () => void = () => {};
  get connected() { return !!this.overlay; }
  get barCount() { return [...this.clients].filter(s => s.data.role === 'bar').length; }
  async start() {
    mkdirSync(join(this.path, '..'), { recursive: true, mode: 0o700 });
    if (existsSync(this.path)) {
      if (!lstatSync(this.path).isSocket()) throw new Error(`Refusing to replace non-socket ${this.path}`);
      let active = false;
      try { const probe = await Bun.connect({ unix: this.path, socket: { data() {}, open(socket) { socket.end(); } } }); probe.end(); active = true; } catch {}
      if (active) throw new Error(`Pip is already listening on ${this.path}`);
      unlinkSync(this.path);
    }
    this.listener = Bun.listen<ShellClient>({ unix: this.path, socket: {
      open: socket => { socket.data = { role: null, buffer: '', decoder: new TextDecoder() }; this.clients.add(socket); },
      data: (socket, bytes) => {
        socket.data.buffer += socket.data.decoder.decode(bytes, { stream: true });
        if (socket.data.buffer.length > 2_000_000) { socket.end(); return; }
        let newline: number;
        while ((newline = socket.data.buffer.indexOf('\n')) >= 0) {
          const line = socket.data.buffer.slice(0, newline); socket.data.buffer = socket.data.buffer.slice(newline + 1);
          if (!line.trim()) continue;
          try { this.receive(socket, object(JSON.parse(line))); }
          catch (error) { socket.write(JSON.stringify({ op: 'error', message: message(error) }) + '\n'); }
        }
      },
      close: socket => {
        this.clients.delete(socket);
        for (const [id, pending] of this.pending) if (pending.socket === socket) { clearTimeout(pending.timer); pending.reject(new Error('The desktop overlay disconnected.')); this.pending.delete(id); }
        if (socket === this.overlay) this.overlay = [...this.clients].filter(s => s.data.role === 'overlay').at(-1);
        this.onChange();
      },
      error: (_socket, error) => console.error(`Pip shell: ${message(error)}`),
    } });
    chmodSync(this.path, 0o600);
  }
  private receive(socket: Socket<ShellClient>, event: Record<string, unknown>) {
    if (event.ev === 'hello') {
      if (socket.data.role || (event.role !== 'overlay' && event.role !== 'bar')) throw new Error('Send one hello with role overlay or bar.');
      socket.data.role = event.role;
      if (event.role === 'overlay') this.overlay = socket;
      for (const packet of this.state.values()) if (event.role === 'overlay' || ['settings', 'status', 'monitor', 'mouse', 'activity'].includes(String(packet.op))) socket.write(JSON.stringify(packet) + '\n');
      this.onChange(); return;
    }
    if (!socket.data.role) throw new Error('Send hello before shell messages.');
    if (typeof event.id === 'string') {
      const pending = this.pending.get(event.id);
      if (!pending || pending.socket !== socket) return;
      clearTimeout(pending.timer); this.pending.delete(event.id);
      if (event.ok === true) pending.resolve(event); else pending.reject(new Error(typeof event.error === 'string' ? event.error : 'Desktop overlay operation failed.'));
      return;
    }
    if (socket.data.role === 'overlay') {
      if (socket !== this.overlay) return;
      if (!['face', 'tip'].includes(String(event.ev))) throw new Error('Unknown overlay event.');
    } else if (!['ctl', 'settings', 'setKey', 'openNotes', 'pair'].includes(String(event.ev))) throw new Error('Unknown bar event.');
    this.onEvent(event, socket.data.role);
  }
  send(packet: Record<string, unknown>) {
    const op = String(packet.op);
    if (retained[op]) this.state.set(op, op === 'settings' ? { ...this.state.get(op), ...packet } : packet);
    if (op === 'fly') this.state.set('mode', { op: 'mode', mode: 'pinned', x: packet.x, y: packet.y });
    const line = JSON.stringify(packet) + '\n';
    let sent = false;
    for (const socket of this.clients) if (socket.data.role === 'overlay' || (socket.data.role === 'bar' && ['settings', 'status', 'monitor', 'mouse', 'talkTest', 'activity'].includes(op))) { socket.write(line); sent = true; }
    return sent;
  }
  request(op: string, fields: Record<string, unknown> = {}, timeout = 15_000) {
    const socket = this.overlay;
    if (!socket) return Promise.reject(new Error('The desktop overlay is not connected.'));
    const id = crypto.randomUUID(), { promise, resolve, reject } = Promise.withResolvers<Record<string, unknown>>();
    const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Desktop overlay ${op} timed out.`)); }, timeout);
    this.pending.set(id, { socket, timer, resolve, reject });
    const packet = { ...fields, op, id };
    if (op === 'fly') this.state.set('mode', { op: 'mode', mode: 'pinned', x: fields.x, y: fields.y });
    socket.write(JSON.stringify(packet) + '\n'); return promise;
  }
  stop() {
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('Pip is stopping.')); }
    this.pending.clear(); for (const socket of this.clients) socket.end(); this.clients.clear(); this.listener?.stop(true);
    if (existsSync(this.path)) unlinkSync(this.path);
  }
}
