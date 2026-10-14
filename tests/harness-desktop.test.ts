import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installDesktop } from './harness/desktop';

test('fake desktop launchers preserve apostrophes in runtime, script, and arguments', () => {
  const root = mkdtempSync(join(tmpdir(), 'pip-launcher-'));
  try {
    const bin = join(root, 'bin'); mkdirSync(bin);
    const executable = join(root, "Pip's bun"), script = join(root, "Pip's script.ts");
    symlinkSync(process.execPath, executable);
    writeFileSync(script, 'console.log(JSON.stringify(process.argv.slice(2)));\n');
    installDesktop(bin, executable, script);
    for (const [name, mode] of [['python3', 'helper'], ['hyprctl', 'hyprctl']] as const) {
      const result = Bun.spawnSync([join(bin, name), "an argument's value"], { stdin: 'ignore' });
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout.toString())).toEqual([mode, "an argument's value"]);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
