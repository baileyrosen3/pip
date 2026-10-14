import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPersona, stepPersona, reactPersona, pokePersona, activityPersona, ACTS } from '../avatar/persona.mjs';

function step(p, seconds, input) { for (let i = 0; i < Math.ceil(seconds * 60); i++) stepPersona(p, 1 / 60, input); }

test('identical seeds, inputs and reactions produce identical reused Pose sequences', () => {
  const a = createPersona(147), b = createPersona(147), pose = a.pose;
  for (let i = 0; i < 7200; i++) {
    const input = { state: i % 900 < 120 ? 'thinking' : 'listening', gazeX: Math.sin(i / 120), hear: .4 };
    if (i % 600 === 180) { pokePersona(a, .32, .46, 'L'); pokePersona(b, .32, .46, 'L'); }
    if (i % 600 === 300) { reactPersona(a, 'idea'); reactPersona(b, 'idea'); }
    assert.equal(stepPersona(a, 1 / 60, input), pose);
    stepPersona(b, 1 / 60, input);
    assert.deepEqual(a.pose, b.pose); assert.equal(a.act, b.act);
  }
});

test('voice and loader states cancel and gate acts, including explicitly requested acts', () => {
  for (const state of ['asking', 'thinking', 'speaking']) {
    const p = createPersona(2); reactPersona(p, 'sneeze'); stepPersona(p, 1 / 60, { state });
    assert.equal(p.act, null);
    for (const name of Object.keys(ACTS)) { reactPersona(p, name); assert.equal(p.act, null); }
    step(p, 60, { state }); assert.equal(p.act, null);
  }
});

test('hear drives asking bars; speech separates the merged loader', () => {
  const p = createPersona(3); step(p, 1, { state: 'thinking' }); assert.equal(p.pose.merge, 1);
  stepPersona(p, 1 / 60, { state: 'speaking', talk: .8 }); assert.equal(p.pose.merge, 0); assert.ok(p.pose.L.y < 0);
  step(p, 1, { state: 'asking', hear: 0 }); const quiet = p.pose.L.sy;
  step(p, 1, { state: 'asking', hear: 1 }); assert.equal(p.pose.L.shape, 'bar'); assert.ok(p.pose.L.sy > quiet);
});

test('touch escalates to playful, then irritation calms without persistent hostility', () => {
  const p = createPersona(4);
  for (let i = 0; i < 4; i++) pokePersona(p, .32, .46, 'L'); assert.equal(p.flash, 'grumpy');
  for (let i = 0; i < 3; i++) pokePersona(p, .5, .46, 'both'); assert.equal(p.flash, 'mischievous');
  step(p, 25, { state: 'listening', reducedMotion: true }); assert.equal(p.irritation, 0); assert.equal(p.act, null);
});
test('reduced-motion drowsiness holds lowered lids until cleared or sleep/wake', () => {
  const p = createPersona(7);
  stepPersona(p, 1 / 60, { state: 'listening', reducedMotion: true });
  activityPersona(p, 'drowsy');
  stepPersona(p, 1 / 60, { state: 'listening', reducedMotion: true });
  assert.equal(p.pose.L.shape, 'half'); assert.equal(p.pose.R.shape, 'half');
  assert.equal(p.pose.L.open, .55); assert.equal(p.pose.R.open, .55);
  step(p, 7, { state: 'listening', reducedMotion: true });
  assert.equal(p.pose.L.shape, 'half'); assert.equal(p.pose.R.shape, 'half');
  activityPersona(p, null);
  stepPersona(p, 1 / 60, { state: 'listening', reducedMotion: true });
  assert.equal(p.pose.L.shape, 'dot'); assert.equal(p.pose.R.shape, 'dot');

  activityPersona(p, 'drowsy');
  stepPersona(p, 1 / 60, { state: 'waking', reducedMotion: true });
  assert.equal(p.pose.L.shape, 'line'); assert.equal(p.pose.R.shape, 'line');
  stepPersona(p, .2, { state: 'listening', reducedMotion: true });
  assert.equal(p.pose.L.shape, 'dot'); assert.equal(p.pose.R.shape, 'dot');

  activityPersona(p, 'drowsy');
  stepPersona(p, 1 / 60, { state: 'asleep', reducedMotion: true });
  assert.equal(p.pose.L.shape, 'content'); assert.equal(p.pose.R.shape, 'content');
  stepPersona(p, 1 / 60, { state: 'listening', reducedMotion: true });
  assert.equal(p.pose.L.shape, 'dot'); assert.equal(p.pose.R.shape, 'dot');

  const moving = createPersona(8);
  stepPersona(moving, 1 / 60, { state: 'listening' });
  activityPersona(moving, 'drowsy');
  assert.equal(moving.act, 'nodOff');
});


test('reduced motion prevents antics and activity completion releases the task pose', () => {
  const p = createPersona(5); stepPersona(p, 1 / 60, { state: 'listening', reducedMotion: true });
  reactPersona(p, 'sneeze'); assert.equal(p.act, null);
  reactPersona(p, 'blink'); assert.equal(p.act, 'blink'); step(p, 1, { state: 'listening', reducedMotion: true });
  activityPersona(p, 'acting'); stepPersona(p, 1 / 60, { state: 'listening' }); assert.equal(p.pose.L.shape, 'squircle');
  activityPersona(p, null); stepPersona(p, 1 / 60, { state: 'listening' }); assert.equal(p.pose.L.shape, 'dot');
});

test('same-tick tool completion cannot erase the error payoff', () => {
  const p = createPersona(6);
  activityPersona(p, 'error'); activityPersona(p, null);
  stepPersona(p, 1 / 60, { state: 'listening', reducedMotion: true });
  assert.equal(p.pose.L.shape, 'cross'); assert.equal(p.pose.R.shape, 'cross');
  reactPersona(p, 'sneeze'); assert.equal(p.act, null);
  step(p, 2, { state: 'listening', reducedMotion: true }); assert.equal(p.pose.L.shape, 'dot');
});
