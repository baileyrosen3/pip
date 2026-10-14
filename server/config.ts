import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';

export const repoRoot = resolve(import.meta.dir, '..');
export const agentPath = join(repoRoot, 'agent/pip_agent.py');
export const configDir = process.env.PIPCTL_CONFIG_DIR || join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'pip');
export const port = Number(process.env.PIPCTL_PORT || 7319);
export const openaiBase = (process.env.PIPCTL_OPENAI_BASE || 'https://api.openai.com/v1').replace(/\/$/, '');
export const geminiBase = (process.env.PIPCTL_GEMINI_BASE || 'https://generativelanguage.googleapis.com').replace(/\/$/, '');
export type Provider = 'openai' | 'gemini' | 'gptlive';
export function isProvider(value: unknown): value is Provider { return value === 'openai' || value === 'gemini' || value === 'gptlive'; }
export const providerVoices: Record<Provider, readonly string[]> = {
  openai: ['marin', 'cedar', 'alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse'],
  gemini: ['Puck', 'Kore', 'Charon', 'Fenrir', 'Aoede', 'Leda', 'Orus', 'Zephyr'],
  gptlive: ['vesper', 'marin', 'ripple', 'quartz', 'willow', 'stone', 'gleam', 'meridian', 'beacon', 'delta', 'cinder', 'bossa', 'tempo'],
};
export const defaultVoice: Record<Provider, string> = { openai: 'marin', gemini: 'Puck', gptlive: 'vesper' };
const allVoices = new Set(Object.values(providerVoices).flat());
export type PointerTrail = 'ribbon' | 'sparkles' | 'none';
export type PointerType = 'arrow' | 'orb' | 'eyes' | 'face';
/// When Pip answers: `talk` = whenever you finish speaking; `name` = when you say "Pip"; `hold` = only while you hold the phone screen.
export type ReplyMode = 'talk' | 'name' | 'hold';
export const defaults = { cursorSize: 44, glow: false, showCursor: true, phonePosition: 0.5, followMouse: true, trail: 'none' as PointerTrail, mood: 'listening', computerControl: true, monitor: 'auto', personality: '', volume: 1, color: 'theme', pointer: 'arrow' as PointerType, eyeStyle: 'flat' as 'flat' | 'glass' | 'glow', eyeSize: 1, replyMode: 'talk' as ReplyMode, tailscaleServe: false, provider: 'gemini' as Provider, voice: true, voiceName: 'Puck' };
export type Settings = typeof defaults;
export type Secrets = { openaiKey: string; geminiKey: string; pairToken: string };

export function atomicJSON(path: string, value: unknown, mode = 0o600) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { mode });
  chmodSync(temporary, mode);
  renameSync(temporary, path);
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a JSON object.');
  return value as Record<string, unknown>;
}
function load(path: string): Record<string, unknown> {
  try { return object(JSON.parse(readFileSync(path, 'utf8'))); }
  catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) console.error(`Pip: reading ${path}: ${message(error)}`); return {}; }
}
export function settingsPatch(input: unknown): Partial<Settings> {
  input = object(input);
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(object(input))) {
    if (!Object.hasOwn(defaults, key)) continue;
    if (typeof value !== typeof defaults[key as keyof Settings]) throw new Error(`Invalid setting: ${key}`);
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`Invalid setting: ${key}`);
    patch[key] = value;
  }
  if ('color' in patch && patch.color !== 'theme' && patch.color !== 'accent' && !/^#[a-f\d]{6}$/i.test(String(patch.color))) throw new Error('Color must be theme, accent or #rrggbb.');
  if ('eyeStyle' in patch && !['flat', 'glass', 'glow'].includes(String(patch.eyeStyle))) throw new Error('Eye style must be flat, glass or glow.');
  if (typeof patch.eyeSize === 'number') patch.eyeSize = Math.min(1.5, Math.max(.7, patch.eyeSize));
  if ('trail' in patch && !['ribbon', 'sparkles', 'none'].includes(String(patch.trail))) throw new Error('Trail must be ribbon, sparkles or none.');
  if ('pointer' in patch && !['arrow', 'orb', 'eyes', 'face'].includes(String(patch.pointer))) throw new Error('Pointer must be arrow, orb, eyes or face.');
  if ('replyMode' in patch && !['talk', 'name', 'hold'].includes(String(patch.replyMode))) throw new Error('Reply mode must be talk, name or hold.');
  if ('provider' in patch && !isProvider(patch.provider)) throw new Error('Brain must be openai, gemini or gptlive.');
  if ('voiceName' in patch && !allVoices.has(String(patch.voiceName))) throw new Error('Choose a supported voice for this brain.');
  if (typeof patch.cursorSize === 'number') patch.cursorSize = Math.min(72, Math.max(28, patch.cursorSize));
  if (typeof patch.phonePosition === 'number') patch.phonePosition = Math.min(1, Math.max(0, patch.phonePosition));
  if (typeof patch.volume === 'number') patch.volume = Math.min(1, Math.max(0, patch.volume));
  return patch as Partial<Settings>;
}
export class Configuration {
  settings: Settings;
  secrets: Secrets;
  constructor() {
    mkdirSync(configDir, { recursive: true, mode: 0o700 });
    const saved = load(join(configDir, 'secrets.json'));
    this.secrets = { openaiKey: typeof saved.openaiKey === 'string' ? saved.openaiKey : '', geminiKey: typeof saved.geminiKey === 'string' ? saved.geminiKey : '', pairToken: typeof saved.pairToken === 'string' && /^[a-f0-9]{64}$/.test(saved.pairToken) ? saved.pairToken : randomBytes(32).toString('hex') };
    this.settings = { ...defaults, provider: this.secrets.openaiKey ? 'openai' : 'gemini', ...settingsPatch(load(join(configDir, 'config.json'))) };
    this.normalizeVoice(this.settings);
    atomicJSON(join(configDir, 'secrets.json'), this.secrets);
    atomicJSON(join(configDir, 'config.json'), this.settings);
  }
  private normalizeVoice(settings: Settings) {
    if (!providerVoices[settings.provider].includes(settings.voiceName)) settings.voiceName = defaultVoice[settings.provider];
    if (settings.provider === 'gptlive') settings.voice = true;
  }
  update(input: unknown) {
    const patch = settingsPatch(input), next = { ...this.settings, ...patch };
    if (patch.voiceName !== undefined && !providerVoices[next.provider].includes(patch.voiceName)) throw new Error('That voice is not available for this brain.');
    this.normalizeVoice(next); Object.assign(this.settings, next); atomicJSON(join(configDir, 'config.json'), this.settings); return this.settings;
  }
  setKey(key: string, provider: Provider) { if (provider === 'gemini') this.secrets.geminiKey = key.trim(); else this.secrets.openaiKey = key.trim(); atomicJSON(join(configDir, 'secrets.json'), this.secrets); }
  key(provider: Provider = this.settings.provider) { return provider === 'gemini' ? this.secrets.geminiKey : this.secrets.openaiKey; }
  get keys() { return { openai: !!this.secrets.openaiKey, gemini: !!this.secrets.geminiKey }; }
  get hasKey() { return !!this.key(); }
  authorized(token: string) {
    const expected = Buffer.from(this.secrets.pairToken);
    const candidate = Buffer.from(token);
    // Compare fixed-size buffers even when a malformed token has the wrong length.
    const padded = Buffer.alloc(expected.length);
    candidate.copy(padded, 0, 0, expected.length);
    return timingSafeEqual(expected, padded) && candidate.length === expected.length;
  }
}
export async function command(args: string[], timeout = 15_000): Promise<string> {
  const child = Bun.spawn(args, { stdout: 'pipe', stderr: 'pipe', env: process.env });
  const timer = setTimeout(() => child.kill(), timeout);
  try {
    const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if (code !== 0) throw new Error(`${args[0]}: ${err.trim() || `exited ${code}`}`);
    return out;
  } finally { clearTimeout(timer); }
}
export async function desktopEnvironment() {
  try {
    const raw: unknown = JSON.parse(await command(['hyprctl', 'instances', '-j']));
    if (!Array.isArray(raw)) return;
    const instances = raw.map(object).filter(i => typeof i.instance === 'string').sort((a, b) => Number(b.time) - Number(a.time));
    const selected = instances.find(i => i.instance === process.env.HYPRLAND_INSTANCE_SIGNATURE) || instances[0];
    if (!selected) return;
    process.env.HYPRLAND_INSTANCE_SIGNATURE = String(selected.instance);
    if (typeof selected.wl_socket === 'string') process.env.WAYLAND_DISPLAY = selected.wl_socket;
  } catch (error) { console.error(`Pip: discovering desktop: ${message(error)}`); }
}
export function message(error: unknown) { return error instanceof Error ? error.message : String(error); }
