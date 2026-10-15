import { hostname } from 'node:os';
import { join, resolve, sep } from 'node:path';
import type { ServerWebSocket } from 'bun';
import { Agent } from './agent';
import { command, Configuration, desktopEnvironment, isProvider, message, object, port, repoRoot } from './config';
import { Notes } from './notes';
import { Shell } from './shell';
import { Tools } from './tools';
import { Voice } from './voice';
import { Tailscale } from './tailscale';
import { OmarchyTheme } from './theme';
import { Checks, checkEnvironment } from './checks';
type Client = { id: string; name: string; clientId: string; authorized: boolean; autoPaired: boolean };
type PlaybackItem = import('./live-provider').PlaybackItem;
const config = new Configuration();
await desktopEnvironment();
const agent = new Agent(), shell = new Shell(), notes = new Notes(config);
const theme = new OmarchyTheme();
await notes.init();
const tools = new Tools(agent, shell, config), voice = new Voice(config, notes, tools);
const tailscale = new Tailscale(config);
const checks = new Checks(await checkEnvironment(), config);
const clients = new Set<ServerWebSocket<Client>>();
let micOwner: ServerWebSocket<Client> | undefined;
let lastAudioItem: { id: string; index: number } | undefined;
let lastFace: Record<string, unknown> | null = null, pendingFace: Record<string, unknown> | null = null;
let lastFaceAt = 0;
let currentActivity: string | null = null;
let faceTimer: NodeJS.Timeout | undefined;
let overlayWasConnected = false;
function status() {
  return { op: 'status', checks: checks.items, setup: checks.setup, phones: [...clients].map(c => c.data.name), awake: voice.state !== 'asleep', state: voice.state, provider: config.settings.provider, voice: config.settings.voice, voiceName: config.settings.voiceName, hasKey: config.hasKey, keys: config.keys, computerControl: config.settings.computerControl, host: hostname(), pairUrl: tailscale.status.url ? `${tailscale.status.url}/#token=${config.secrets.pairToken}` : '', tailscale: tailscale.status, shell: { listening: true, overlay: shell.connected, bars: shell.barCount, path: shell.path }, agentReady: agent.ready };
}
function statusChanged() { shell.send(status()); }
function broadcast(packet: Record<string, unknown>) {
  const text = JSON.stringify(packet); for (const client of clients) client.send(text);
}
function hello(autoPaired = false) { return { t: 'hello', setup: checks.setup, host: hostname(), settings: config.settings, theme: theme.colors, state: voice.state, hasKey: config.hasKey, keys: config.keys, ...(autoPaired ? { pairToken: config.secrets.pairToken } : {}) }; }
function settingsChanged() {
  // The helper still owns target-monitor selection, but never draws an overlay.
  agent.send({ op: 'settings', monitor: config.settings.monitor });
  shell.send({ op: 'settings', ...config.settings, theme: theme.colors, hasKey: config.hasKey, keys: config.keys });
  broadcast({ t: 'settings', ...config.settings, theme: theme.colors, hasKey: config.hasKey, keys: config.keys }); voice.configure(); statusChanged();
  void checks.refresh();
}
function saveKey(provider: unknown, key: unknown, endpoint?: unknown) {
  if (!isProvider(provider)) throw new Error('Choose Open, OpenAI Realtime, GPT-Live or Gemini for this key.');
  if (typeof key !== 'string') throw new Error('The API key must be text.');
  if (provider === 'open' && endpoint !== 'stt' && endpoint !== 'llm' && endpoint !== 'tts') throw new Error('Choose STT, LLM or TTS for this key.');
  config.setKey(key, provider, endpoint === 'stt' || endpoint === 'llm' || endpoint === 'tts' ? endpoint : undefined); voice.configure(); broadcast(hello()); statusChanged();
  if (provider === 'open') void checks.refresh();
}
theme.onChange = () => settingsChanged();
function owner(preferred?: ServerWebSocket<Client>) {
  const next = preferred || [...clients].at(-1);
  if (next === micOwner) return;
  if (micOwner) { voice.playback(false); micOwner.send(JSON.stringify({ t: 'mic', on: false })); }
  lastAudioItem = undefined;
  micOwner = next;
  if (micOwner && voice.micOn) micOwner.send(JSON.stringify({ t: 'mic', on: true }));
}
voice.broadcast = packet => { broadcast(packet); if (packet.t === 'state') statusChanged(); };
tools.activity = name => { currentActivity = name; broadcast({ t: 'activity', name }); shell.send({ op: 'activity', name }); };
voice.mic = on => { if (!micOwner) owner(); micOwner?.send(JSON.stringify({ t: 'mic', on })); };
voice.audioOut = (pcm, item) => {
  if (!micOwner) return;
  if (item && (item.id !== lastAudioItem?.id || item.index !== lastAudioItem.index)) {
    micOwner.send(JSON.stringify({ t: 'audioItem', ...item })); lastAudioItem = item;
  }
  micOwner.send(pcm);
};
voice.audioStop = () => { micOwner?.send(JSON.stringify({ t: 'audioStop' })); lastAudioItem = undefined; };
notes.onChange = () => broadcast({ t: 'sessions' });
notes.onError = text => { broadcast({ t: 'error', message: text }); shell.send({ op: 'bubble', text, life: 6 }); };
agent.onEvent = event => {
  if (event.ev === 'ready') { agent.send({ op: 'settings', monitor: config.settings.monitor }); statusChanged(); }
  if ((event.ev === 'ready' || event.ev === 'monitor') && agent.monitor) shell.send({ op: 'monitor', ...agent.monitor });
  if (event.ev === 'mouse' && ['x', 'y'].every(k => typeof event[k] === 'number')) shell.send({ op: 'mouse', x: event.x, y: event.y, onMonitor: event.onMonitor === true });
};
shell.onChange = () => { if (overlayWasConnected && !shell.connected) tools.home(); overlayWasConnected = shell.connected; statusChanged(); };
shell.onEvent = (event, role) => {
  if (role === 'overlay') {
    if (event.ev === 'tip') { tools.followTip(event); return; }
    if (event.ev !== 'face' || !['gazeX', 'gazeY', 'talk'].every(k => typeof event[k] === 'number') || typeof event.mood !== 'string') return;
    pendingFace = { t: 'face', gazeX: event.gazeX, gazeY: event.gazeY, mood: event.mood, talk: event.talk };
    if (!faceTimer) faceTimer = setTimeout(sendFace, Math.max(0, 1000 / 30 - (performance.now() - lastFaceAt)));
  } else {
    let operation: Promise<unknown>;
    if (event.ev === 'ctl' && typeof event.cmd === 'string') operation = control(event.cmd);
    else if (event.ev === 'setKey') { try { saveKey(event.provider, event.key, event.endpoint); } catch (error) { shell.send({ op: 'bubble', text: message(error), life: 4 }); } return; }
    else if (event.ev === 'settings') { try { config.update(event); settingsChanged(); } catch (error) { console.error(`Pip bar settings: ${message(error)}`); shell.send({ op: 'bubble', text: message(error), life: 4 }); } return; }
    else if (event.ev === 'openNotes') operation = command(['xdg-open', notes.root]);
    else if (event.ev === 'pair') operation = tailscale.serve();
    else return;
    operation.catch(error => { console.error(`Pip bar: ${message(error)}`); shell.send({ op: 'bubble', text: message(error), life: 4 }); });
  }
};
function sendFace() {
  faceTimer = undefined;
  const face = pendingFace; pendingFace = null;
  if (!face) return;
  const now = performance.now();
  if (lastFace && now - lastFaceAt < 1000 && face.mood === lastFace.mood && Math.abs(Number(face.gazeX) - Number(lastFace.gazeX)) < 0.004 && Math.abs(Number(face.gazeY) - Number(lastFace.gazeY)) < 0.004 && Math.abs(Number(face.talk) - Number(lastFace.talk)) < 0.02) return;
  lastFace = face; lastFaceAt = now; broadcast(face);
}
async function control(cmd: string, client?: ServerWebSocket<Client>) {
  if (cmd === 'toggle') { if (voice.state === 'asleep') owner(client); voice.toggle(); return; }
  if (cmd === 'check') { await checks.refresh(); return; }
  await tools.ctl(cmd);
  if (cmd === 'follow' || cmd === 'hide') settingsChanged();
  else statusChanged();
}
async function packet(client: ServerWebSocket<Client>, data: Record<string, unknown>) {
  switch (data.t) {
    case 'hello': client.data.name = typeof data.name === 'string' ? data.name : 'Phone'; client.data.clientId = typeof data.clientId === 'string' ? data.clientId : ''; statusChanged(); break;
    case 'toggle': await control('toggle', client); break;
    case 'wake': if (voice.state === 'asleep') owner(client); voice.wake(); break;
    case 'sleep': voice.sleep(); break;
    case 'askStart': if (voice.state === 'asleep') owner(client); voice.beginAsk(); break;
    case 'askEnd': voice.endAsk(); break;
    case 'sayHi': if (voice.state === 'asleep') owner(client); voice.sayHi(); break;
    case 'micError': if (client === micOwner) { voice.sleep(); voice.error(typeof data.message === 'string' ? data.message : 'I could not start the microphone.'); } break;
    case 'playback': {
      if (client !== micOwner) break;
      if (typeof data.on !== 'boolean') throw new Error('Playback state must be true or false.');
      let items: PlaybackItem[] | undefined;
      if (data.items !== undefined) {
        if (!Array.isArray(data.items)) throw new Error('Playback progress must be a list.');
        items = data.items.map(value => {
          const item = object(value);
          if (typeof item.id !== 'string' || typeof item.index !== 'number' || !Number.isInteger(item.index) || item.index < 0 || typeof item.playedMs !== 'number' || !Number.isFinite(item.playedMs) || item.playedMs < 0) throw new Error('Invalid playback progress.');
          return { id: item.id, index: item.index, playedMs: item.playedMs };
        });
      }
      voice.playback(data.on, items); break;
    }
    case 'bargeIn': if (client === micOwner) voice.bargeIn(); break;
    case 'hear': if (client === micOwner) voice.hear(); break;
    case 'settings': config.update(data); settingsChanged(); break;
    case 'setKey': saveKey(data.provider, data.key, data.endpoint); break;
    default: throw new Error('Unknown phone message.');
  }
}
async function staticFile(root: string, relative: string) {
  const path = resolve(root, relative);
  if (path !== root && !path.startsWith(root + sep)) return new Response('Not found', { status: 404 });
  const file = Bun.file(path);
  if (!await file.exists()) return new Response('Not found', { status: 404 });
  const headers: Record<string, string> = { 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' };
  if (path.endsWith('.mjs')) headers['Content-Type'] = 'text/javascript';
  return new Response(file, { headers });
}
await shell.start();
tailscale.onChange = statusChanged; await tailscale.start();
checks.onChange = () => { statusChanged(); broadcast({ t: 'setup', setup: checks.setup }); };
await checks.start();
shell.send({ op: 'settings', ...config.settings, theme: theme.colors, hasKey: config.hasKey, keys: config.keys }); tools.home(); tools.awake(false); statusChanged();
export const server = Bun.serve<Client>({ hostname: '127.0.0.1', port,
  async fetch(request, server) {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/ws') {
        if (!tailscale.allowsOrigin(request, server.port ?? port)) return new Response('Cross-origin WebSocket denied', { status: 403 });
        const validToken = config.authorized(url.searchParams.get('token') || ''), autoPaired = !validToken && tailscale.owner(request);
        if (server.upgrade(request, { data: { id: crypto.randomUUID(), name: 'Phone', clientId: '', authorized: validToken || autoPaired, autoPaired } })) return;
        return new Response('WebSocket upgrade required', { status: 426 });
      }
      if (url.pathname.startsWith('/api/')) {
        const authorization = request.headers.get('authorization') || '';
        if (!(authorization.startsWith('Bearer ') && config.authorized(authorization.slice(7))) && !tailscale.owner(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
        const headers = { 'Cache-Control': 'no-store' };
        if (url.pathname === '/api/status' && request.method === 'GET') return Response.json(status(), { headers });
        if (url.pathname === '/api/settings') {
          if (request.method === 'GET') return Response.json(config.settings, { headers });
          if (request.method === 'POST') { config.update(await request.json()); settingsChanged(); return Response.json(config.settings, { headers }); }
        }
        if (request.method === 'GET' && url.pathname === '/api/sessions') return Response.json(notes.list(), { headers });
        if (request.method === 'GET' && url.pathname.startsWith('/api/sessions/')) {
          const session = notes.sessions.find(s => s.id === decodeURIComponent(url.pathname.slice('/api/sessions/'.length)));
          return session ? Response.json(notes.full(session), { headers }) : Response.json({ error: 'Session not found' }, { status: 404, headers });
        }
        if (request.method === 'POST' && url.pathname === '/api/ctl') {
          const data = object(await request.json()); if (typeof data.cmd !== 'string') throw new Error('A control command is required.');
          await control(data.cmd); return Response.json({ ok: true, state: voice.state }, { headers });
        }
        return Response.json({ error: 'Not found' }, { status: 404, headers });
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
      if (url.pathname.startsWith('/fonts/')) return await staticFile(join(repoRoot, 'fonts'), decodeURIComponent(url.pathname.slice(7)));
      if (url.pathname.startsWith('/avatar/')) return await staticFile(join(repoRoot, 'avatar'), decodeURIComponent(url.pathname.slice(8)));
      return await staticFile(join(repoRoot, 'web'), url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1)));
    } catch (error) { return Response.json({ error: message(error) }, { status: 400 }); }
  }, websocket: {
    maxPayloadLength: 1024 * 1024,
    open(client) {
      if (!client.data.authorized) { client.close(4401, 'Pairing required'); return; }
      clients.add(client); if (!micOwner || !voice.micOn) owner(client);
      client.send(JSON.stringify(hello(client.data.autoPaired)));
      client.send(JSON.stringify({ t: 'activity', name: currentActivity }));
      if (lastFace) client.send(JSON.stringify(lastFace));
      if (micOwner === client && voice.micOn) client.send(JSON.stringify({ t: 'mic', on: true }));
      statusChanged();
    },
    message(client, data) {
      if (!client.data.authorized) return;
      if (typeof data !== 'string') { if (client === micOwner && voice.micOn) voice.audio(data); return; }
      try { packet(client, object(JSON.parse(data))).catch(error => client.send(JSON.stringify({ t: 'error', message: message(error) }))); }
      catch (error) { client.send(JSON.stringify({ t: 'error', message: message(error) })); }
    },
    close(client) {
      clients.delete(client);
      if (micOwner === client) { voice.playback(false); micOwner = undefined; lastAudioItem = undefined; if (clients.size) owner(); else voice.sleep(); }
      statusChanged();
    },
  },
});
agent.start(); console.log(`Pip listening on http://127.0.0.1:${server.port}; shell ${shell.path}`);
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return; shuttingDown = true;
  const voiceFinished = voice.finish(); server.stop(true); agent.stop(); shell.stop(); tailscale.stop(); theme.stop(); clearTimeout(faceTimer);
  checks.stop();
  await Promise.all([voiceFinished, notes.finish()]); process.exit(0);
}
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
