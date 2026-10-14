import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Agent, parseMonitor, type Monitor } from './agent';
import { command, object } from './config';
import type { Shell } from './shell';

export type Rect = [number, number, number, number];
export type Point = [number, number];
export type Target = { id: string; text: string; rect: Rect };
export type ScreenSnapshot = { jpeg: string; lines: { line: Target; words: Target[] }[]; controls: Target[]; size: Point; app: string; monitor: Monitor };
export function center(rect: Rect): Point { return [rect[0] + rect[2] / 2, rect[1] + rect[3] / 2]; }
export function targets(shot: ScreenSnapshot) { return [...shot.controls, ...shot.lines.flatMap(entry => [entry.line, ...entry.words])]; }
export function targetList(shot: ScreenSnapshot, mouse: Point) {
  const grid = (rect: Rect) => { const [x, y] = center(rect); return `@${Math.trunc(x / shot.size[0] * 1000)},${Math.trunc(y / shot.size[1] * 1000)}`; };
  const out = shot.app ? [`Frontmost app: ${shot.app}`] : [];
  if (shot.controls.length) out.push('Controls (click these by id):', ...shot.controls.map(c => `${c.id} window ${grid(c.rect)} "${c.text}"`));
  out.push('Text on screen (L = line, W = word, @x,y on a 0-1000 grid):');
  if (!shot.lines.length) out.push('(no text found)');
  out.push(...shot.lines.map(({ line, words }) => `${line.id} ${grid(line.rect)} "${line.text}"${words.length > 1 ? ' | ' + words.map(w => `${w.id}=${w.text}`).join(' ') : ''}`));
  const candidates = targets(shot);
  const distance = (r: Rect) => Math.hypot(Math.max(r[0] - mouse[0], 0, mouse[0] - r[0] - r[2]), Math.max(r[1] - mouse[1], 0, mouse[1] - r[1] - r[3]));
  const hits = candidates.filter(t => distance(t.rect) <= 6).sort((a, b) => a.rect[2] * a.rect[3] - b.rect[2] * b.rect[3]);
  const near = hits[0] || candidates.filter(t => distance(t.rect) < 60).sort((a, b) => distance(a.rect) - distance(b.rect))[0];
  out.push(`The user's mouse pointer is at @${Math.trunc(Math.min(1, Math.max(0, mouse[0] / shot.size[0])) * 1000)},${Math.trunc(Math.min(1, Math.max(0, mouse[1] / shot.size[1])) * 1000)}${near ? `, on ${near.id} "${near.text}"` : ''}. When they say "this", "that" or "here", they mean what's at their mouse pointer.`);
  return out.join('\n');
}
// Default page segmentation preserves line grouping in terminal/browser screenshots better than sparse-text PSM 11.
export async function recognize(path: string, monitor: Monitor): Promise<ScreenSnapshot> {
  const [tsv, jpeg, clientsText, activeText, monitorsText] = await Promise.all([
    command(['tesseract', path, 'stdout', '--psm', '3', 'tsv'], 45_000),
    (async () => {
      const child = Bun.spawn(['magick', path, '-resize', '1100x1100>', '-quality', '72', 'jpeg:-'], { stdout: 'pipe', stderr: 'pipe', env: process.env });
      const [bytes, err, code] = await Promise.all([new Response(child.stdout).arrayBuffer(), new Response(child.stderr).text(), child.exited]);
      if (code !== 0) throw new Error(`JPEG conversion failed: ${err}`);
      return Buffer.from(bytes).toString('base64');
    })(),
    command(['hyprctl', 'clients', '-j']), command(['hyprctl', 'activewindow', '-j']), command(['hyprctl', 'monitors', '-j']),
  ]);
  const grouped = new Map<string, Target[]>();
  for (const row of tsv.split('\n').slice(1)) {
    const columns = row.split('\t');
    if (columns[0] !== '5' || columns.length < 12 || !columns[11].trim() || Number(columns[10]) < 0) continue;
    const values = columns.slice(6, 10).map(Number);
    if (!values.every(Number.isFinite)) continue;
    const rect: Rect = [values[0] / monitor.scale, values[1] / monitor.scale, values[2] / monitor.scale, values[3] / monitor.scale];
    const key = columns.slice(1, 5).join(':');
    const line = grouped.get(key) || []; line.push({ id: '', text: columns.slice(11).join('\t').trim(), rect }); grouped.set(key, line);
  }
  let wordCount = 0;
  const lines = [...grouped.values()].map(words => {
    const x = Math.min(...words.map(w => w.rect[0])), y = Math.min(...words.map(w => w.rect[1]));
    const rect: Rect = [x, y, Math.max(...words.map(w => w.rect[0] + w.rect[2])) - x, Math.max(...words.map(w => w.rect[1] + w.rect[3])) - y];
    return { line: { id: '', text: words.map(w => w.text).join(' '), rect }, words };
  }).sort((a, b) => Math.abs(a.line.rect[1] - b.line.rect[1]) > monitor.height * 0.01 ? a.line.rect[1] - b.line.rect[1] : a.line.rect[0] - b.line.rect[0]).slice(0, 400).map((entry, index) => {
    entry.line.id = `L${index + 1}`;
    entry.words = entry.words.slice(0, 600 - wordCount).map(word => ({ ...word, id: `W${++wordCount}` }));
    return entry;
  });
  const rawMonitors: unknown = JSON.parse(monitorsText);
  const output = Array.isArray(rawMonitors) ? rawMonitors.map(object).find(m => m.name === monitor.name) : undefined;
  const workspace = output ? object(output.activeWorkspace).id : undefined;
  const special = output && output.specialWorkspace ? object(output.specialWorkspace).id : undefined;
  const rawClients: unknown = JSON.parse(clientsText);
  const controls: Target[] = [];
  if (Array.isArray(rawClients)) for (const raw of rawClients) {
    const client = object(raw), ws = client.workspace ? object(client.workspace).id : undefined;
    if (client.mapped === false || client.hidden === true || client.monitor !== output?.id || (ws !== workspace && (!special || ws !== special))) continue;
    if (!Array.isArray(client.at) || !Array.isArray(client.size) || ![...client.at, ...client.size].every(v => typeof v === 'number')) continue;
    const rect: Rect = [Number(client.at[0]) - monitor.x, Number(client.at[1]) - monitor.y, Number(client.size[0]), Number(client.size[1])];
    controls.push({ id: `C${controls.length + 1}`, text: `window: ${String(client.class || '')} — ${String(client.title || '')}`, rect });
  }
  const active = object(JSON.parse(activeText));
  return { jpeg, lines, controls, size: [monitor.width, monitor.height], monitor, app: [active.class, active.title].filter(v => typeof v === 'string' && v.length).join(' — ') };
}
export async function capture(agent: Agent, shell: Shell) {
  agent.send({ op: 'refreshMonitor' });
  const monitor = parseMonitor(await agent.request('monitor'));
  const directory = mkdtempSync(join(tmpdir(), 'pip-screen-'));
  const hide = shell.connected;
  try {
    if (hide) await shell.request('hide', {}, 5000);
    const path = join(directory, 'screen.png');
    const result = await agent.request('capture', { path }, 20_000);
    if (typeof result.scale === 'number' && result.scale !== monitor.scale) monitor.scale = result.scale;
    return await recognize(path, monitor);
  } finally { if (hide) shell.send({ op: 'show' }); rmSync(directory, { recursive: true, force: true }); }
}
