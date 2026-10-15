import { command, Configuration, message, object, port } from './config';
export type TailscaleIdentity = { running: boolean; dns: string; url: string; login: string; https: boolean; magicDNS: boolean; backendState: string };
export type TailscaleStatus = { running: boolean; dns: string; url: string; serving: boolean; login: string };
export function parseIdentity(value: unknown): TailscaleIdentity {
  const raw = object(value), self = raw.Self ? object(raw.Self) : {}, users = raw.User ? object(raw.User) : {};
  const owner = users[String(self.UserID)];
  const login = owner ? object(owner).LoginName : undefined;
  const dns = typeof self.DNSName === 'string' ? self.DNSName.replace(/\.$/, '').toLowerCase() : '';
  const magicDNS = !raw.CurrentTailnet || object(raw.CurrentTailnet).MagicDNSEnabled !== false;
  return { running: raw.BackendState === 'Running', dns, url: dns ? `https://${dns}:10000` : '', login: typeof login === 'string' ? login : '', https: Array.isArray(raw.CertDomains) && raw.CertDomains.length > 0, magicDNS, backendState: typeof raw.BackendState === 'string' ? raw.BackendState : 'Unknown' };
}
export function hasServeMapping(value: unknown, dns: string, localPort = port) {
  const raw = object(value), tcp = raw.TCP ? object(raw.TCP) : {}, web = raw.Web ? object(raw.Web) : {};
  const endpoint = tcp['10000'], host = web[`${dns}:10000`];
  if (!endpoint || object(endpoint).HTTPS !== true || !host) return false;
  const handlersValue = object(host).Handlers;
  if (!handlersValue) return false;
  const root = object(handlersValue)['/'];
  if (!root) return false;
  return object(root).Proxy === `http://127.0.0.1:${localPort}`;
}
export function requirePairing(identity: TailscaleIdentity) {
  if (!identity.running) throw new Error(`Tailscale is ${identity.backendState}. Run: tailscale up`);
  if (!identity.dns || !identity.magicDNS) throw new Error('Enable MagicDNS at https://login.tailscale.com/admin/dns, then run pipctl pair again.');
  if (!identity.https) throw new Error('Enable HTTPS Certificates at https://login.tailscale.com/admin/dns, then run pipctl pair again.');
  if (!identity.login) throw new Error("Tailscale did not report this node owner's login. Re-authenticate with: tailscale up");
}
/// Publishes Pip on https://<this machine>.<tailnet>.ts.net:10000 (tailnet only). Idempotent; other serve ports are untouched.
export async function ensureServe(): Promise<TailscaleIdentity> {
  const identity = parseIdentity(JSON.parse(await command(['tailscale', 'status', '--json'], 10_000)));
  requirePairing(identity);
  if (!hasServeMapping(JSON.parse(await command(['tailscale', 'serve', 'status', '--json'], 10_000)), identity.dns)) {
    await command(['tailscale', 'serve', '--bg', '--https=10000', `http://127.0.0.1:${port}`], 30_000);
  }
  return identity;
}
export class Tailscale {
  status: TailscaleStatus = { running: false, dns: '', url: '', serving: false, login: '' };
  onChange: () => void = () => {};
  private timer: NodeJS.Timeout | undefined;
  private refreshing = false;
  constructor(private config: Configuration) {}
  async start() {
    await this.refresh();
    if (this.config.settings.tailscaleServe && this.status.running && !this.status.serving) {
      try { await this.serve(); } catch (error) { console.error(`Pip: restoring Tailscale Serve: ${message(error)}`); }
    }
    this.timer = setInterval(() => this.refresh(), 60_000);
  }
  /// Turn on phone access (from the bar menu or pipctl pair) and remember it across restarts.
  async serve() {
    await ensureServe();
    this.config.update({ tailscaleServe: true });
    await this.refresh();
  }
  async refresh() {
    if (this.refreshing) return;
    this.refreshing = true;
    let next: TailscaleStatus;
    try {
      const identity = parseIdentity(JSON.parse(await command(['tailscale', 'status', '--json'], 10_000)));
      let serving = false;
      if (identity.running && identity.dns) {
        try { serving = hasServeMapping(JSON.parse(await command(['tailscale', 'serve', 'status', '--json'], 10_000)), identity.dns); }
        catch (error) { console.error(`Pip: reading Tailscale Serve: ${message(error)}`); }
      }
      next = { running: identity.running, dns: identity.dns, url: identity.url, serving, login: identity.login };
    } catch (error) { console.error(`Pip: Tailscale unavailable: ${message(error)}`); next = { running: false, dns: '', url: '', serving: false, login: '' }; }
    finally { this.refreshing = false; }
    const previous = this.status; this.status = next;
    if (previous.running !== next.running || previous.dns !== next.dns || previous.url !== next.url || previous.serving !== next.serving || previous.login !== next.login) this.onChange();
  }
  owner(request: Request) {
    return this.status.running && !!this.status.login && request.headers.get('Tailscale-User-Login') === this.status.login;
  }
  /** Same-origin pages only: Pip's own loopback address (the port it actually listens on) or its tailnet URL. */
  allowsOrigin(request: Request, listeningPort: number) {
    const origin = request.headers.get('Origin');
    if (!origin) return true; // CLI/non-browser clients do not send an Origin.
    return origin === `http://127.0.0.1:${listeningPort}` || origin === `http://localhost:${listeningPort}` || (!!this.status.url && origin === this.status.url);
  }
  stop() { clearInterval(this.timer); }
}
