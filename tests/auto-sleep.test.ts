import { expect, test } from 'bun:test';
import { mockBrain, withServer } from './harness';
import { Messages, packet } from './harness/messages';

const env = { PIPCTL_TEST_TIME_SCALE: '0.003' }; // Five idle minutes become 900 ms; drowsiness leads by 60 ms.
// These integration scenarios deliberately exercise a separate server process's idle clock;
// bun:test fake timers cannot advance that process. The server-only time scale keeps waits short.

test('auto-sleep warns the phone before sleeping and turning its mic off', async () => {
  const brain = mockBrain('openai');
  await withServer({ brain, settings: { autoSleep: 5 }, env }, async pip => {
    const phone = await pip.phone();
    phone.wake();
    await phone.waitFor('mic', p => p.on === true);
    await phone.waitFor('activity', p => p.name === 'drowsy', 2000);
    await phone.waitFor('state', p => p.state === 'asleep', 2000);
    expect(phone.messages('mic').at(-1)?.on).toBe(false);
    const packets = phone.messages();
    expect(packets.findIndex(p => p.t === 'activity' && p.name === 'drowsy')).toBeLessThan(packets.findIndex(p => p.t === 'state' && p.state === 'asleep'));
  });
}, 5000);

test('phone speech activity resets auto-sleep, while microphone silence does not', async () => {
  const brain = mockBrain('openai');
  await withServer({ brain, settings: { autoSleep: 5 }, env }, async pip => {
    const phone = await pip.phone();
    phone.wake(); await phone.waitFor('mic', p => p.on === true);
    await Bun.sleep(600);
    phone.send({ t: 'hear' });
    phone.streamPCM(new Int16Array(2400));
    await Bun.sleep(600);
    expect((await (await pip.request('/api/status')).json()).awake).toBe(true);
    await phone.waitFor('state', p => p.state === 'asleep', 1500);
  });
}, 5000);

for (const event of ['transcription', 'committed turn']) {
test(`brain ${event} resets auto-sleep`, async () => {
  const brain = mockBrain('openai');
  await withServer({ brain, settings: { autoSleep: 5 }, env }, async pip => {
    const phone = await pip.phone();
    phone.wake(); await phone.waitFor('mic', p => p.on === true);
    await Bun.sleep(600);
    brain.send(event === 'transcription'
      ? { type: 'conversation.item.input_audio_transcription.completed', item_id: 'speech', transcript: 'Hello there' }
      : { type: 'input_audio_buffer.committed', item_id: 'speech' });
    await Bun.sleep(600);
    expect((await (await pip.request('/api/status')).json()).awake).toBe(true);
    await phone.waitFor('state', p => p.state === 'asleep', 1500);
  });
}, 5000);
}

for (const busy of ['thinking', 'reply', 'playback', 'holding']) {
test(`auto-sleep pauses during ${busy} and resumes when quiet`, async () => {
  const brain = mockBrain('openai');
  await withServer({ brain, settings: { autoSleep: 5, replyMode: busy === 'thinking' ? 'talk' : 'hold' }, env }, async pip => {
    const phone = await pip.phone();
    phone.wake(); await phone.waitFor('mic', p => p.on === true);
    if (busy === 'holding') phone.askStart();
    else if (busy === 'thinking') brain.send({ type: 'input_audio_buffer.committed', item_id: 'speech' });
    else {
      brain.send({ type: 'response.created', response: { id: 'busy' } });
      if (busy === 'reply') brain.send({ type: 'response.output_audio_transcript.delta', delta: 'Working on it.' });
      if (busy === 'playback') phone.send({ t: 'playback', on: true });
    }
    await Bun.sleep(1200);
    expect((await (await pip.request('/api/status')).json()).awake).toBe(true);
    expect(phone.messages('activity').some(p => p.name === 'drowsy')).toBe(false);
    if (busy === 'holding') phone.askEnd();
    brain.send({ type: 'response.done', response: { status: 'completed', output: [] } });
    if (busy === 'playback') phone.send({ t: 'playback', on: false });
    await phone.waitFor('state', p => p.state === 'asleep', 2000);
  });
}, 5000);
}

test('auto-sleep Off stays awake and settings round-trip over phone and HTTP', async () => {
  const brain = mockBrain('openai');
  await withServer({ brain, settings: { autoSleep: 5 }, env }, async pip => {
    const phone = await pip.phone();
    for (const autoSleep of [0, 5, 10, 30, 0]) {
      phone.send({ t: 'settings', autoSleep });
      await phone.waitFor('settings', p => p.autoSleep === autoSleep);
      expect((await (await pip.request('/api/settings')).json()).autoSleep).toBe(autoSleep);
    }
    phone.wake(); await phone.waitFor('mic', p => p.on === true);
    await Bun.sleep(1200);
    expect((await (await pip.request('/api/status')).json()).awake).toBe(true);
    expect(phone.messages('activity').some(p => p.name === 'drowsy')).toBe(false);
  });
}, 5000);

test('auto-sleep pauses for a running research tool, not just the brain reply', async () => {
  const started = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const brain = mockBrain('openai', { onRequest: request => {
    if (!new URL(request.url).pathname.endsWith('/responses')) return;
    started.resolve();
    return release.promise.then(() => Response.json({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'Report\nThe answer.' }] }] }));
  } });
  await withServer({ brain, settings: { autoSleep: 5, replyMode: 'talk' }, env }, async pip => {
    try {
      const phone = await pip.phone();
      phone.wake(); await phone.waitFor('mic', p => p.on === true);
      brain.send({ type: 'response.done', response: { status: 'completed', output: [{ type: 'function_call', call_id: 'research', name: 'web_research', arguments: '{\"question\":\"A question\"}' }] } });
      await started.promise;
      await Bun.sleep(1200);
      expect((await (await pip.request('/api/status')).json()).awake).toBe(true);
      expect(phone.messages('activity').some(p => p.name === 'drowsy')).toBe(false);
      release.resolve();
      await brain.waitFor('conversation.item.create', p => typeof p.item === 'object' && p.item !== null && 'call_id' in p.item && p.item.call_id === 'research');
      brain.send({ type: 'response.done', response: { status: 'completed', output: [] } });
      await phone.waitFor('state', p => p.state === 'asleep', 2000);
    } finally { release.resolve(); }
  });
}, 5000);

test('bar settings round-trip and overlay receives the drowsy activity', async () => {
  const brain = mockBrain('openai');
  await withServer({ brain, settings: { autoSleep: 0 }, env }, async pip => {
    const received = new Messages('t');
    let buffer = '';
    const shell = await Bun.connect({ unix: pip.shellSocket, socket: {
      data(_socket, bytes) {
        buffer += bytes.toString();
        let newline: number;
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const value = packet(JSON.parse(buffer.slice(0, newline))); buffer = buffer.slice(newline + 1);
          received.push({ ...value, t: value.op });
        }
      },
    } });
    try {
      shell.write(JSON.stringify({ ev: 'hello', role: 'overlay' }) + '\n');
      const phone = await pip.phone();
      const bar = await Bun.connect({ unix: pip.shellSocket, socket: { data() {} } });
      try {
        bar.write(JSON.stringify({ ev: 'hello', role: 'bar' }) + '\n');
        for (const autoSleep of [10, 30, 0, 5]) {
          bar.write(JSON.stringify({ ev: 'settings', autoSleep }) + '\n');
          await phone.waitFor('settings', p => p.autoSleep === autoSleep);
          expect((await (await pip.request('/api/settings')).json()).autoSleep).toBe(autoSleep);
        }
        phone.wake(); await phone.waitFor('mic', p => p.on === true);
        await received.waitFor('activity', p => p.name === 'drowsy');
        await phone.waitFor('state', p => p.state === 'asleep');
      } finally { bar.end(); }
    } finally { shell.end(); }
  });
}, 5000);
