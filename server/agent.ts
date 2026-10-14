import { existsSync } from 'node:fs';
import type { Subprocess } from 'bun';
import { agentPath, repoRoot, message, object } from './config';

export type Monitor = { name: string; x: number; y: number; width: number; height: number; scale: number };
export function parseMonitor(value: unknown): Monitor {
  const m = object(value);
  if (typeof m.name !== 'string' || !['x', 'y', 'width', 'height', 'scale'].every(k => typeof m[k] === 'number' && Number.isFinite(m[k])) || Number(m.scale) <= 0 || Number(m.width) <= 0 || Number(m.height) <= 0) throw new Error('Invalid monitor geometry.');
  return { name: m.name, x: Number(m.x), y: Number(m.y), width: Number(m.width), height: Number(m.height), scale: Number(m.scale) };
}
export class Agent {
  private child: Subprocess<'pipe', 'pipe', 'inherit'> | null = null;
  private pending = new Map<string, { resolve: (value: Record<string, unknown>) => void; reject: (reason: Error) => void; timer: NodeJS.Timeout }>();
  private restart: NodeJS.Timeout | undefined;
  private attempt = 0;
  private stopped = false;
  ready = false;
  monitor: Monitor | null = null;
  onEvent: (event: Record<string, unknown>) => void = () => {};
  start() {
    if (this.stopped) return;
    if (!existsSync(agentPath)) { console.error('Pip: desktop agent is not installed yet; retrying.'); this.schedule(); return; }
    try {
      const child = Bun.spawn(['python3', agentPath, '--no-overlay'], { stdin: 'pipe', stdout: 'pipe', stderr: 'inherit', cwd: repoRoot, env: process.env });
      this.child = child;
      this.readLines(child.stdout).catch(error => console.error(`Pip agent stream: ${message(error)}`));
      child.exited.then(code => {
        if (this.child !== child) return;
        this.child = null; this.ready = false;
        for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(new Error('The desktop agent disconnected.')); }
        this.pending.clear();
        // Exit 78 = the helper is missing system packages (it printed which). Retry quietly once a minute so
        // Pip picks the helper up after the user installs them, without filling the log.
        if (!this.stopped && code === 78) { if (!this.missingDependencies) console.error('Pip: desktop agent is missing packages; retrying every minute.'); this.missingDependencies = true; this.schedule(60_000); }
        else if (!this.stopped) { this.missingDependencies = false; console.error(`Pip: desktop agent exited ${code}; restarting.`); this.schedule(); }
      });
    } catch (error) { console.error(`Pip: starting agent: ${message(error)}`); this.schedule(); }
  }
  private missingDependencies = false;
  private schedule(fixedDelay?: number) {
    if (this.stopped || this.restart) return;
    const delay = fixedDelay ?? Math.min(30_000, 1000 * 2 ** Math.min(this.attempt++, 5));
    this.restart = setTimeout(() => { this.restart = undefined; this.start(); }, delay);
  }
  private async readLines(stream: ReadableStream<Uint8Array>) {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index: number;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
        if (!line.trim()) continue;
        try {
          const event = object(JSON.parse(line));
          if (typeof event.id === 'string' && this.pending.has(event.id)) {
            const request = this.pending.get(event.id)!; this.pending.delete(event.id); clearTimeout(request.timer);
            if (event.ok === true) request.resolve(event);
            else request.reject(new Error(typeof event.error === 'string' ? event.error : 'Desktop operation failed.'));
          } else if (!('id' in event)) {
            if (event.ev === 'ready') { this.ready = true; this.attempt = 0; }
            if (event.ev === 'ready' || event.ev === 'monitor') this.monitor = parseMonitor(event.monitor);
            this.onEvent(event);
          }
        } catch (error) { console.error(`Pip agent packet: ${message(error)}`); }
      }
      if (buffer.length > 2_000_000) throw new Error('Desktop agent line exceeds the protocol limit.');
    }
  }
  send(packet: Record<string, unknown>) {
    const input = this.child?.stdin;
    if (!input || typeof input === 'number') return false;
    try { input.write(JSON.stringify(packet) + '\n'); input.flush(); return true; }
    catch { return false; }
  }
  request(op: string, fields: Record<string, unknown> = {}, timeout = 15_000): Promise<Record<string, unknown>> {
    if (!this.ready) return Promise.reject(new Error('The desktop agent is not ready.'));
    const id = crypto.randomUUID();
    const { promise, resolve, reject } = Promise.withResolvers<Record<string, unknown>>();
    const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Desktop operation ${op} timed out.`)); }, timeout);
    this.pending.set(id, { resolve, reject, timer });
    if (!this.send({ ...fields, op, id })) { clearTimeout(timer); this.pending.delete(id); reject(new Error('The desktop agent is disconnected.')); }
    return promise;
  }
  stop() {
    this.stopped = true;
    clearTimeout(this.restart);
    this.send({ op: 'quit' });
    const child = this.child;
    if (child) setTimeout(() => { if (this.child === child) child.kill(); }, 1000);
  }
}
