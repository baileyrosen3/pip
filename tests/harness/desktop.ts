import { writeFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { packet } from './messages';

const monitor = { name: 'SMOKE-1', x: 0, y: 0, width: 800, height: 600, scale: 1 };
function quote(value: string) { return "'" + value.replaceAll("'", "'\\''") + "'"; }

/** Stand-ins live only on the isolated server's PATH; no real desktop or input device is opened. */
export function installDesktop(bin: string, executable = process.execPath, script = import.meta.path) {
  for (const [name, mode] of [['python3', 'helper'], ['hyprctl', 'hyprctl']] as const) {
    writeFileSync(join(bin, name),
      `#!/bin/sh\nexec ${quote(executable)} ${quote(script)} ${quote(mode)} "$@"\n`, { mode: 0o700 });
  }
  for (const name of ['magick', 'tesseract']) {
    const executable = Bun.which(name);
    if (!executable) throw new Error(`Screen scenarios require ${name} on PATH.`);
    symlinkSync(executable, join(bin, name));
  }
}

if (import.meta.main) {
  const mode = process.argv[2];
  if (mode === 'hyprctl') {
    const command = process.argv[3];
    if (command === 'activewindow') console.log(JSON.stringify({ class: 'Smoke Editor', title: 'API verification' }));
    else if (command === 'monitors') console.log(JSON.stringify([{ ...monitor, id: 0, activeWorkspace: { id: 1 } }]));
    else if (command === 'clients') console.log(JSON.stringify([{ class: 'Smoke Editor', title: 'API verification', monitor: 0, workspace: { id: 1 }, at: [0, 0], size: [800, 600] }]));
    else process.exit(1); // No dispatchers, including input injection, exist in this helper.
  } else if (mode === 'helper') {
    console.log(JSON.stringify({ ev: 'ready', monitor }));
    for await (const line of createInterface({ input: process.stdin })) {
      const request = packet(JSON.parse(line));
      if (request.op === 'quit') break;
      if (typeof request.id !== 'string') continue;
      let result: Record<string, unknown>;
      if (request.op === 'monitor') result = monitor;
      else if (request.op === 'mouse') result = { x: 200, y: 100 };
      else if (request.op === 'capture' && typeof request.path === 'string') {
        const child = Bun.spawn(['magick', '-size', '800x600', 'xc:white', '-font', join(import.meta.dir, '../../fonts/IBMPlexMono-Regular.ttf'), '-fill', 'black', '-pointsize', '32', '-annotate', '+40+100', 'Smoke Editor', request.path], { stdout: 'ignore', stderr: 'inherit' });
        result = await child.exited === 0 ? { scale: 1 } : { error: 'Could not render the fake screen.' };
      } else result = { error: `Fake desktop refuses ${String(request.op)}; input injection is never allowed.` };
      console.log(JSON.stringify({ id: request.id, ok: !result.error, ...result }));
    }
  } else throw new Error('Unknown fake desktop mode.');
}
