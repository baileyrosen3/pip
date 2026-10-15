import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** First Chromium-family browser on PATH, or null. */
export function findBrowser(): string | null {
  for (const name of ['chromium', 'chromium-browser', 'google-chrome-stable', 'google-chrome']) {
    const path = Bun.which(name);
    if (path) return path;
  }
  return null;
}

type CdpMessage = { id?: number; method?: string; params?: Record<string, unknown>; result?: Record<string, unknown>; error?: { message: string } };

/** A headless phone-sized browser page driven over the Chrome DevTools Protocol, with no npm dependencies.
 * Collects uncaught page exceptions and console errors so tests can assert the phone app starts cleanly. */
export class BrowserPage {
  readonly errors: string[] = [];
  private nextId = 1;
  private pending = new Map<number, { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void }>();
  private constructor(private process: ChildProcess, private profile: string, private socket: WebSocket) {
    socket.onmessage = event => {
      const message = JSON.parse(String(event.data)) as CdpMessage;
      if (message.id !== undefined) {
        const waiter = this.pending.get(message.id); this.pending.delete(message.id);
        if (message.error) waiter?.reject(new Error(message.error.message)); else waiter?.resolve(message.result ?? {});
        return;
      }
      if (message.method === 'Runtime.exceptionThrown') {
        const details = message.params?.exceptionDetails as { text?: string; exception?: { description?: string } } | undefined;
        this.errors.push(details?.exception?.description ?? details?.text ?? 'Uncaught exception');
      }
      if (message.method === 'Runtime.consoleAPICalled' && message.params?.type === 'error') {
        const args = (message.params.args as { value?: unknown; description?: string }[] | undefined) ?? [];
        this.errors.push(args.map(arg => String(arg.value ?? arg.description ?? '')).join(' '));
      }
    };
  }

  static async open(executable: string): Promise<BrowserPage> {
    const profile = mkdtempSync(join(tmpdir(), 'pip-browser-'));
    const child = spawn(executable, [
      '--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
    ], { stdio: 'ignore' });
    const portFile = join(profile, 'DevToolsActivePort');
    for (let i = 0; i < 200 && !existsSync(portFile); i++) await Bun.sleep(50);
    if (!existsSync(portFile)) { child.kill('SIGKILL'); rmSync(profile, { recursive: true, force: true }); throw new Error('Browser did not start.'); }
    const port = readFileSync(portFile, 'utf8').split('\n')[0];
    let targets: { type: string; webSocketDebuggerUrl: string }[] = [];
    for (let i = 0; i < 100 && !targets.some(target => target.type === 'page'); i++) {
      targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() as typeof targets;
      if (!targets.some(target => target.type === 'page')) await Bun.sleep(50);
    }
    const page = targets.find(target => target.type === 'page');
    if (!page) throw new Error('Browser has no page target.');
    const socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => { socket.onopen = () => resolve(); socket.onerror = () => reject(new Error('DevTools connection failed.')); });
    const browser = new BrowserPage(child, profile, socket);
    await browser.send('Runtime.enable');
    await browser.send('Page.enable');
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
    await browser.send('Emulation.setTouchEmulationEnabled', { enabled: true });
    return browser;
  }

  send(method: string, params: Record<string, unknown> = {}) {
    const id = this.nextId++;
    const { promise, resolve, reject } = Promise.withResolvers<Record<string, unknown>>();
    this.pending.set(id, { resolve, reject });
    this.socket.send(JSON.stringify({ id, method, params }));
    return promise;
  }

  async goto(url: string) { await this.send('Page.navigate', { url }); }

  /** Evaluates an expression in the page and returns its JSON-serialisable value. */
  async evaluate(expression: string): Promise<unknown> {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    const value = result.result as { value?: unknown } | undefined;
    return value?.value;
  }

  async waitFor(expression: string, timeout = 10_000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (await this.evaluate(expression) === true) return;
      await Bun.sleep(100);
    }
    throw new Error(`Timed out waiting for: ${expression}\nPage errors: ${this.errors.join('\n') || 'none'}`);
  }

  async close() {
    try { this.socket.close(); } catch {}
    this.process.kill('SIGKILL');
    await new Promise(resolve => { if (this.process.exitCode !== null || this.process.signalCode !== null) resolve(null); else this.process.once('exit', resolve); });
    rmSync(this.profile, { recursive: true, force: true });
  }
}
