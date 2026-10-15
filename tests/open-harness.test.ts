import { expect, test } from 'bun:test';
import { startServer } from './harness/server';
import { mockOpen } from './harness/open-brain';
import type { Phone } from './harness/phone';

function turn(phone: Phone) {
  phone.streamPCM(new Int16Array(7200).fill(2400));
  phone.streamPCM(new Int16Array(16800));
}

test('Open talk turns become transcription, streamed captions and speech on the phone', async () => {
  const brain = mockOpen({ speechWav: true });
  const pip = await startServer({ brain, settings: { replyMode: 'talk', voice: true }, keys: { openai: '', gemini: '' } });
  try {
    const phone = await pip.phone(); phone.wake();
    await phone.waitFor('mic', value => value.on === true);
    turn(phone);
    const first = await phone.waitFor('caption', value => value.text === 'Hello' && value.done === false);
    expect(first.text).toBe('Hello');
    await phone.waitFor('caption', value => value.text === 'Hello there.' && value.done === true);
    expect((await brain.requests.waitFor('stt')).file).toBeInstanceOf(File);
    expect((await brain.requests.waitFor('tts')).input).toBe('Hello there.');
    expect(phone.audio.reduce((total, bytes) => total + bytes.length, 0)).toBe(4800);
    expect(JSON.stringify((await brain.requests.waitFor('chat')).tools)).not.toContain('web_research');
    expect(phone.messages('error')).toEqual([]);
  } finally { await pip.stop(); brain.stop(); }
});

test('Waking Pip on the Open brain warms the chat model with his instructions and tools before anyone speaks', async () => {
  const brain = mockOpen({});
  const pip = await startServer({ brain, settings: { replyMode: 'talk' }, keys: { openai: '', gemini: '' } });
  try {
    const phone = await pip.phone(); phone.wake(); await phone.waitFor('mic', value => value.on === true);
    const warm = await brain.requests.waitFor('warm');
    expect(warm.max_tokens).toBe(1);
    expect(JSON.stringify(warm.tools)).toContain('look_at_screen');
    expect(JSON.stringify(warm.messages)).toContain('You are Pip');
    expect(brain.requests.messages('chat')).toEqual([]);
  } finally { await pip.stop(); brain.stop(); }
});

test('Open tool loop gives the model screen text and an image before answering', async () => {
  const brain = mockOpen({ screen: true });
  const pip = await startServer({ brain, desktop: 'fake', settings: { replyMode: 'talk' } });
  try {
    const phone = await pip.phone(); phone.wake(); await phone.waitFor('mic', value => value.on === true);
    turn(phone);
    await phone.waitFor('caption', value => value.text === 'Hello there.' && value.done === true);
    const chats = brain.requests.messages('chat');
    expect(chats).toHaveLength(2);
    expect(JSON.stringify(chats[1].messages)).toContain('Frontmost app: Smoke Editor');
    expect(JSON.stringify(chats[1].messages)).toContain('data:image/jpeg;base64,');
    expect(JSON.stringify(chats[0].tools)).toContain('look_at_screen');
  } finally { await pip.stop(); brain.stop(); }
});

test('Open hold mode transcribes only the held turn and responds after release', async () => {
  const brain = mockOpen();
  const pip = await startServer({ brain, settings: { replyMode: 'hold', voice: false } });
  try {
    const phone = await pip.phone(); phone.wake(); await phone.waitFor('mic', value => value.on === true);
    phone.askStart(); phone.streamPCM(new Int16Array(7200).fill(2000));
    await phone.waitFor('state', value => value.state === 'asking');
    expect(brain.requests.messages('stt')).toHaveLength(0);
    phone.askEnd();
    await phone.waitFor('caption', value => value.text === 'Hello there.' && value.done === true);
    expect(brain.requests.messages('stt')).toHaveLength(1);
    expect(brain.requests.messages('tts')).toHaveLength(0);
    expect(phone.messages('chirp').length).toBeGreaterThan(0);
  } finally { await pip.stop(); brain.stop(); }
});

test('Open name mode transcribes background turns without answering or saving them when notes are off', async () => {
  const brain = mockOpen({ transcript: ['Just talking to somebody else.', 'Hello there?'], blockFirstSTT: true });
  const pip = await startServer({ brain, settings: { replyMode: 'name' } });
  try {
    const phone = await pip.phone(); phone.wake(); await phone.waitFor('mic', value => value.on === true);
    turn(phone); await brain.requests.waitFor('stt');
    // A later held answer is a barrier after the ambient turn in the real server.
    phone.askStart(); phone.streamPCM(new Int16Array(7200).fill(2000)); phone.askEnd();
    await phone.waitFor('state', value => value.state === 'thinking');
    brain.release();
    await phone.waitFor('caption', value => value.done === true && value.text === 'Hello there.');
    expect(brain.requests.messages('stt')).toHaveLength(2);
    expect(brain.requests.messages('chat')).toHaveLength(1);
    const sessions = await (await pip.request('/api/sessions')).json();
    expect(JSON.stringify(sessions)).not.toContain('Just talking');
    expect(sessions[0].questionCount).toBe(1);
    expect(sessions[0].summary).toBe('Hello there?');
  } finally { await pip.stop(); brain.stop(); }
});

test('Open addressed name turns answer and preserve the asked transcript', async () => {
  const brain = mockOpen({ transcript: 'Hello Pip, are you there?' });
  const pip = await startServer({ brain, settings: { replyMode: 'name', voice: false } });
  try {
    const phone = await pip.phone(); phone.wake(); await phone.waitFor('mic', value => value.on === true);
    turn(phone); await phone.waitFor('caption', value => value.done === true && value.text === 'Hello there.');
    const sessions = await (await pip.request('/api/sessions')).json();
    expect(JSON.stringify(sessions)).toContain('Hello Pip, are you there?');
  } finally { await pip.stop(); brain.stop(); }
});

test('Open barge-in clears phone audio and cancels an in-flight streamed reply', async () => {
  const brain = mockOpen({ slow: true });
  const pip = await startServer({ brain, settings: { replyMode: 'talk' } });
  try {
    const phone = await pip.phone(); phone.wake(); await phone.waitFor('mic', value => value.on === true);
    turn(phone); await phone.waitFor('caption', value => value.text === 'Hello');
    phone.send({ t: 'bargeIn' });
    await phone.waitFor('caption', value => value.text === '');
    brain.release(); await brain.requests.waitFor('streamDone');
    expect(phone.messages('audioStop').length).toBeGreaterThan(0);
    expect(phone.messages('caption').some(value => value.text === 'Hello there.')).toBe(false);
    expect(brain.requests.messages('tts')).toHaveLength(0);
    expect(brain.cancelled).toBe(true);
  } finally { await pip.stop(); brain.stop(); }
});

test('A short noise while Pip is thinking does not throw his answer away', async () => {
  const brain = mockOpen({ slow: true });
  const pip = await startServer({ brain, settings: { replyMode: 'talk' } });
  try {
    const phone = await pip.phone(); phone.wake(); await phone.waitFor('mic', value => value.on === true);
    turn(phone); await phone.waitFor('caption', value => value.text === 'Hello');
    // A cough or a clack: under the minimum speech length, so it never becomes a turn.
    phone.streamPCM(new Int16Array(2400).fill(3000)); phone.streamPCM(new Int16Array(16800));
    brain.release();
    await phone.waitFor('caption', value => value.text === 'Hello there.' && value.done === true);
    expect(brain.cancelled).toBe(false);
  } finally { await pip.stop(); brain.stop(); }
});

test('Empty or garbled transcripts (echo, noise) are not treated as questions', async () => {
  const brain = mockOpen({ transcript: ['', 'four four four four four four four four four four', 'Pip, hello there.'] });
  const pip = await startServer({ brain, settings: { replyMode: 'talk' } });
  try {
    const phone = await pip.phone(); phone.wake(); await phone.waitFor('mic', value => value.on === true);
    turn(phone); turn(phone); turn(phone);
    // Turns are handled in order, so by the time the real question is answered the junk ones were judged.
    await phone.waitFor('caption', value => value.text === 'Hello there.' && value.done === true);
    const chats = brain.requests.messages('chat');
    expect(chats).toHaveLength(1);
    expect(JSON.stringify(chats[0].messages)).not.toContain('four four');
  } finally { await pip.stop(); brain.stop(); }
});

test('Open endpoint failures name the failed service and explain how to start it', async () => {
  const brain = mockOpen({ down: 'llm' });
  const pip = await startServer({ brain, settings: { replyMode: 'talk' } });
  try {
    const phone = await pip.phone(); phone.wake(); await phone.waitFor('mic', value => value.on === true);
    turn(phone);
    const error = await phone.waitFor('error');
    expect(error.message).toContain('LLM service unavailable');
    expect(error.message).toContain('Start Ollama:');
    expect(error.message).toContain('ollama serve');
  } finally { await pip.stop(); brain.stop(); }
});

test('Open endpoint settings merge without leaking any endpoint key to the phone or config file', async () => {
  const brain = mockOpen();
  const pip = await startServer({ brain });
  try {
    const phone = await pip.phone();
    const key = 'fixture-private-endpoint-key';
    phone.send({ t: 'settings', open: { stt: { model: 'changed', key } } });
    const settings = await phone.waitFor('settings', value => {
      const open = value.open as { stt?: { model?: string } } | undefined;
      return open?.stt?.model === 'changed';
    });
    expect(JSON.stringify(settings)).not.toContain(key);
    const saved = await (await pip.request('/api/settings')).json();
    expect(saved.open.stt.baseUrl).toBe(brain.baseURL);
    expect(saved.open.llm.model).toBe('fixture');
    expect(JSON.stringify(saved)).not.toContain(key);
    const config = await Bun.file(`${pip.configDir}/config.json`).text();
    const secrets = await Bun.file(`${pip.configDir}/secrets.json`).json();
    expect(config).not.toContain(key);
    expect(secrets.open.stt).toBe(key);
  } finally { await pip.stop(); brain.stop(); }
});

test('Open VAD rejects clicks and keeps a 300 ms pre-roll around a real turn', async () => {
  const brain = mockOpen();
  const pip = await startServer({ brain, settings: { replyMode: 'talk', voice: false } });
  try {
    const phone = await pip.phone(); phone.wake(); await phone.waitFor('mic', value => value.on === true);
    phone.streamPCM(new Int16Array(480).fill(2500)); phone.streamPCM(new Int16Array(16800));
    phone.streamPCM(new Int16Array(7200)); turn(phone);
    await phone.waitFor('caption', value => value.done === true && value.text === 'Hello there.');
    expect(brain.requests.messages('stt')).toHaveLength(1);
    const request = await brain.requests.waitFor('stt');
    const file = request.file as File;
    // 300 ms pre-roll + 300 ms speech + 660 ms hangover at 48 bytes/ms, plus WAV.
    expect(file.size).toBe(60524);
  } finally { await pip.stop(); brain.stop(); }
});

test('Open checklist checks three endpoints and gives a missing-model pull command', async () => {
  const brain = mockOpen();
  const pip = await startServer({ brain, settings: { open: { ...brain.settings, llm: { baseUrl: brain.baseURL, model: 'missing-model' } } } });
  try {
    const status = await (await pip.request('/api/status')).json();
    const checks = status.checks as { id: string; ok: boolean; fix?: { command: string } }[];
    expect(checks.filter(check => check.id.startsWith('open-')).map(check => check.ok)).toEqual([true, false, true]);
    expect(checks.find(check => check.id === 'open-llm')?.fix?.command).toBe("ollama pull 'missing-model'");
  } finally { await pip.stop(); brain.stop(); }
});

test('Open checklist does not probe services for another brain', async () => {
  const brain = mockOpen();
  const pip = await startServer({ brain, settings: { provider: 'gemini' } });
  try {
    const status = await (await pip.request('/api/status')).json();
    expect(status.checks.some((check: { id: string }) => check.id.startsWith('open-'))).toBe(false);
  } finally { await pip.stop(); brain.stop(); }
});

test('Open meeting notes sends saved recordings to its configured local STT without a cloud key', async () => {
  const brain = mockOpen();
  const pip = await startServer({ brain, settings: { replyMode: 'talk', notes: true, voice: false }, keys: { openai: '', gemini: '' } });
  try {
    const phone = await pip.phone(); phone.wake(); await phone.waitFor('mic', value => value.on === true);
    turn(phone); await phone.waitFor('caption', value => value.done === true && value.text === 'Hello there.');
    await pip.stop(); // Graceful shutdown joins the actual recording-transcription job.
    const requests = brain.requests.messages('stt');
    expect(requests).toHaveLength(2);
    expect((requests[1].file as File).name).toBe('chunk.m4a');
    expect(requests[1].model).toBe('fixture');
  } finally { await pip.stop(); brain.stop(); }
});
