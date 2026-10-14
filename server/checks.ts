import { accessSync, constants } from 'node:fs';
import { join } from 'node:path';
import { command, object, repoRoot } from './config';
import { parseIdentity } from './tailscale';

export interface SetupCheck {
  id: string;
  ok: boolean;
  title: string;
  detail: string;
  fix?: { label: string; command: string };
}
/** Read-only system boundary; the server harness supplies a temporary implementation. */
export interface CheckEnvironment {
  path: string;
  run(args: string[]): Promise<string>;
  writable(path: string): boolean;
  executable(path: string): boolean;
}
export const systemEnvironment: CheckEnvironment = {
  path: process.env.PATH || '',
  run: args => command(args, 5000),
  writable(path) { try { accessSync(path, constants.W_OK); return true; } catch { return false; } },
  executable(path) { try { accessSync(path, constants.X_OK); return true; } catch { return false; } },
};
export async function checkEnvironment(): Promise<CheckEnvironment> {
  // Harness environments are selected at runtime and live outside the source tree.
  return process.env.PIPCTL_CHECKS_ENV_MODULE ? (await import(process.env.PIPCTL_CHECKS_ENV_MODULE)).default : systemEnvironment;
}
const packages = ['tesseract', 'tesseract-data-eng', 'wtype', 'grim', 'ffmpeg', 'imagemagick', 'qrencode', 'bun', 'python-gobject', 'at-spi2-core', 'tailscale'];
function quote(value: string) { return "'" + value.replaceAll("'", "'\\''") + "'"; }
async function platformVersion(env: CheckEnvironment, id: string, name: string, minimum: string, args: string[]): Promise<SetupCheck> {
  const check: SetupCheck = { id, ok: false, title: `${name} ${minimum}+`, detail: `Could not read ${name}'s version; Pip needs ${minimum} or newer.`, fix: { label: 'Update Omarchy', command: 'omarchy update' } };
  try {
    const output = await env.run(args);
    const raw = id === 'hyprland' ? object(JSON.parse(output)) : null;
    const version = String(raw ? raw.version || raw.tag || '' : output).match(/(?:^|[^\d])(\d+)\.(\d+)(?:\.(\d+))?/);
    if (!version) return check;
    const [major, minor] = minimum.split('.').map(Number);
    check.ok = Number(version[1]) > major || Number(version[1]) === major && Number(version[2]) >= minor;
    const installed = `${version[1]}.${version[2]}${version[3] ? `.${version[3]}` : ''}`;
    check.detail = check.ok ? `${name} ${installed} meets Pip's requirement.` : `${name} ${installed} is installed; Pip needs ${minimum} or newer.`;
    if (check.ok) delete check.fix;
  } catch { /* Keep the actionable minimum version if the command is unavailable. */ }
  return check;
}
export async function evaluateChecks(env: CheckEnvironment = systemEnvironment, plugin = repoRoot): Promise<SetupCheck[]> {
  const missing: string[] = [];
  try { await env.run(['pacman', '-Q', ...packages]); }
  catch {
    await Promise.all(packages.map(async name => {
      try { await env.run(['pacman', '-Q', name]); }
      catch { missing.push(name); }
    }));
    missing.sort((a, b) => packages.indexOf(a) - packages.indexOf(b));
  }
  const writable = env.writable('/dev/uinput');
  const cli = env.path.split(':').some(directory => env.executable(join(directory || '.', 'pipctl')));
  const tailscale: SetupCheck = { id: 'tailscale', ok: false, title: 'Tailscale phone access', detail: 'Install and sign in to Tailscale; enable MagicDNS and HTTPS Certificates at https://login.tailscale.com/admin/dns.', fix: { label: 'Set up Tailscale', command: 'omarchy-install-service-tailscale' } };
  try {
    const identity = parseIdentity(JSON.parse(await env.run(['tailscale', 'status', '--json'])));
    if (!identity.running) tailscale.detail = `Tailscale is ${identity.backendState}. Run the service installer, then sign in.`;
    else if (!identity.dns || !identity.magicDNS || !identity.https) {
      const missing = [!identity.dns || !identity.magicDNS ? 'MagicDNS' : '', !identity.https ? 'HTTPS Certificates' : ''].filter(Boolean);
      tailscale.detail = `Enable ${missing.join(' and ')} at https://login.tailscale.com/admin/dns.`;
      tailscale.fix = { label: 'Open Tailscale DNS settings', command: 'xdg-open https://login.tailscale.com/admin/dns' };
    } else {
      tailscale.ok = true;
      tailscale.detail = 'Tailscale is running with MagicDNS and HTTPS Certificates.';
      delete tailscale.fix;
    }
  } catch { /* The service installer and admin-console hint above are the recovery path. */ }
  return [
    { id: 'packages', ok: missing.length === 0, title: 'Required packages', detail: missing.length ? `Missing: ${missing.join(', ')}` : 'All required packages are installed.', ...(missing.length ? { fix: { label: 'Install packages', command: `omarchy pkg add ${missing.join(' ')}` } } : {}) },
    { id: 'uinput', ok: writable, title: 'Computer control permission', detail: writable ? '/dev/uinput is writable by your user.' : '/dev/uinput is not writable by your user.', ...(!writable ? { fix: { label: 'Allow computer control', command: `sudo install -m644 ${quote(join(plugin, 'system/70-pip-uinput.rules'))} /etc/udev/rules.d/ && sudo install -m644 ${quote(join(plugin, 'system/pip-uinput.conf'))} /etc/modules-load.d/ && sudo modprobe uinput && sudo udevadm control --reload && sudo udevadm trigger --name-match=uinput` } } : {}) },
    { id: 'pipctl', ok: cli, title: 'pipctl on PATH', detail: cli ? 'pipctl is available on PATH.' : 'Your PATH does not contain an executable pipctl.', ...(!cli ? { fix: { label: 'Put pipctl on PATH', command: `mkdir -p ~/.local/bin && ln -sf ${quote(join(plugin, 'bin/pipctl'))} ~/.local/bin/pipctl` } } : {}) },
    tailscale,
    await platformVersion(env, 'hyprland', 'Hyprland', '0.56', ['hyprctl', 'version', '-j']),
    await platformVersion(env, 'quickshell', 'Quickshell', '0.3', ['quickshell', '--version']),
  ];
}
export class Checks {
  items: SetupCheck[] = [];
  onChange: () => void = () => {};
  private timer: NodeJS.Timeout | undefined;
  private refreshing: Promise<void> | undefined;
  constructor(private environment: CheckEnvironment) {}
  get setup() { return this.items.every(check => check.ok) ? 'ok' : 'finish setup on your computer'; }
  async start() { await this.refresh(); this.timer = setInterval(() => this.refresh(), 5 * 60_000); }
  refresh(): Promise<void> {
    this.refreshing ??= evaluateChecks(this.environment).then(items => { this.items = items; this.onChange(); }).finally(() => { this.refreshing = undefined; });
    return this.refreshing;
  }
  stop() { clearInterval(this.timer); }
}
