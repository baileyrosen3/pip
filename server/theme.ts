import { readFileSync, watch, type FSWatcher } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export type Theme = { background: string; foreground: string; accent: string; [key: string]: string };
export const defaultTheme: Theme = { background: '#1a1b26', foreground: '#c0caf5', accent: '#7aa2f7', mode: 'dark' };
export function parseTheme(text: string): Theme | null {
  const colors: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const match = line.match(/^\s*([a-z_]+)\s*=\s*["'](#[a-f\d]{6}|dark|light)["']\s*(?:#.*)?$/i);
    if (match) colors[match[1]] = match[2];
  }
  if (!colors.background || !colors.foreground || !colors.accent) return null;
  return colors as Theme;
}

// Watch directories, not the colours file inode: Omarchy replaces both its theme link
// and colour files during switches. Re-arm after each switch to follow the new link.
export class OmarchyTheme {
  colors: Theme = { ...defaultTheme };
  onChange: (theme: Theme) => void = () => {};
  private watchers: FSWatcher[] = [];
  private timer: NodeJS.Timeout | undefined;
  constructor(private path = join(process.env.XDG_STATE_HOME || join(homedir(), '.local/state'), 'omarchy/current/theme/colors.toml')) {
    this.read(); this.arm();
  }
  private read() {
    let next: Theme | null;
    try { next = parseTheme(readFileSync(this.path, 'utf8')); } catch { return; }
    if (!next || JSON.stringify(next) === JSON.stringify(this.colors)) return;
    this.colors = next; this.onChange(next);
  }
  private changed = () => {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.read(); this.arm(); }, 80);
  };
  private arm() {
    for (const watcher of this.watchers) watcher.close();
    this.watchers = [];
    let directory = dirname(this.path);
    for (let i = 0; i < 3; i++, directory = dirname(directory)) {
      try { const watcher = watch(directory, this.changed); watcher.on('error', this.changed); this.watchers.push(watcher); } catch {}
    }
  }
  stop() { clearTimeout(this.timer); for (const watcher of this.watchers) watcher.close(); this.watchers = []; }
}
