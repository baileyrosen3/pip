import { spawn } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import type { MockBrain } from './brain';
import { Phone } from './phone';

export interface ServerOptions {
  brain: MockBrain;
  /** Additional saved settings; null starts without a saved settings file. */
  settings?: Record<string, unknown> | null;
  /** Inject scenario-specific env, but isolation paths and mock brain URLs cannot be overridden. */
  env?: Record<string, string>;
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
  for (const name of ['python3', 'ffmpeg']) {
    const executable = Bun.which(name);
    if (executable) symlinkSync(executable, join(bin, name));
  }
  const token = '1'.repeat(64);
  writeFileSync(join(configDir, 'secrets.json'), JSON.stringify({ openaiKey: 'mock-openai-key', geminiKey: 'mock-gemini-key', pairToken: token }), { mode: 0o600 });
  if (options.settings !== null) {
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({
      provider: options.brain.kind, replyMode: 'hold', computerControl: false, meetingNotes: false,
      tailscaleServe: false, ...options.settings,
    }), { mode: 0o600 });
  }
  const env = {
    ...options.env,
    HOME: home, PATH: bin, TMPDIR: root,
    XDG_CONFIG_HOME: join(home, '.config'), XDG_STATE_HOME: join(home, '.local/state'),
    XDG_DATA_HOME: join(home, '.local/share'), XDG_CACHE_HOME: join(home, '.cache'), XDG_RUNTIME_DIR: runtime,
    HYPRLAND_INSTANCE_SIGNATURE: '', WAYLAND_DISPLAY: '', DISPLAY: '',
    DBUS_SESSION_BUS_ADDRESS: `unix:path=${join(runtime, 'bus')}`,
    PYTHONDONTWRITEBYTECODE: '1',
    PIPCTL_PORT: '0', PIPCTL_CONFIG_DIR: configDir, PIPCTL_NOTES_DIR: notesDir, PIPCTL_SHELL_SOCKET: shellSocket,
    PIPCTL_OPENAI_BASE: options.brain.baseURL, PIPCTL_GEMINI_BASE: options.brain.baseURL,
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
