import { expect, test } from 'bun:test';
import { mockBrain, withServer } from './harness';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { waitForFile } from './harness/audio-read-gate';

function audioFiles(root: string): string[] {
  return readdirSync(root, { recursive: true }).map(String).filter(path => /\.(pcm|m4a)$/i.test(path));
}

test('fresh settings use cautious defaults even with a saved OpenAI key', async () => {
  const brain = mockBrain('gemini');
  await withServer({ brain, settings: null }, async pip => {
    const settings = await (await pip.request('/api/settings')).json();
    expect(settings).toMatchObject({ computerControl: false, notes: false, autoSleep: 5, provider: 'gemini', voice: true });
    const phone = await pip.phone();
    expect((await phone.waitFor('hello')).settings).toMatchObject({ computerControl: false, notes: false, autoSleep: 5, provider: 'gemini', voice: true });
  });
}, 5000);

test('legacy saved settings survive, while missing settings get the new defaults', async () => {
  const brain = mockBrain('openai');
  const saved = { computerControl: true, provider: 'openai', voice: false, autoSleep: 30, volume: .4, replyMode: 'name' };
  await withServer({ brain, settings: saved }, async pip => {
    expect(await (await pip.request('/api/settings')).json()).toMatchObject({ ...saved, notes: false });
  });
  await withServer({ brain: mockBrain('openai'), settings: { notes: true, autoSleep: 0 } }, async pip => {
    expect(await (await pip.request('/api/settings')).json()).toMatchObject({ notes: true, autoSleep: 0 });
  });
}, 5000);

for (const kind of ['openai', 'gemini'] as const) {
test(`${kind}: meeting notes off writes no audio and makes no transcription request`, async () => {
  const brain = mockBrain(kind);
  await withServer({ brain, settings: { notes: false } }, async pip => {
    const phone = await pip.phone();
    phone.wake(); await phone.waitFor('mic', p => p.on === true);
    phone.askStart(); phone.streamPCM(new Int16Array(2400).fill(1200)); phone.askEnd();
    await phone.waitFor('caption', p => p.done === true);
    phone.sleep(); await phone.waitFor('state', p => p.state === 'asleep');
    expect(audioFiles(pip.notesDir)).toEqual([]);
    expect(brain.messages('transcription.request')).toEqual([]);
  });
}, 5000);
}

for (const kind of ['openai', 'gemini'] as const) for (const replyMode of ['name', 'hold'] as const) {
test(`${kind}/${replyMode}: notes off saves questions and replies, never ambient speech`, async () => {
  const brain = mockBrain(kind);
  await withServer({ brain, settings: { notes: false, replyMode } }, async pip => {
    const phone = await pip.phone();
    phone.wake(); await phone.waitFor('mic', p => p.on === true);
    const ambient = 'Private background conversation.';
    if (kind === 'openai') {
      brain.send({ type: 'input_audio_buffer.committed', item_id: 'ambient' });
      brain.send({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'ambient', transcript: ambient });
    } else brain.send({ serverContent: { inputTranscription: { text: ambient }, turnComplete: true } });
    // A held question and final reply form a protocol barrier after the ambient turn.
    phone.askStart(); phone.streamPCM(new Int16Array(2400).fill(1200)); phone.askEnd();
    await phone.waitFor('caption', p => p.done === true);
    phone.sleep(); await phone.waitFor('state', p => p.state === 'asleep');
    const sessions = await (await pip.request('/api/sessions')).json() as { id: string; questionCount: number }[];
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.questionCount).toBe(1);
    const savedFiles = readdirSync(pip.notesDir, { recursive: true }).map(String);
    const jsonPath = savedFiles.find(path => path.endsWith('/session.json'))!;
    const notesPath = savedFiles.find(path => path.endsWith('/notes.md'))!;
    const saved = JSON.parse(readFileSync(join(pip.notesDir, jsonPath), 'utf8')) as { entries: { kind: string; text: string }[] };
    expect(saved.entries).toEqual([
      expect.objectContaining({ kind: 'asked', text: 'Pip, say hello.' }),
      expect.objectContaining({ kind: 'reply', text: 'Hello from Pip.' }),
    ]);
    expect(readFileSync(join(pip.notesDir, notesPath), 'utf8')).not.toContain(ambient);
  });
}, 5000);
}

test('computer-control tools refuse to act while off and explain the opt-in', async () => {
  const brain = mockBrain('openai');
  await withServer({ brain, settings: { computerControl: false, replyMode: 'talk' } }, async pip => {
    const phone = await pip.phone();
    phone.wake(); await phone.waitFor('mic', p => p.on === true);
    brain.send({ type: 'response.done', response: { status: 'completed', output: [{ type: 'function_call', call_id: 'click', name: 'click', arguments: '{\"x\":100,\"y\":100}' }] } });
    const result = await brain.waitFor('conversation.item.create', p => typeof p.item === 'object' && p.item !== null && 'call_id' in p.item && p.item.call_id === 'click');
    expect(result.item).toEqual({ type: 'function_call_output', call_id: 'click', output: 'Computer control is off. To opt in, turn on Computer control in phone settings or the bar menu and confirm the warning. You can still look and point; do not try another way to click or type.' });
  });
}, 5000);

test('the sessions notes toggle records only opted-in audio and defers transcription while off', async () => {
  const brain = mockBrain('openai');
  await withServer({ brain, settings: { notes: false } }, async pip => {
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
  });
}, 5000);

for (const kind of ['openai', 'gemini'] as const) {
test(`${kind}: turning notes off during the audio read prevents transcription upload`, async () => {
  const brain = mockBrain(kind);
  await withServer({ brain, settings: { notes: true }, pauseAudioReads: true }, async pip => {
    try {
      const phone = await pip.phone();
      phone.wake(); await phone.waitFor('mic', p => p.on === true);
      phone.askStart(); phone.streamPCM(new Int16Array(2400).fill(1200)); phone.askEnd();
      await phone.waitFor('caption', p => p.done === true);
      phone.sleep(); await phone.waitFor('state', p => p.state === 'asleep');
      await waitForFile(join(pip.root, 'audio-read-started'));
      phone.send({ t: 'settings', notes: false }); await phone.waitFor('settings', p => p.notes === false);
      writeFileSync(join(pip.root, 'audio-read-release'), '');
      // Graceful shutdown joins all notes jobs, so a missing request is not a timing assertion.
      await pip.stop();
      expect(brain.messages('transcription.request')).toEqual([]);
    } finally {
      if (existsSync(pip.root)) writeFileSync(join(pip.root, 'audio-read-release'), '');
    }
  });
}, 5000);
}
