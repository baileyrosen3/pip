export type Packet = Record<string, unknown>;
export function packet(value: unknown): Packet {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a JSON packet.');
  return value as Packet;
}

/** Retain all packets for assertions, while each wait consumes only its matching packet. */
export class Messages {
  private packets: Packet[] = [];
  private consumed = new Set<Packet>();
  private pending = new Set<() => void>();
  private failure: Error | undefined;
  constructor(private typeKey: 't' | 'type') {}
  push(value: Packet) { this.packets.push(value); for (const check of [...this.pending]) check(); }
  messages(type?: string) { return this.packets.filter(value => type === undefined || value[this.typeKey] === type); }
  fail(error: Error) { this.failure = error; for (const check of [...this.pending]) check(); }
  waitFor(type: string, predicate: (value: Packet) => boolean = () => true, timeout = 2000): Promise<Packet> {
    const { promise, resolve, reject } = Promise.withResolvers<Packet>();
    const finish = (value?: Packet, error?: Error) => {
      clearTimeout(timer); this.pending.delete(check);
      if (error) reject(error); else resolve(value!);
    };
    const check = () => {
      try {
        const value = this.packets.find(value => !this.consumed.has(value) && value[this.typeKey] === type && predicate(value));
        if (value) { this.consumed.add(value); finish(value); }
        else if (this.failure) finish(undefined, this.failure);
      } catch (error) { finish(undefined, error instanceof Error ? error : new Error(String(error))); }
    };
    const timer = setTimeout(() => finish(undefined, new Error(`Timed out waiting for ${type}; received ${JSON.stringify(this.packets)}`)), timeout);
    this.pending.add(check); check();
    return promise;
  }
}
