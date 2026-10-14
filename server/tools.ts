import { readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { Agent } from './agent';
import { command, Configuration, message, object, openaiBase } from './config';
import { capture, center, targetList, targets, type Point, type Rect, type ScreenSnapshot } from './screen';
import { Shell } from './shell';
export type ToolResult = { text: string; image?: string };
const actionNames: Record<string, true> = { click: true, type_text: true, press_keys: true, scroll: true, drag: true, open_app: true, open_url: true };
export class Tools {
  snapshot: ScreenSnapshot | null = null;
  private stoppedUntil = 0;
  private queue: { point: Point; rect: Rect }[] = [];
  private holdUntil = 0;
  private homeRequested = false;
  private speaking = false;
  private quietSince = 0;
  private timer: NodeJS.Timeout | undefined;
  private captionTimer: NodeJS.Timeout | undefined;
  private captionText = '';
  private captionDone = false;
  private voicePlaying = false;
  private out = false;
  private generation = 0;
  private dragActive = false;
  private dragTip: Point | undefined;
  private chain: Promise<unknown> = Promise.resolve();
  activity: (name: string | null) => void = () => {};
  constructor(public agent: Agent, public shell: Shell, private config: Configuration) {}
  awake(on: boolean) {
    this.shell.send({ op: 'awake', on }); this.shell.send({ op: 'brainMood', mood: null }); this.shell.send({ op: 'gaze', x: null, y: null });
    if (on) this.agent.send({ op: 'refreshMonitor' });
    else { this.queue = []; this.generation++; this.home(); this.caption('', false); this.shell.send({ op: 'talkTest', seconds: 0 }); }
  }
  home() {
    this.queue = []; this.homeRequested = false; this.out = false; this.generation++;
    this.agent.send({ op: 'dragEnd' });
    if (this.dragActive) { this.dragActive = false; this.shell.send({ op: 'dragging', on: false }); }
    clearInterval(this.timer); this.timer = undefined;
    this.shell.send({ op: 'mode', mode: this.config.settings.followMouse ? 'following' : 'docked' });
    this.shell.send({ op: 'gaze', x: null, y: null }); this.shell.send({ op: 'speechTarget', rect: null });
  }
  stop() {
    this.stoppedUntil = performance.now() + 6000;
    this.shell.send({ op: 'dragging', on: false }); this.home(); this.shell.send({ op: 'bubble', text: 'Stopped', life: 1.6 });
  }
  followTip(event: Record<string, unknown>) {
    if (!this.dragActive || typeof event.x !== 'number' || typeof event.y !== 'number' || !Number.isFinite(event.x) || !Number.isFinite(event.y)) return;
    this.dragTip = [event.x, event.y]; this.agent.send({ op: 'dragMove', x: event.x, y: event.y });
  }
  caption(text: string, done: boolean) {
    clearTimeout(this.captionTimer); this.captionText = text.trim(); this.captionDone = done;
    this.shell.send({ op: 'caption', text: this.captionText || null });
    if (!this.captionText) { this.speaking = this.voicePlaying; this.quietSince = performance.now(); return; }
    this.speaking = true;
    if (done && !this.voicePlaying) this.expireCaption();
  }
  playback(on: boolean) {
    if (this.voicePlaying === on) return;
    this.voicePlaying = on; clearTimeout(this.captionTimer);
    if (on) this.speaking = true;
    else if (this.captionDone && this.captionText) this.expireCaption();
    else if (!this.captionText) { this.speaking = false; this.quietSince = performance.now(); }
  }
  private expireCaption() {
    const seconds = Math.max(4, 1.2 + this.captionText.split(/\s+/).length * .32);
    this.captionTimer = setTimeout(() => {
      this.captionText = ''; this.captionDone = false; this.speaking = false; this.quietSince = performance.now(); this.shell.send({ op: 'caption', text: null });
    }, seconds * 1000);
  }
  async ctl(cmd: string) {
    switch (cmd) {
      case 'point': {
        this.queue = []; this.generation++; clearInterval(this.timer); this.timer = undefined;
        this.agent.send({ op: 'refreshMonitor' });
        const mouse = await this.agent.request('mouse');
        if (typeof mouse.x !== 'number' || typeof mouse.y !== 'number') throw new Error('The pointer position is unavailable.');
        this.shell.send({ op: 'speechTarget', rect: null }); await this.shell.request('fly', { x: mouse.x, y: mouse.y }); this.out = true; break;
      }
      case 'follow': this.config.update({ followMouse: !this.config.settings.followMouse }); this.shell.send({ op: 'settings', followMouse: this.config.settings.followMouse }); this.home(); break;
      case 'dock': this.home(); break;
      case 'hide': this.config.update({ showCursor: !this.config.settings.showCursor }); this.shell.send({ op: 'settings', showCursor: this.config.settings.showCursor }); break;
      case 'talk': this.shell.send({ op: 'talkTest', seconds: 3 }); break;
      case 'stop': this.stop(); break;
      default: throw new Error(`Unknown control command: ${cmd}`);
    }
  }
  run(name: string, argumentsText: string): Promise<ToolResult> {
    const result = this.chain.then(async () => {
      this.activity(name === 'look_at_screen' ? 'looking' : name === 'web_research' ? 'researching' : actionNames[name] ? 'acting' : ['point_at', 'point_at_spot', 'stop_pointing'].includes(name) ? 'pointing' : null);
      try { return await this.runTool(name, object(JSON.parse(argumentsText))); }
      catch (error) { this.activity('error'); return { text: message(error) }; }
    });
    this.chain = result; return result;
  }
  private point(point: Point, rect: Rect) {
    this.queue.push({ point, rect }); this.homeRequested = false;
    if (!this.timer) this.timer = setInterval(() => this.choreograph(), 1000 / 30);
    this.choreograph();
  }
  private choreograph() {
    const now = performance.now();
    if (now >= this.holdUntil && this.queue.length) {
      const target = this.queue.shift()!;
      this.shell.send({ op: 'speechTarget', rect: target.rect }); this.shell.send({ op: 'gaze', x: null, y: null });
      if (!this.speaking) this.quietSince = now;
      this.shell.send({ op: 'mode', mode: 'pinned', x: target.point[0], y: target.point[1] }); this.out = true;
      this.holdUntil = now + 3200; return;
    }
    if (this.queue.length || now < this.holdUntil) return;
    if (!this.out) { clearInterval(this.timer); this.timer = undefined; return; }
    const quiet = this.speaking ? 0 : now - this.quietSince;
    if ((this.homeRequested && quiet > 1200) || quiet > 5000) this.home();
  }
  private grid(x: number, y: number): Point {
    const width = this.snapshot?.size[0] || this.agent.monitor?.width || 1440;
    const height = this.snapshot?.size[1] || this.agent.monitor?.height || 900;
    return [Math.min(1000, Math.max(0, x)) / 1000 * width, Math.min(1000, Math.max(0, y)) / 1000 * height];
  }
  private spot(args: Record<string, unknown>, idKey = 'target_id', xKey = 'x', yKey = 'y') {
    const id = args[idKey];
    if (typeof id === 'string' && this.snapshot) {
      const target = targets(this.snapshot).find(t => t.id === id.trim().toUpperCase());
      if (target) return { point: center(target.rect), name: target.text };
    }
    const x = Number(args[xKey]), y = Number(args[yKey]);
    if (args[xKey] !== undefined && args[yKey] !== undefined && Number.isFinite(x) && Number.isFinite(y)) return { point: this.grid(x, y), name: 'that spot' };
    return null;
  }
  async look(prefix?: string): Promise<ToolResult> {
    try {
      const shot = await capture(this.agent, this.shell); this.snapshot = shot;
      const mouse = await this.agent.request('mouse');
      const point: Point = [Number(mouse.x) || 0, Number(mouse.y) || 0];
      return { text: (prefix ? prefix + "\nHere's the screen now (ids have changed):\n" : '') + targetList(shot, point), image: shot.jpeg };
    } catch (error) { this.activity('error'); return { text: (prefix ? prefix + ' ' : '') + `I can't see the screen: ${message(error)}` }; }
  }
  private async runTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    if (actionNames[name]) {
      if (!this.config.settings.computerControl) return { text: 'Computer control is off. To opt in, turn on Computer control in phone settings or the bar menu and confirm the warning. You can still look and point; do not try another way to click or type.' };
      if (performance.now() < this.stoppedUntil) return { text: "The user pressed stop. Don't do anything else until they ask again." };
      return this.runAction(name, args);
    }
    switch (name) {
      case 'look_at_screen': return this.look();
      case 'point_at': {
        if (!this.snapshot) return { text: 'Call look_at_screen first.' };
        const id = String(args.target_id || '').trim().toUpperCase();
        const target = targets(this.snapshot).find(t => t.id === id);
        if (!target) return { text: `No target ${id}. Use an id from the last look_at_screen.` };
        this.point([target.rect[0] + target.rect[2] / 2, target.rect[1] + target.rect[3] + 3], target.rect);
        return { text: this.queue.length > 1 ? `Queued: your cursor will point at "${target.text}" after the earlier spots.` : `Pointing at "${target.text}".` };
      }
      case 'point_at_spot': {
        if (!Number.isFinite(Number(args.x)) || !Number.isFinite(Number(args.y))) return { text: 'Give x and y.' };
        const point = this.grid(Number(args.x), Number(args.y)); this.point(point, [point[0] - 16, point[1] - 16, 32, 32]); return { text: 'Pointing there.' };
      }
      case 'stop_pointing': this.homeRequested = true; if (!this.timer) this.timer = setInterval(() => this.choreograph(), 1000 / 30); return { text: 'Your cursor will head home once you finish talking.' };
      case 'go_to_sleep': return { text: 'Going to sleep. Say a very short goodbye.' };
      case 'web_research': return this.research(String(args.question || '').trim());
      default: return { text: `Unknown tool ${name}.` };
    }
  }
  private async fly(point: Point, generation: number) {
    if (generation !== this.generation || performance.now() < this.stoppedUntil) throw new Error('Stopped by the user.');
    if (this.shell.connected) { await this.shell.request('fly', { x: point[0], y: point[1] }); this.out = true; }
    if (generation !== this.generation || performance.now() < this.stoppedUntil) throw new Error('Stopped by the user.');
  }
  private async runAction(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    this.queue = []; this.holdUntil = 0; this.homeRequested = false;
    clearInterval(this.timer); this.timer = undefined;
    this.shell.send({ op: 'gaze', x: null, y: null }); this.shell.send({ op: 'speechTarget', rect: null });
    const generation = this.generation;
    const check = () => { if (generation !== this.generation || performance.now() < this.stoppedUntil) throw new Error('Stopped by the user.'); };
    try {
      switch (name) {
        case 'click': {
          const target = this.spot(args);
          if (!target) return { text: 'Tell me what to click: a target id from look_at_screen, or x and y.' };
          const right = args.right === true, count = args.double === true ? 2 : 1;
          await this.fly(target.point, generation); this.shell.send({ op: 'clickEffect', x: target.point[0], y: target.point[1], right });
          await Bun.sleep(90); check(); await this.agent.request('click', { x: target.point[0], y: target.point[1], right, count });
          await Bun.sleep(380); check();
          return this.look(`${right ? 'Right-clicked' : count === 2 ? 'Double-clicked' : 'Clicked'} ${target.name === 'that spot' ? 'there' : `"${target.name}"`}.`);
        }
        case 'type_text': {
          const text = typeof args.text === 'string' ? args.text : '';
          if (!text) return { text: 'Nothing to type.' };
          const field = await this.agent.request('focused'); check();
          if (field.secure === true) return { text: "That's a password field. Ask the user to type it themselves." };
          if (Array.isArray(field.rect) && field.rect.length === 4 && field.rect.every(v => typeof v === 'number')) {
            const [x, y, w, h] = field.rect as Rect;
            const height = this.snapshot?.size[1] || this.agent.monitor?.height || 900;
            if (h < height * 0.6 && x + w > 0 && y + h > 0) await this.fly([x + Math.min(28, w * 0.2), y + h + 2], generation);
          }
          check(); this.shell.send({ op: 'typedEffect', text }); await this.agent.request('type', { text }, Math.max(15_000, text.length * 100));
          if (args.press_return === true) {
            await Bun.sleep(120); check(); await this.agent.request('keys', { keys: 'return' }); this.shell.send({ op: 'bubble', text: '↩' });
            await Bun.sleep(550); check(); return this.look('Typed it and pressed Return.');
          }
          return { text: 'Typed it.' };
        }
        case 'press_keys': {
          const keys = String(args.keys || '').trim();
          const normalized = keys.toLowerCase().replace(/\s/g, '').replace(/control/g, 'ctrl').replace(/option/g, 'alt').replace(/escape/g, 'esc');
          const parts = normalized.split('+');
          if (parts.some(p => ['super', 'meta', 'win', 'windows', 'cmd', 'command'].includes(p)) || (parts.includes('ctrl') && parts.includes('alt') && parts.some(p => ['delete', 'del', 'backspace'].includes(p) || /^f(?:[1-9]|1[0-2])$/.test(p)))) return { text: "I won't press that one (it changes the desktop, logs out or stops the session). Ask the user to do it." };
          check(); const reply = await this.agent.request('keys', { keys }); this.shell.send({ op: 'bubble', text: reply.label || keys });
          await Bun.sleep(380); check(); return this.look(`Pressed ${keys}.`);
        }
        case 'scroll': {
          const direction = String(args.direction || 'down').toLowerCase(), amount = Math.min(10, Math.max(1, Number(args.amount) || 3));
          const point = this.spot(args)?.point || this.grid(500, 500);
          const dx = direction === 'left' ? -amount * 3 : direction === 'right' ? amount * 3 : 0;
          const dy = direction === 'up' ? -amount * 3 : direction === 'down' ? amount * 3 : 0;
          if (!dx && !dy) return { text: 'Scroll direction must be up, down, left or right.' };
          await this.fly(point, generation); this.shell.send({ op: 'bubble', text: dx < 0 ? '←' : dx > 0 ? '→' : dy < 0 ? '↑' : '↓' });
          await this.agent.request('scroll', { x: point[0], y: point[1], dx, dy }); await Bun.sleep(280); check(); return this.look(`Scrolled ${direction}.`);
        }
        case 'drag': {
          const from = this.spot(args, 'from_id', 'from_x', 'from_y'), to = this.spot(args, 'to_id', 'to_x', 'to_y');
          if (!from || !to) return { text: 'Tell me where to drag from and to (ids or x and y).' };
          await this.fly(from.point, generation); check();
          if (this.shell.connected) {
            await this.agent.request('dragBegin', { x: from.point[0], y: from.point[1] });
            this.dragActive = true; this.dragTip = from.point;
            this.shell.send({ op: 'press', depth: 0.1 }); this.shell.send({ op: 'dragging', on: true });
            let landed = false;
            try {
              await Bun.sleep(120); check();
              await this.shell.request('fly', { x: to.point[0], y: to.point[1] }); check(); landed = true;
              await Bun.sleep(80);
            } finally {
              this.dragActive = false; this.shell.send({ op: 'dragging', on: false });
              const end = landed ? to.point : this.dragTip || from.point;
              await this.agent.request('dragEnd', { x: end[0], y: end[1] });
            }
          } else await this.agent.request('drag', { from: from.point, to: to.point }, 20_000);
          await Bun.sleep(280); check(); return this.look('Dragged it.');
        }
        case 'open_app': {
          const name = String(args.name || '').trim(); if (!name) return { text: 'Which app?' };
          this.shell.send({ op: 'bubble', text: `Opening ${name}` }); check(); const result = await this.openApp(name);
          await Bun.sleep(900); check(); return this.look(result);
        }
        case 'open_url': {
          let url = String(args.url || '').trim(); if (!url) return { text: 'Which website?' };
          if (!/^[a-z][a-z\d+.-]*:/i.test(url)) url = 'https://' + url;
          const parsed = new URL(url); if (!['http:', 'https:'].includes(parsed.protocol)) return { text: 'Use a web address (http or https).' };
          check(); await command(['xdg-open', parsed.href]); this.shell.send({ op: 'bubble', text: parsed.hostname });
          await Bun.sleep(1100); check(); return this.look(`Opened ${parsed.href}.`);
        }
        default: return { text: `Unknown action ${name}.` };
      }
    } finally {
      if (generation === this.generation) { this.holdUntil = performance.now() + 1500; if (!this.speaking) this.quietSince = performance.now(); if (!this.timer) this.timer = setInterval(() => this.choreograph(), 1000 / 30); }
    }
  }
  private async openApp(name: string) {
    const needle = name.toLowerCase();
    const directories = [join(process.env.XDG_DATA_HOME || join(homedir(), '.local/share'), 'applications'), ...(process.env.XDG_DATA_DIRS || '/usr/local/share:/usr/share').split(':').map(d => join(d, 'applications'))];
    const seen = new Set<string>(), apps: { id: string; fields: Record<string, string>; score: number }[] = [];
    const walk = (directory: string, prefix = '') => {
      let entries;
      try { entries = readdirSync(directory, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (entry.isDirectory()) { walk(join(directory, entry.name), prefix + entry.name + '-'); continue; }
        if (!entry.name.endsWith('.desktop')) continue;
        const id = prefix + entry.name; if (seen.has(id)) continue; seen.add(id);
        const fields: Record<string, string> = {}; let section = '';
        try { for (const line of readFileSync(join(directory, entry.name), 'utf8').split('\n')) {
          if (line.startsWith('[')) { section = line; continue; }
          const index = line.indexOf('='); if (section === '[Desktop Entry]' && index > 0) fields[line.slice(0, index)] = line.slice(index + 1);
        } } catch { continue; }
        if (fields.Hidden === 'true' || (fields.Type && fields.Type !== 'Application')) continue;
        const candidates = [fields.Name, fields.GenericName, fields.Exec, id, fields.StartupWMClass].filter(Boolean).map(v => v.toLowerCase());
        const score = candidates.some(v => v === needle || v === needle + '.desktop') ? 100 : candidates.some(v => v.startsWith(needle)) ? 60 : candidates.some(v => v.includes(needle)) ? 30 : 0;
        if (score) apps.push({ id, fields, score });
      }
    };
    directories.forEach(d => walk(d)); apps.sort((a, b) => b.score - a.score);
    const raw: unknown = JSON.parse(await command(['hyprctl', 'clients', '-j']));
    const clients = Array.isArray(raw) ? raw.map(object) : [];
    const app = apps[0];
    const match = clients.find(c => {
      const klass = String(c.class || '').toLowerCase();
      return klass === needle || (app && [app.fields.StartupWMClass, app.id.replace(/\.desktop$/, ''), basename((app.fields.Exec || '').split(/\s/)[0])].some(v => v && klass === v.toLowerCase()));
    });
    if (match && typeof match.class === 'string') {
      const escaped = match.class.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Hyprland 0.56's Lua configuration requires the Lua dispatcher, not legacy focuswindow.
      await command(['hyprctl', 'dispatch', `hl.dsp.focus({window=${JSON.stringify(`class:^${escaped}$`)}})`]); return `Switched to ${name}.`;
    }
    if (!app) return `I couldn't find an app named "${name}".`;
    const args = Bun.which('uwsm-app') ? ['uwsm-app', '--', app.id] : ['gtk-launch', app.id];
    const child = Bun.spawn(args, { stdout: 'ignore', stderr: 'pipe', env: process.env });
    const result = await Promise.race([child.exited.then(async code => ({ code, error: await new Response(child.stderr).text() })), Bun.sleep(300).then(() => null)]);
    if (result && result.code !== 0) return `I couldn't open ${name}: ${result.error.trim()}`;
    return `Opened ${name}.`;
  }
  private async research(question: string): Promise<ToolResult> {
    if (!question) return { text: 'What should I research?' };
    if (this.config.settings.provider === 'gemini') return { text: 'Use Google Search grounding in this Gemini Live session and give the answer in one short line; no OpenAI report card is needed.' };
    const provider = this.config.settings.provider;
    this.shell.send({ op: 'report', state: 'loading', question });
    try {
      if (!this.config.secrets.openaiKey) throw new Error('I need an OpenAI API key for research. Add one in settings.');
      const context = this.snapshot?.lines.slice(0, 40).map(e => e.line.text).join(' / ');
      const response = await fetch(`${openaiBase}/responses`, { method: 'POST', headers: { Authorization: `Bearer ${this.config.secrets.openaiKey}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(90_000), body: JSON.stringify({ model: 'gpt-5.5', reasoning: { effort: 'low' }, tools: [{ type: 'web_search' }], instructions: 'Research the question on the web and write a short, friendly report for a busy person. First line: a plain title of under eight words. Then one to four short paragraphs (four at most), leading with the direct answer, then the most useful details. Plain text only: no markdown, no headings, no bullet lists, and no links or citations in the text.', input: question + (context ? "\n\nWhat's on the user's screen, for context: " + context : '') }) });
      if (!response.ok) throw new Error(`The research didn't come back: ${response.status} ${(await response.text()).slice(0, 160)}`);
      const json = object(await response.json()), sources: { title: string; url: string }[] = []; let text = '';
      if (Array.isArray(json.output)) for (const raw of json.output) {
        const item = object(raw); if (item.type !== 'message' || !Array.isArray(item.content)) continue;
        for (const rawPart of item.content) {
          const part = object(rawPart); if (typeof part.text === 'string') text += part.text;
          if (Array.isArray(part.annotations)) for (const rawNote of part.annotations) {
            const note = object(rawNote); if (typeof note.url !== 'string') continue;
            try { const url = new URL(note.url); url.searchParams.delete('utm_source'); if (!sources.some(s => s.url === url.href)) sources.push({ title: typeof note.title === 'string' ? note.title : url.hostname, url: url.href }); } catch {}
          }
        }
      }
      text = text.replace(/\s*\(\[[^\]]*\]\([^)]*\)\)/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\s*\[https?:\/\/[^\]]*\]/g, '').replace(/\*\*|#/g, '');
      const blocks = text.split('\n').map(v => v.trim()).filter(Boolean);
      if (!blocks.length) throw new Error("The research didn't come back: empty answer");
      const title = blocks[0], paragraphs = blocks.slice(1, 5);
      if (this.config.settings.provider !== provider) return { text: 'The brain changed while this research was running; the OpenAI report was cancelled.' };
      this.shell.send({ op: 'report', state: 'show', question, title, paragraphs, sources: sources.slice(0, 5) });
      return { text: "The full report is now in a card on the user's screen. Reply with ONE short line: the key takeaway in your own words. Don't repeat the report.\n---REPORT---\n" + [title, ...paragraphs].join('\n\n') };
    } catch (error) {
      if (this.config.settings.provider !== provider) return { text: 'The brain changed while this research was running; the OpenAI report was cancelled.' };
      this.activity('error'); this.shell.send({ op: 'report', state: 'error', message: message(error) }); return { text: `Research failed: ${message(error)}. Tell the user in a few words.` };
    }
  }
}
