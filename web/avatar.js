import {createRig, stepRig, poke, react, activity, setEyeStyle, setEyeSize, drawFace, makePalette} from '/avatar/pip.mjs';
import {defaultTheme, normalizeTheme} from './theme.js';

// Browser-only plumbing. The shared module owns every pixel of Pip's screen-sized face.
export function createAvatar(canvas) {
  const ctx = canvas.getContext('2d');
  const seed = crypto.getRandomValues(new Uint32Array(1))[0];
  const rig = createRig(seed);
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let theme = defaultTheme, color = 'theme';
  let palette = makePalette(theme, color);
  let state = 'asleep', holding = false, level = 0, hear = 0, packetTalk = 0, destroyed = false;
  let width = 0, height = 0, dpr = 1, lastTime = null, lastPacket = -Infinity;
  const target = {gazeX: 0, gazeY: 0, mood: 'listening', talk: 0};
  const input = {gazeX: 0, gazeY: 0, mood: 'listening', talk: 0, state, holding, now: 0, home: true, angle: 0, reducedMotion: reducedMotion.matches};
  function rebuildPalette() { palette = makePalette(theme, color); if(canvas.id==='face'){document.querySelector('meta[name="theme-color"]').content=palette.face;document.documentElement.style.setProperty('--voice-ink',palette.ink);} }
  function resize() {
    width = canvas.clientWidth; height = canvas.clientHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
  }
  function tick(ms) {
    if (destroyed) return;
    const now = ms / 1000;
    const dt = Math.min(Math.max(now - (lastTime ?? now), 0), 0.05);
    lastTime = now;
    if (width !== canvas.clientWidth || height !== canvas.clientHeight || dpr !== Math.min(window.devicePixelRatio || 1, 3)) resize();
    if (width <= 0 || height <= 0) { frame = requestAnimationFrame(tick); return; }
    const blend = 1 - Math.exp(-dt * 18), live = now - lastPacket < 2.5;
    input.gazeX += ((live ? target.gazeX : 0) - input.gazeX) * blend;
    input.gazeY += ((live ? target.gazeY : 0) - input.gazeY) * blend;
    packetTalk += ((live ? target.talk : 0) - packetTalk) * blend;
    input.talk = Math.max(packetTalk, level); input.hear = hear;
    input.mood = live ? target.mood : 'listening';
    input.state = state; input.holding = holding; input.now = now;
    input.reducedMotion = reducedMotion.matches;
    stepRig(rig, dt, input);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawFace(ctx, rig, width, height, palette);
    frame = requestAnimationFrame(tick);
  }
  resize();
  let frame = requestAnimationFrame(tick);
  return {
    setFace(face) { Object.assign(target, {gazeX: face.gazeX, gazeY: face.gazeY, mood: face.mood, talk: face.talk}); lastPacket = performance.now() / 1000; },
    setState(value) { state = value; },
    setHolding(value) { holding = value; },
    setLevel(value) { level = Math.max(0, Math.min(1, value)); },
    setHear(value) { hear = Math.max(0, Math.min(1, value)); },
    activity(name) { activity(rig, name); },
    setEyeStyle(value) { setEyeStyle(rig, value); },
    setEyeSize(value) { setEyeSize(rig, value); },
    setColor(value) { color = value; rebuildPalette(); },
    setTheme(value) { theme = normalizeTheme(value); rebuildPalette(); },
    poke(x, y) { poke(rig, x, y); },
    react(name) { react(rig, name); },
    resize,
    destroy() { destroyed = true; cancelAnimationFrame(frame); ctx.clearRect(0, 0, canvas.width, canvas.height); },
  };
}
