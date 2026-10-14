import { afterAll, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mockBrain, startServer, type BrainKind, type MockBrain, type PipServer } from './harness';

const brains: MockBrain[] = [];
const servers: PipServer[] = [];
afterAll(async () => {
  try { await Promise.all(servers.map(pip => pip.stop())); }
  finally { await Promise.all(brains.map(brain => brain.stop())); }
});

for (const kind of ['openai', 'gemini', 'gptlive'] satisfies BrainKind[]) {
test(`${kind}: phone wakes Pip, asks a spoken question, receives a final caption, and sleeps`, async () => {
  const brain = mockBrain(kind, { reply: 'Hello from Pip.' });
  brains.push(brain);
  const pip = await startServer({ brain });
  servers.push(pip);
  const phone = await pip.phone();
  expect((await phone.waitFor('hello')).state).toBe('asleep');
  phone.wake();
  await phone.waitFor('mic', packet => packet.on === true);
  phone.askStart();
  phone.streamPCM(new Int16Array(2400).fill(1200));
  phone.askEnd();
  await phone.waitFor('state', packet => packet.state === 'thinking');
  await phone.waitFor('state', packet => packet.state === 'speaking');
  const caption = await phone.waitFor('caption', packet => packet.done === true);
  expect(caption.text).toBe('Hello from Pip.');
  phone.sleep();
  await phone.waitFor('mic', packet => packet.on === false);
  await phone.waitFor('state', packet => packet.state === 'asleep');
  expect(phone.messages('error')).toEqual([]);
  const status = await (await pip.request('/api/status')).json();
  expect(status.shell.path).toBe(pip.shellSocket);
  expect(new URL(pip.url).port).not.toBe('7319');
  await pip.stop();
  expect(existsSync(pip.root)).toBe(false);
  expect(() => process.kill(pip.pid, 0)).toThrow();
}, 5000);
}
