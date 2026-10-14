import { spawn } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import type { MockBrain } from './brain';
import { Phone } from './phone';
import { installDesktop } from './desktop';

export interface ChecksFixture {
  commands: Record<string, string | null | (string | null)[]>;
  path?: string;
  writable?: string[];
  executable?: string[];
}
export interface ServerOptions {
  brain: Pick<MockBrain, 'kind' | 'baseURL'>;
  /** Real-API smokes supply env keys explicitly; only temp secrets are written. */
  keys?: { openai?: string; gemini?: string };
  desktop?: 'fake';
  /** Additional saved settings; null starts without a saved settings file. */
  settings?: Record<string, unknown> | null;
  /** Inject scenario-specific env, but isolation paths and mock brain URLs cannot be overridden. */
  env?: Record<string, string>;
  checks?: ChecksFixture;
}
export interface PipServer {
  url: string;
  pid: number;
  root: string;
  configDir: string;
  notesDir: string;
  shellSocket: string;
  logs(): string;
  phone(): Promise<Phone>;
  request(path: string, init?: RequestInit): Promise<Response>;
  stop(): Promise<void>;
}

/** Owns a detached process group, temp HOME/XDG paths and every connected test phone.
 * Use afterAll(() => pip.stop()), then brain.stop(); no installed desktop services are needed.
 * PATH only exposes Python and optional ffmpeg, never the real hyprctl/tailscale binaries.
 */
export async function startServer(options: ServerOptions): Promise<PipServer> {
  const root = mkdtempSync(join(tmpdir(), 'pip-harness-'));
  const home = join(root, 'home'), configDir = join(root, 'config'), notesDir = join(root, 'notes');
  const runtime = join(root, 'runtime'), bin = join(root, 'bin'), shellSocket = join(runtime, 'shell.sock');
  for (const path of [home, configDir, notesDir, runtime, bin]) mkdirSync(path, { recursive: true, mode: 0o700 });
  chmodSync(root, 0o700);
  // Run the actual helper: without a Hyprland socket it exits before opening /dev/uinput.
  for (const name of options.desktop === 'fake' ? ['ffmpeg'] : ['python3', 'ffmpeg']) {
    const executable = Bun.which(name);
    if (executable) symlinkSync(executable, join(bin, name));
  }
  if (options.desktop === 'fake') {
    try { installDesktop(bin); }
    catch (error) { rmSync(root, { recursive: true, force: true }); throw error; }
  }
  const token = '1'.repeat(64);
  writeFileSync(join(configDir, 'secrets.json'), JSON.stringify({ openaiKey: options.keys?.openai ?? 'mock-openai-key', geminiKey: options.keys?.gemini ?? 'mock-gemini-key', pairToken: token }), { mode: 0o600 });
  if (options.settings !== null) {
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({
      provider: options.brain.kind, replyMode: 'hold', computerControl: false, meetingNotes: false,
      tailscaleServe: false, ...options.settings,
    }), { mode: 0o600 });
  }
  const checksModule = join(root, 'checks-environment.mjs');
  if (options.checks) writeFileSync(checksModule, `
    const fixture = ${JSON.stringify(options.checks)};
    export default {
      path: fixture.path || '/fixture/bin',
      async run(args) {
        const response = fixture.commands[args.join(' ')];
        const value = Array.isArray(response) ? (response.length > 1 ? response.shift() : response[0]) : response;
        if (typeof value !== 'string') throw new Error('Unavailable: ' + args.join(' '));
        return value;
      },
      writable(path) { return (fixture.writable || []).includes(path); },
      executable(path) { return (fixture.executable || []).includes(path); }
    };
  `);
  const env = {
    ...options.env,
    HOME: home, PATH: bin, TMPDIR: root,
    XDG_CONFIG_HOME: join(home, '.config'), XDG_STATE_HOME: join(home, '.local/state'),
    XDG_DATA_HOME: join(home, '.local/share'), XDG_CACHE_HOME: join(home, '.cache'), XDG_RUNTIME_DIR: runtime,
    HYPRLAND_INSTANCE_SIGNATURE: '', WAYLAND_DISPLAY: '', DISPLAY: '',
    DBUS_SESSION_BUS_ADDRESS: `unix:path=${join(runtime, 'bus')}`,
    PYTHONDONTWRITEBYTECODE: '1',
    PIPCTL_PORT: '0', PIPCTL_CONFIG_DIR: configDir, PIPCTL_NOTES_DIR: notesDir, PIPCTL_SHELL_SOCKET: shellSocket,
    PIPCTL_CHECKS_ENV_MODULE: options.checks ? checksModule : '',
    ...(options.brain.baseURL ? { PIPCTL_OPENAI_BASE: options.brain.baseURL, PIPCTL_GEMINI_BASE: options.brain.baseURL } : {}),
  };
  const ready = Promise.withResolvers<string>(), exited = Promise.withResolvers<void>();
  let output = '', stopped: Promise<void> | undefined;
  const phones = new Set<Phone>();
  const child = spawn(process.execPath, ['server/main.ts'], {
    cwd: resolve(import.meta.dir, '../..'), env, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const signalGroup = (signal: NodeJS.Signals) => {
    if (!child.pid) return;
    try { process.kill(-child.pid, signal); }
    catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error; }
  };
  child.stdout.on('data', (data: Buffer) => {
    output += data.toString();
    const address = /Pip listening on (http:\/\/127\.0\.0\.1:\d+);/.exec(output)?.[1];
    if (address) ready.resolve(address);
  });
  child.stderr.on('data', (data: Buffer) => { output += data.toString(); });
  child.once('error', error => { ready.reject(error); exited.resolve(); });
  child.once('exit', (code, signal) => {
    ready.reject(new Error(`Pip exited before listening (${code ?? signal}):\n${output}`));
    exited.resolve();
  });
  const stop = () => {
    stopped ??= (async () => {
      try {
        await Promise.all([...phones].map(phone => phone.close()));
        signalGroup('SIGTERM');
        const killTimer = setTimeout(() => signalGroup('SIGKILL'), 1500);
        try { await exited.promise; } finally { clearTimeout(killTimer); }
      } finally {
        // The server may exit before its helper's stop timer fires. Reap the whole owned group.
        signalGroup('SIGKILL');
        rmSync(root, { recursive: true, force: true });
      }
    })();
    return stopped;
  };
  const timer = setTimeout(() => ready.reject(new Error(`Pip did not listen within 2 seconds:\n${output}`)), 2000);
  try {
    const url = await ready.promise;
    if (options.desktop === 'fake') {
      const deadline = Date.now() + 2000;
      while (true) {
        const status = await (await fetch(`${url}/api/status`, { headers: { Authorization: `Bearer ${token}` } })).json();
        if (status.agentReady === true) break;
        if (Date.now() >= deadline) throw new Error(`Fake desktop did not become ready:\n${output}`);
        await Bun.sleep(20);
      }
    }
    return {
      url, pid: child.pid!, root, configDir, notesDir, shellSocket,
      logs() { return output; },
      async phone() {
        if (stopped) throw new Error('Pip harness is stopped.');
        const phone = await Phone.connect(`${url.replace(/^http/, 'ws')}/ws?token=${token}`);
        phones.add(phone); return phone;
      },
      request(path, init) {
        const headers = new Headers(init?.headers); headers.set('Authorization', `Bearer ${token}`);
        return fetch(new URL(path, url), { ...init, headers });
      },
      stop,
    };
  } catch (error) { await stop(); throw error; }
  finally { clearTimeout(timer); }
}
