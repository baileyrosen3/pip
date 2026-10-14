import { expect, test } from 'bun:test';
import { mockBrain, startServer } from './harness';
import { readdirSync } from 'node:fs';

function audioFiles(root: string): string[] {
  return readdirSync(root, { recursive: true }).map(String).filter(path => /\.(pcm|m4a)$/i.test(path));
}

test('fresh settings use cautious defaults even with a saved OpenAI key', async () => {
  const brain = mockBrain('gemini');
  const pip = await startServer({ brain, settings: null });
  try {
    const settings = await (await pip.request('/api/settings')).json();
    expect(settings).toMatchObject({ computerControl: false, notes: false, autoSleep: 5, provider: 'gemini', voice: true });
    const phone = await pip.phone();
    expect((await phone.waitFor('hello')).settings).toMatchObject({ computerControl: false, notes: false, autoSleep: 5, provider: 'gemini', voice: true });
  } finally { await pip.stop(); await brain.stop(); }
}, 5000);

test('legacy saved settings survive, while missing settings get the new defaults', async () => {
  const brain = mockBrain('openai');
  const saved = { computerControl: true, provider: 'openai', voice: false, autoSleep: 30, volume: .4, replyMode: 'name' };
  const pip = await startServer({ brain, settings: saved });
  try {
    expect(await (await pip.request('/api/settings')).json()).toMatchObject({ ...saved, notes: false });
  } finally { await pip.stop(); }
  const withNotes = await startServer({ brain, settings: { notes: true, autoSleep: 0 } });
  try { expect(await (await withNotes.request('/api/settings')).json()).toMatchObject({ notes: true, autoSleep: 0 }); }
  finally { await withNotes.stop(); await brain.stop(); }
}, 5000);

for (const kind of ['openai', 'gemini'] as const) {
test(`${kind}: meeting notes off writes no audio and makes no transcription request`, async () => {
  const brain = mockBrain(kind);
  const pip = await startServer({ brain, settings: { notes: false } });
  try {
    const phone = await pip.phone();
    phone.wake(); await phone.waitFor('mic', p => p.on === true);
    phone.askStart(); phone.streamPCM(new Int16Array(2400).fill(1200)); phone.askEnd();
    await phone.waitFor('caption', p => p.done === true);
    phone.sleep(); await phone.waitFor('state', p => p.state === 'asleep');
    expect(audioFiles(pip.notesDir)).toEqual([]);
    expect(brain.messages('transcription.request')).toEqual([]);
  } finally { await pip.stop(); await brain.stop(); }
}, 5000);
}

test('computer-control tools refuse to act while off and explain the opt-in', async () => {
  const brain = mockBrain('openai');
  const pip = await startServer({ brain, settings: { computerControl: false, replyMode: 'talk' } });
  try {
    const phone = await pip.phone();
    phone.wake(); await phone.waitFor('mic', p => p.on === true);
    brain.send({ type: 'response.done', response: { status: 'completed', output: [{ type: 'function_call', call_id: 'click', name: 'click', arguments: '{\"x\":100,\"y\":100}' }] } });
    const result = await brain.waitFor('conversation.item.create', p => typeof p.item === 'object' && p.item !== null && 'call_id' in p.item && p.item.call_id === 'click');
    expect(result.item).toEqual({ type: 'function_call_output', call_id: 'click', output: 'Computer control is off. To opt in, turn on Computer control in phone settings or the bar menu and confirm the warning. You can still look and point; do not try another way to click or type.' });
  } finally { await pip.stop(); await brain.stop(); }
}, 5000);

test('the sessions notes toggle records only opted-in audio and defers transcription while off', async () => {
  const brain = mockBrain('openai');
  const pip = await startServer({ brain, settings: { notes: false } });
  try {
    const phone = await pip.phone();
    phone.wake(); await phone.waitFor('mic', p => p.on === true);
    const speak = async () => {
      phone.askStart(); phone.streamPCM(new Int16Array(2400).fill(1200)); phone.askEnd();
      await phone.waitFor('caption', p => p.done === true);
    };
    await speak();
    expect(audioFiles(pip.notesDir)).toEqual([]);
    phone.send({ t: 'settings', notes: true }); await phone.waitFor('settings', p => p.notes === true);
    await speak();
    const recorded = audioFiles(pip.notesDir);
    expect(recorded.length).toBe(1);
    phone.send({ t: 'settings', notes: false }); await phone.waitFor('settings', p => p.notes === false);
    await speak();
    phone.sleep(); await phone.waitFor('state', p => p.state === 'asleep');
    expect(audioFiles(pip.notesDir)).toEqual(recorded);
    expect(brain.messages('transcription.request')).toEqual([]);
    phone.send({ t: 'settings', notes: true }); await phone.waitFor('settings', p => p.notes === true);
    await brain.waitFor('transcription.request');
    expect((await (await pip.request('/api/settings')).json()).notes).toBe(true);
  } finally { await pip.stop(); await brain.stop(); }
}, 5000);
