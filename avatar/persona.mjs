// Deterministic choreography only. The blob engine owns all contour and position physics.
import { clamp, prng } from './core.mjs';

function eye(shape = 'dot') { return { shape, x: 0, y: 0, s: 1, sx: 1, sy: 1, rot: 0, open: 1 }; }
function pair(shape, values = {}) { return { L: Object.assign({ shape }, values), R: Object.assign({ shape }, values) }; }
export const EXPRESSIONS = {
  happy: pair('happy', { s: 1.08, y: -.08 }),
  laugh: pair('happy', { s: 1.12, sx: 1.12, sy: .82, y: -.12 }),
  love: pair('heart', { s: 1.22 }),
  excited: pair('star', { s: 1.23, y: -.13 }),
  proud: pair('happy', { s: 1.1, y: -.22 }),
  curious: { L: { shape: 'wide', s: 1.13, y: -.12 }, R: { shape: 'dot', s: .92, y: .05 } },
  surprised: pair('wide', { s: 1.26, y: -.12 }),
  shocked: pair('pin', { s: .78, y: -.16 }),
  skeptical: { L: { shape: 'half', x: .18, open: .8 }, R: { shape: 'wide', x: .18, s: .95 } },
  smug: pair('half', { y: -.08, x: .16 }),
  annoyed: pair('angry', { sy: .84 }),
  grumpy: pair('angry', { sy: .64, y: .12 }),
  sad: pair('sad', { s: .94, y: .18 }),
  worried: { L: { shape: 'sad', s: .87, rot: -.09, y: .08 }, R: { shape: 'sad', s: .87, rot: .09, y: .08 } },
  embarrassed: { L: { shape: 'half', s: .82, x: -.2, y: .22 }, R: { shape: 'dot', s: .72, x: -.2, y: .22 } },
  shy: pair('half', { s: .72, x: -.18, y: .2 }),
  scared: pair('wide', { s: .7, sx: .9, y: .12 }),
  confused: { L: { shape: 'wide', y: -.15 }, R: { shape: 'half', y: .12 } },
  bored: pair('line', { x: .24, y: .14 }),
  sleepy: pair('half', { open: .55, y: .2 }),
  determined: pair('angry', { s: 1.07, y: -.06 }),
  mischievous: { L: { shape: 'half', y: -.07, x: .12 }, R: { shape: 'happy', s: .94, x: .12 } },
  sorry: pair('sad', { s: .8, y: .26 })
};

const both = (t, shape, values = {}, extra = {}) => Object.assign({ t }, pair(shape, values), extra);
const key = (t, values) => Object.assign({ t }, values);
function act(duration, keys, weight = 1, cooldown = 30) { return { duration, keys, weight, cooldown }; }
// Sparse targets return to the live base pose at the final key, never a stale neutral pose.
export const ACTS = {
  blink: act(.22, [key(0, {}), both(.065, 'dot', { open: 0 }), both(.095, 'dot', { open: 0 }), key(.22, {})], 0, 0),
  doubleBlink: act(.5, [key(0, {}), both(.065, 'dot', { open: 0 }), key(.19, {}), both(.31, 'dot', { open: 0 }), key(.5, {})], 0, 0),
  lookAround: act(3.3, [key(0, {}), both(.25, 'dot', { x: -.38, y: -.16 }), both(.8, 'dot', { x: -.38, y: -.16 }), both(1.05, 'wide', { x: .38, y: -.2 }), both(1.8, 'wide', { x: .38, y: -.2 }), both(2.15, 'dot', { x: .2, y: .23 }), key(3.3, {})], 1, 26),
  sideEye: act(2.4, [key(0, {}), both(.2, 'half', { x: -.42 }), both(1.35, 'half', { x: -.42 }), key(1.7, { L: { shape: 'half', x: -.32 }, R: { shape: 'wide', x: -.32 } }), key(2.4, {})], 1, 28),
  eyeRoll: act(2.6, [key(0, {}), both(.25, 'half'), both(.6, 'dot', { x: -.32, y: -.18, open: .65 }), both(.95, 'dot', { x: 0, y: -.45, open: .65 }), both(1.3, 'dot', { x: .32, y: -.18, open: .65 }), both(1.8, 'half', { y: .07 }), key(2.6, {})], .55, 48),
  sneeze: act(2.65, [key(0, {}), both(.4, 'pill', { s: .84, sy: 1.18, y: -.1 }), both(.85, 'chevronR', { s: .8 }), both(1.15, 'chevronR', { s: .65, y: .12 }), both(1.26, 'wide', { s: 1.22, sy: 1.15, y: -.4 }), both(1.55, 'half', { sx: 1.2, sy: .7, y: .18 }), both(2, 'dot', { s: .9 }), key(2.65, {})], .4, 85),
  yawn: act(3.8, [key(0, {}), both(.55, 'half', { y: .1 }), both(1.05, 'pill', { sy: 1.65, sx: .85, y: -.1 }), both(2.1, 'pill', { sy: 1.65, sx: .85, y: -.1 }), both(2.65, 'content', { s: 1.07, y: .12 }), both(3.1, 'half'), key(3.8, {})], .7, 65),
  daydream: act(5.2, [key(0, {}), both(.7, 'content', { y: -.28, x: .12 }), both(3.3, 'content', { y: -.34, x: .18 }), both(3.65, 'wide', { y: -.05 }), both(4.2, 'half', { x: -.12 }), key(5.2, {})], .7, 60),
  idea: act(2.8, [key(0, {}), both(.4, 'dot', { y: -.3, s: .9 }), both(.7, 'line', { y: -.13 }), both(.95, 'star', { s: 1.2, y: -.22 }), both(1.85, 'star', { s: 1.1, y: -.18 }), both(2.2, 'happy'), key(2.8, {})], .55, 65),
  sigh: act(3.1, [key(0, {}), both(.55, 'wide', { s: 1.08, y: -.13 }), both(.9, 'half', { sy: .8 }), both(1.9, 'half', { s: .88, y: .3 }), both(2.5, 'half', { x: .15, y: .2 }), key(3.1, {})], .6, 48),
  crossEyed: act(2.1, [key(0, {}), both(.2, 'dot', { s: .9 }), key(.5, { L: { x: .94 }, R: { x: -.94 }, merge: .16 }), key(1.25, { L: { x: .94 }, R: { x: -.94 }, merge: .16 }), both(1.42, 'wide', { sx: 1.18 }), key(2.1, {})], .6, 45),
  bounce: act(1.75, [key(0, {}), both(.25, 'happy', { sx: 1.2, sy: .65, y: .15 }), both(.5, 'happy', { sx: .85, sy: 1.2, y: -.48 }), both(.83, 'happy', { sx: 1.22, sy: .74, y: .1 }), both(1.1, 'happy', { y: -.15 }), key(1.75, {})], .8, 32),
  nodOff: act(6.1, [key(0, {}), both(1, 'half', { open: .65, y: .1 }), both(2.7, 'content', { y: .4 }), both(3.7, 'content', { y: .4 }), both(3.85, 'wide', { s: 1.2, y: -.18 }), both(4.5, 'half', { x: -.2, y: .12 }), key(6.1, {})], .5, 95),
  startled: act(1.9, [both(0, 'pin', { s: .68 }), both(.17, 'pin', { s: .68 }), both(.34, 'wide', { s: 1.3, y: -.22 }), both(.72, 'wide', { s: 1.18, y: -.12 }), both(1.2, 'half', { s: .95 }), key(1.9, {})], 0, 12),
  dizzy: act(3.7, [key(0, {}), both(.28, 'dot', { s: .8 }), both(2.6, 'dot', { s: .8 }), both(3, 'half', { y: .15 }), key(3.7, {})], 0, 18)
};
const ACT_NAMES = Object.keys(ACTS);
const FIELDS = ['x', 'y', 's', 'sx', 'sy', 'rot', 'open'];
const DEFAULT_INPUT = {};

export function createPersona(seed = 1) {
  const random = prng(seed);
  return {
    pose: { L: eye(), R: eye(), merge: 0, mergeX: 0, mergeY: 0, spin: 0, tension: 1 },
    random, time: 0, state: 'listening', stateSince: 0, idleSince: 0,
    act: null, actTime: 0, actEvent: 0, cooldowns: Object.create(null), nextAct: 8 + random() * 9,
    drowsy: false,
    nextBlink: 2.5 + random() * 4, blinkTime: -1, doubleBlink: false,
    nextSaccade: 1 + random() * 2, saccadeX: 0, saccadeY: 0,
    gazeX: 0, gazeY: 0, gazeFromX: 0, gazeFromY: 0, gazeAt: -10,
    talk: 0, hear: 0, flight: 0, lastSpeed: 0,
    pokes: 0, lastPoke: -100, irritation: 0, pokeUntil: 0, pokeX: 0, pokeY: 0, pokeEye: '',
    nextBubble: 3 + random() * 3, wakingEvent: false, expressionEvent: false, reducedMotion: false,
    pointing: false, landingAt: -10
  };
}
function resetEye(e) { e.shape = 'dot'; e.x = e.y = e.rot = 0; e.s = e.sx = e.sy = e.open = 1; }
function applyEye(e, values) { if (!values) return; if (values.shape) e.shape = values.shape; for (let i = 0; i < FIELDS.length; i++) { const f = FIELDS[i]; if (values[f] !== undefined) e[f] = values[f]; } }
function apply(pose, values) { applyEye(pose.L, values.L); applyEye(pose.R, values.R); if (values.merge !== undefined) pose.merge = values.merge; if (values.tension !== undefined) pose.tension = values.tension; }
function busy(state) { return state === 'asking' || state === 'thinking' || state === 'speaking' || state === 'waking' || state === 'asleep'; }
function startAct(p, name) {
  if (!ACTS[name] || busy(p.state) || p.activity || p.errorUntil > p.time || p.pointing || (p.reducedMotion && name !== 'blink' && name !== 'doubleBlink')) return false;
  p.act = name; p.actTime = 0; p.actEvent = 0; p.cooldowns[name] = p.time + ACTS[name].cooldown;
  p.blinkTime = -1; return true;
}
export function reactPersona(p, name) {
  if (ACTS[name]) { startAct(p, name); return; }
  if (EXPRESSIONS[name]) { p.flash = name; p.flashUntil = p.time + 3; p.expressionEvent = false; }
}
export function activityPersona(p, name) {
  if (name === 'drowsy') { p.drowsy = true; reactPersona(p, 'nodOff'); return; }
  if (name === null) p.drowsy = false;
  if (name !== null && name !== 'looking' && name !== 'pointing' && name !== 'researching' && name !== 'acting' && name !== 'error') return;
  if (name === 'error') { p.errorSince = p.time; p.errorUntil = p.time + 1.45; p.activityEvent = false; }
  else if (name !== null) p.errorUntil = 0;
  if (p.activity !== name) { p.activity = name; p.activitySince = p.idleSince = p.time; p.activityEvent = false; p.act = null; }
}
export function pokePersona(p, x = .5, y = .5, hit) {
  x = clamp(x, 0, 1); y = clamp(y, 0, 1);
  p.pokes = p.time - p.lastPoke < 4 ? p.pokes + 1 : 1; p.lastPoke = p.idleSince = p.time;
  p.irritation = clamp(p.irritation + .19, 0, 1); p.pokeUntil = p.time + 1.1;
  // The public renderer supplies exact geometry; direct brain calls assume portrait framing.
  p.pokeEye = hit !== undefined ? hit : Math.abs(y - .46) < .055 && Math.abs(x - (x < .5 ? .27 : .73)) < .11 ? (x < .5 ? 'L' : 'R') : Math.abs(x - .5) < .095 && Math.abs(y - .46) < .065 ? 'both' : '';
  p.pokeX = (x - .5) * .85; p.pokeY = (y - .46) * .85;
  if (p.pokes >= 7) { p.flash = 'mischievous'; p.flashUntil = p.time + 2.5; startAct(p, 'bounce'); }
  else if (p.pokes >= 4) { p.flash = 'grumpy'; p.flashUntil = p.time + 2.5; }
  else if (p.pokes >= 2) { p.flash = 'annoyed'; p.flashUntil = p.time + 1.5; }
}
function chooseAct(p) {
  let total = 0;
  for (let i = 0; i < ACT_NAMES.length; i++) { const n = ACT_NAMES[i]; if (n === 'nodOff' && p.time - p.idleSince < 45) continue; if ((p.cooldowns[n] || 0) <= p.time) total += ACTS[n].weight; }
  let pick = p.random() * total;
  for (let i = 0; i < ACT_NAMES.length; i++) { const n = ACT_NAMES[i]; if (n === 'nodOff' && p.time - p.idleSince < 45) continue; if ((p.cooldowns[n] || 0) > p.time || !ACTS[n].weight) continue; pick -= ACTS[n].weight; if (pick <= 0) { startAct(p, n); break; } }
}
function interpolateEye(e, a, b, u) {
  if (a && a.shape) e.shape = a.shape;
  if (b && b.shape && u > .15) e.shape = b.shape;
  for (let i = 0; i < FIELDS.length; i++) { const f = FIELDS[i], base = e[f]; const av = a && a[f] !== undefined ? a[f] : base; const bv = b && b[f] !== undefined ? b[f] : base; e[f] = av + (bv - av) * u; }
}
function performAct(p, dt, engine) {
  const a = ACTS[p.act], pose = p.pose; p.actTime += dt; const t = p.actTime;
  if (t >= a.duration) { p.act = null; p.nextAct = p.time + 7 + p.random() * 10; p.nextBlink = p.time + 1 + p.random() * 3; return; }
  const keys = a.keys; let i = 0; while (i < keys.length - 2 && t > keys[i + 1].t) i++;
  const k0 = keys[i], k1 = keys[i + 1]; let u = clamp((t - k0.t) / (k1.t - k0.t), 0, 1); u = u * u * (3 - 2 * u);
  interpolateEye(pose.L, k0.L, k1.L, u); interpolateEye(pose.R, k0.R, k1.R, u);
  pose.merge = (k0.merge || 0) + ((k1.merge || 0) - (k0.merge || 0)) * u;
  pose.tension = p.act === 'sneeze' || p.act === 'bounce' ? 1.35 : .8;
  if (p.act === 'dizzy') {
    const envelope = Math.min(t / .4, 1) * clamp((3.1 - t) / .7, 0, 1), angle = t * (8 - t);
    // Cancel the full eye homes, orbit a shared centre, then unwind back to home.
    const x = (1.045 - Math.cos(angle) * .8) * envelope, y = Math.sin(angle) * .8 * envelope;
    pose.L.x = x; pose.R.x = -x; pose.L.y += y; pose.R.y -= y;
    pose.L.s = pose.R.s = .8 - .15 * envelope;
  }
  if (p.act === 'sneeze' && t > .65 && t < 1.2) { const wobble = Math.sin(t * 70) * .025; pose.L.x += wobble; pose.R.x -= wobble; }
  const eventAt = p.act === 'sneeze' ? 1.2 : p.act === 'idea' ? .9 : p.act === 'bounce' ? .82 : p.act === 'nodOff' ? 3.8 : -1;
  if (eventAt >= 0 && t >= eventAt && !p.actEvent) { p.actEvent = 1; if (engine) { if (p.act === 'idea') engine.drip('R', 'spark'); else engine.jiggle('both', p.act === 'sneeze' ? .3 : .16); } }
}

export function stepPersona(p, dt, input = DEFAULT_INPUT, engine) {
  dt = clamp(Number.isFinite(dt) ? dt : 0, 0, .1); p.time += dt;
  const t = p.time, pose = p.pose, L = pose.L, R = pose.R;
  p.reducedMotion = !!input.reducedMotion;
  const state = input.holding ? 'asking' : input.state || 'listening';
  if (state !== p.state) { p.state = state; p.stateSince = p.idleSince = t; p.wakingEvent = false; if (busy(state)) p.act = null; else p.nextAct = Math.max(p.nextAct, t + 5); }
  if (state === 'waking' || state === 'asleep') p.drowsy = false;
  if ((busy(state) || p.activity || (p.reducedMotion && p.act !== 'blink' && p.act !== 'doubleBlink')) && p.act) p.act = null;
  resetEye(L); resetEye(R); pose.merge = pose.mergeX = pose.mergeY = pose.spin = 0; pose.tension = p.reducedMotion ? 1.1 : 1;
  const elapsed = t - p.stateSince, calm = p.reducedMotion;
  p.talk += (clamp(input.talk || 0, 0, 1) - p.talk) * (1 - Math.exp(-dt * 24));
  p.hear += (clamp(input.hear || 0, 0, 1) - p.hear) * (1 - Math.exp(-dt * 20));
  if (state === 'asleep') {
    L.shape = R.shape = 'content'; L.y = R.y = .18; const breath = calm ? 0 : Math.sin(t * 1.4) * .035; L.s = R.s = .96 + breath * .4; L.sy = R.sy = 1 + breath; L.y += breath; R.y += breath;
    if (!calm && t >= p.nextBubble) { p.nextBubble = t + 4 + p.random() * 4; if (engine) engine.drip(p.random() < .5 ? 'L' : 'R', 'bubble'); }
  } else if (state === 'waking') {
    if (elapsed < .18) { L.shape = R.shape = 'line'; L.s = R.s = .9; }
    else { L.s = R.s = calm ? 1 : elapsed < .4 ? 1.23 : 1; L.x = R.x = calm ? 0 : elapsed < .7 ? -.22 : elapsed < 1.15 ? .24 : 0; if (!p.wakingEvent) { p.wakingEvent = true; if (engine && !calm) engine.jiggle('both', .2); } }
  } else if (state === 'asking') {
    L.shape = R.shape = 'bar'; L.s = R.s = 1.08 + p.hear * (calm ? .05 : .15); L.sx = R.sx = .76;
    L.sy = .65 + p.hear * (calm ? .65 : 1.35); R.sy = .65 + p.hear * (calm ? .65 : 1.15); L.y = R.y = -.05;
  } else if (state === 'thinking') {
    const merge = clamp(elapsed / (calm ? .4 : .46), 0, 1); pose.merge = merge; pose.spin = calm ? 0 : 2.4; pose.tension = .7;
    L.s = R.s = .88;
    const phase = Math.floor(elapsed / .8) % 3;
    L.shape = R.shape = calm || elapsed < .46 ? 'dot' : phase === 0 ? 'pill' : phase === 1 ? 'drop' : 'squircle';
    L.sx = R.sx = calm ? 1 : .88 + Math.sin(elapsed * 4) * .08;
    L.sy = R.sy = calm ? 1 : 1.12 - Math.sin(elapsed * 4) * .08;
  } else if (state === 'speaking') {
    const beat = calm ? .12 : .32; L.y = -p.talk * beat; R.y = -p.talk * beat * .8;
    L.sy = 1 + p.talk * (calm ? .12 : .28); R.sy = 1 + p.talk * (calm ? .1 : .2); L.sx = 1 - p.talk * .12; R.sx = 1 - p.talk * .1;
    L.s = 1 + p.talk * (calm ? .04 : .14); R.s = 1 + p.talk * (calm ? .03 : .11);
  }
  const a = t < p.errorUntil ? 'error' : p.activity, at = t - (a === 'error' ? p.errorSince : p.activitySince);
  if (a) p.act = null;
  if (a && state !== 'asleep' && state !== 'waking') {
    pose.merge = pose.spin = 0;
    if (a === 'looking') { L.shape = R.shape = at < .65 ? 'wide' : 'dot'; L.s = R.s = at < .65 ? 1.13 : 1; L.x = R.x = calm ? 0 : Math.sin(at * 3.8) * .38; }
    else if (a === 'researching') { L.shape = R.shape = 'pill'; L.s = R.s = .98; const line = (at % 1.4) / 1.4; L.x = R.x = calm ? .1 : -.35 + line * .7; L.y = R.y = calm ? 0 : Math.floor(at / 1.4) % 3 * .08 - .08; }
    else if (a === 'acting') { L.shape = R.shape = 'squircle'; L.s = R.s = .91; L.y = R.y = calm ? 0 : Math.max(0, Math.sin(at * 9)) * .08; }
    else if (a === 'error' && at < 1.45) { L.shape = R.shape = 'cross'; L.x = R.x = calm ? 0 : Math.sin(at * 27) * .12 * Math.max(0, 1 - at / 1.45); if (!p.activityEvent) { p.activityEvent = true; if (engine && !calm) engine.jiggle('both', .16); } }
  }
  // Emotions are idle performances, not a second language that hides the voice/loader.
  const expression = p.flashUntil > t ? p.flash : input.mood;
  if (!busy(state) && !a && EXPRESSIONS[expression]) {
    apply(pose, EXPRESSIONS[expression]);
    if (!calm && (expression === 'excited' || expression === 'love' || expression === 'laugh')) {
      const pulse = Math.sin(t * (expression === 'love' ? 3.2 : 9)) * (expression === 'love' ? .045 : .07);
      L.s += pulse; R.s += pulse * .8;
    }
    if (expression === 'shocked' && p.flashUntil > t) {
      const shockTime = t - (p.flashUntil - 3);
      if (shockTime > .32) { L.shape = R.shape = shockTime < .85 ? 'wide' : 'dot'; L.s = R.s = shockTime < .85 ? 1.18 : 1; }
    }
    if (expression === 'laugh' && !calm) { const laugh = Math.abs(Math.sin(t * 10)); L.y -= laugh * .15; R.y -= laugh * .12; }
    if (!p.expressionEvent && p.flashUntil > t) { p.expressionEvent = true; if (engine && !calm) { if (expression === 'sad' || expression === 'sorry') engine.drip('L', 'tear'); else if (expression === 'worried' || expression === 'embarrassed') engine.drip('R', 'sweat'); else if (expression === 'excited') engine.drip('R', 'spark'); else if (expression === 'laugh') engine.jiggle('both', .16); } }
  }
  p.irritation = Math.max(0, p.irritation - dt * (expression === 'happy' || expression === 'love' ? .16 : .055));
  if (!busy(state) && !a && !EXPRESSIONS[expression] && p.irritation > .18 && t > p.pokeUntil) { L.shape = R.shape = p.irritation > .6 ? 'angry' : 'half'; }
  const gx = clamp(input.gazeX || 0, -1, 1), gy = clamp(input.gazeY || 0, -1, 1);
  const jump = Math.hypot(gx - p.gazeX, gy - p.gazeY);
  if (jump > .06) { p.gazeFromX = p.gazeX; p.gazeFromY = p.gazeY; p.gazeX = gx; p.gazeY = gy; p.gazeAt = t; if (jump > 1.25 && !busy(state) && !a && !calm && (p.cooldowns.startled || 0) <= t) startAct(p, 'startled'); }
  if (t >= p.nextSaccade) { p.nextSaccade = t + .8 + p.random() * 2.2; p.saccadeX = (p.random() - .5) * .11; p.saccadeY = (p.random() - .5) * .07; }
  if (!busy(state) || state === 'asking' || state === 'speaking') {
    const gtime = t - p.gazeAt; let lead = calm ? 1 : gtime < .045 ? -.08 : gtime < .16 ? 1.12 : 1;
    const lookX = (p.gazeFromX + (gx - p.gazeFromX) * lead) * .32 + (calm ? 0 : p.saccadeX), lookY = (p.gazeFromY + (gy - p.gazeFromY) * lead) * .25 + (calm ? 0 : p.saccadeY);
    L.x += lookX; R.x += lookX; L.y += lookY; R.y += lookY;
  }
  const speed = Math.hypot(input.vx || 0, input.vy || 0);
  if (!calm && !busy(state) && !a) {
    p.flight = speed > 2600 ? Math.min(3, p.flight + dt) : Math.max(0, p.flight - dt * .4);
    if (p.flight > 1.2 && speed < 900 && !p.act && (p.cooldowns.dizzy || 0) <= t) { startAct(p, 'dizzy'); p.flight = 0; }
  } else p.flight = 0;
  const pointing = !!input.pointing || a === 'pointing' || state === 'pointing';
  if (pointing && (!p.pointing || (p.lastSpeed >= 90 && speed < 90))) p.landingAt = t;
  p.pointing = pointing; p.lastSpeed = speed;
  if (pointing && !busy(state)) {
    p.act = null;
    const angle = input.angle || 0; L.x = R.x = Math.cos(angle) * .38; L.y = R.y = Math.sin(angle) * .26;
    if (speed < 90 && t - p.landingAt < .55) { L.s = R.s = 1.08; L.shape = Math.cos(angle) >= 0 ? 'chevronR' : 'chevronL'; R.shape = Math.cos(angle) >= 0 ? 'chevronL' : 'chevronR'; }
  }
  if (!busy(state) && !a && !pointing && !calm && !p.act && t >= p.nextAct) { chooseAct(p); p.nextAct = t + 7 + p.random() * 10; }
  if (p.act) performAct(p, dt, engine);
  if (t < p.pokeUntil && !busy(state)) {
    if (p.pokeEye === 'L' || p.pokeEye === 'R') { const e = pose[p.pokeEye]; e.shape = t - p.lastPoke < .3 ? 'line' : 'half'; e.open = .65; }
    else if (p.pokeEye === 'both') { L.x = .82; R.x = -.82; }
    else { L.x = R.x = p.pokeX; L.y = R.y = p.pokeY; }
  }
  // Blink is independent of expression and never flattens a merged loader or voice bars.
  if (!p.act && state !== 'asleep' && state !== 'thinking' && state !== 'asking' && state !== 'waking') {
    if (p.blinkTime < 0 && t >= p.nextBlink) { p.blinkTime = 0; p.doubleBlink = p.random() < .18; }
    if (p.blinkTime >= 0) {
      p.blinkTime += dt; let bt = p.blinkTime;
      if (p.doubleBlink && bt > .24) bt -= .24;
      const open = bt < .065 ? 1 - bt / .065 : bt < .1 ? 0 : clamp((bt - .1) / .12, 0, 1);
      L.open *= open; R.open *= open;
      if (p.blinkTime >= (p.doubleBlink ? .46 : .22)) { p.blinkTime = -1; p.nextBlink = t + 2.8 + p.random() * 4.8; }
    }
  }
  if (calm && p.drowsy) { L.shape = R.shape = 'half'; L.open = R.open = .55; L.y = R.y = .2; }
  return pose;
}
