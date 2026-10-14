import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TimingCurve, Flight, CursorEngine } from '../avatar/engine.mjs';
const bounds = { width: 1440, height: 900 }, mouse = { x: 100, y: 100 };
function tick(engine, start, end) { for (let t = start; t < end; t += 1 / 120) engine.step(1 / 120, t, mouse, bounds); }

test('CSS timing curves retain their Swift control points and monotonic endpoints', () => {
  assert.deepEqual([TimingCurve.launch.x1, TimingCurve.launch.y1, TimingCurve.launch.x2, TimingCurve.launch.y2], [.42, 0, .22, 1]);
  assert.deepEqual([TimingCurve.redirect.x1, TimingCurve.redirect.y1, TimingCurve.redirect.x2, TimingCurve.redirect.y2], [.25, .25, .22, 1]);
  assert.deepEqual([TimingCurve.steady.x1, TimingCurve.steady.y1, TimingCurve.steady.x2, TimingCurve.steady.y2], [.42, 0, .38, 1]);
  for (const curve of [TimingCurve.launch, TimingCurve.redirect, TimingCurve.steady]) {
    assert.equal(curve.value(0), 0); assert.equal(curve.value(1), 1);
    let previous = 0;
    for (let i = 0; i <= 1000; i++) {
      const value = curve.value(i / 1000);
      assert.ok(value >= previous - 1e-7); assert.ok(Number.isFinite(curve.rate(i / 1000))); previous = value;
    }
  }
});

test('Flight samples a cubic path and clamps wall-clock progress', () => {
  const f = new Flight({x:0,y:0}, {x:0,y:100}, {x:100,y:100}, {x:100,y:0}, 5, 2, TimingCurve.launch, true);
  assert.equal(f.progress(3), 0); assert.equal(f.progress(6), .5); assert.equal(f.progress(9), 1);
  assert.deepEqual(f.position(.5), {x:50,y:75}); assert.deepEqual(f.tangent(.5), {x:150,y:0});
});

test('Home, launch and exact landing preserve coordinates and callback ownership', () => {
  const e = new CursorEngine({cursorSize:72}, 0, () => .5); let launches = 0, lands = 0;
  e.onLaunch = () => launches++; e.onLand = () => lands++;
  // Docked: the whole pointer (which hangs down-right of the hotspot) stays on screen. Tucked: hidden below the edge.
  const dock = e.dockPoint(bounds), tucked = e.tuckedPoint(bounds);
  assert.ok(dock.y > 0 && dock.y + e.size < bounds.height);
  assert.ok(tucked.y > bounds.height && e.phonePoint(bounds).y > bounds.height);
  e.setMode('docked'); tick(e, 0, 2); assert.deepEqual(e.tip, e.dockPoint(bounds));
  e.setMode('pinned', {x:400,y:300}); tick(e, 2, 4);
  assert.deepEqual(e.tip, {x:400,y:300}); assert.equal(launches, 1); assert.equal(lands, 1); assert.equal(e.timeToArrive(4), 0);
  tick(e, 4, 5); assert.equal(lands, 1);
  e.setMode('following'); tick(e, 5, 7); assert.equal(launches, 2); assert.ok(e.opacity < .01);
});

test('Redirects carry velocity and drags use the original duration limits', () => {
  const e = new CursorEngine({}, 0); e.setMode('pinned', {x:1000,y:200}); tick(e, 0, .3);
  assert.ok(Math.hypot(e.velocity.x, e.velocity.y) > 60);
  e.setMode('pinned', {x:300,y:500}); e.step(1/120, .3, mouse, bounds);
  assert.equal(e.flight.timing, TimingCurve.redirect);
  tick(e, .31, 2); e.dragging = true; e.setMode('pinned', {x:800,y:700}); e.step(1/120, 2, mouse, bounds);
  assert.equal(e.flight.timing, TimingCurve.steady); assert.ok(e.flight.duration >= .6 && e.flight.duration <= 1.6);
});

test('Face gaze, idle sleep, brain override, talk test, squish and hover retain timing', () => {
  const e = new CursorEngine({}, 0, () => .5); e.step(1/60, 0, mouse, bounds);
  assert.equal(e.face(bounds, 6).mood, 'sleepy'); assert.equal(e.face(bounds, 16).mood, 'resting');
  e.awake = true; assert.equal(e.face(bounds, 16).mood, 'listening');
  e.setMode('pinned', {x:200,y:200}); assert.equal(e.face(bounds, 16).mood, 'pointing');
  e.brainMood = 'thinking'; assert.equal(e.face(bounds, 16).mood, 'thinking'); e.brainMood = null;
  e.gazeOverride = {x:.4,y:-.2}; e.talkUntil = 20; const face = e.face(bounds, 16);
  assert.equal(face.gazeX, .4); assert.equal(face.gazeY, -.2); assert.equal(face.mood, 'talking'); assert.ok(face.talk >= 0 && face.talk <= 1);
  e.press(.14, 16); assert.ok(Math.abs(e.pressScale(16.12) - .86) < 1e-9); assert.equal(e.pressScale(17), 1);
  tick(e, 16, 18); assert.equal(e.hover(e.landedAt + .2), 0); assert.ok(Math.abs(e.hover(e.landedAt + 2)) <= 1.6);
});

test('Reused input objects retain Swift coordinate value semantics', () => {
  const e = new CursorEngine({}, 0), point = {x:100,y:100};
  e.step(1/60, 0, point, bounds);
  point.x = 160;
  e.step(1/60, 10, point, bounds);
  assert.equal(e.face(bounds, 10).mood, 'listening');
});
