import { expect, test } from 'bun:test';
import { mockBrain, startServer } from './harness';
import { packet } from './harness/messages';

test('GPT-Live delegates a screen inspection, returns OCR and an image to the backend, and speaks the verified caption', async () => {
  const brain = mockBrain('gptlive', {
    transcript: 'What app is focused on my screen?',
    reply: 'The focused app is Smoke Editor.',
    delegatedScreen: true,
    onMessage(value, socket) {
      if (value.type === 'session.instructions.append' && typeof value.content === 'string' && value.content.startsWith('The user has finished holding')) {
        socket.send(JSON.stringify({ type: 'session.input_transcript.delta', delta: 'What app is focused on my screen?', start_ms: 0, end_ms: 100 }));
        socket.send(JSON.stringify({ type: 'session.output_transcript.delta', delta: 'Checking.' }));
        return true;
      }
    },
  });
  const pip = await startServer({ brain, desktop: 'fake', settings: { voice: true } });
  try {
    const phone = await pip.phone();
    phone.wake();
    await phone.waitFor('mic', value => value.on === true);
    phone.askStart();
    phone.streamPCM(new Int16Array(2400).fill(1200));
    phone.askEnd();
    await phone.waitFor('caption', value => value.done === true && value.text === 'Checking.');
    // Full-duplex Live speech can finish before the delegated backend calls a tool.
    brain.send({ type: 'session.delegation.created', delegation: { id: 'mock-delegation', target: 'responses' } });
    brain.send({ type: 'response.event', delegation_id: 'mock-delegation', event: { type: 'response.created', response: { id: 'mock-response' } } });
    brain.send({ type: 'response.event', delegation_id: 'mock-delegation', event: { type: 'response.output_item.done', item: { type: 'function_call', call_id: 'mock-screen-call', name: 'look_at_screen', arguments: '{}' } } });
    brain.send({ type: 'response.event', delegation_id: 'mock-delegation', event: { type: 'response.completed', response: { id: 'mock-response', output: [] } } });
    const output = await brain.waitFor('response.item.create', value => packet(value.item).type === 'function_call_output');
    expect(packet(output.item).call_id).toBe('mock-screen-call');
    expect(packet(output.item).output).toContain('Frontmost app: Smoke Editor');
    expect(packet(output.item).output).toContain('L1');
    const image = await brain.waitFor('response.item.create', value => packet(value.item).type === 'message');
    const content = packet(image.item).content;
    expect(Array.isArray(content)).toBe(true);
    expect(packet((content as unknown[])[0]).image_url).toMatch(/^data:image\/jpeg;base64,/);
    await brain.waitFor('response.create');
    await phone.waitFor('caption', value => typeof value.text === 'string' && value.text.endsWith('The focused app is Smoke Editor.'));
    expect(phone.audio.reduce((sum, frame) => sum + frame.length, 0)).toBeGreaterThan(0);
    phone.send({ t: 'playback', on: false });
    expect((await phone.waitFor('caption', value => value.done === true)).text).toBe('Checking.The focused app is Smoke Editor.');
    const startup = packet((await brain.waitFor('session.start')).session);
    expect(JSON.stringify(startup.input)).not.toContain('input_image');
    expect(brain.messages('session.thinking.append')).toEqual([]);
    expect(phone.messages('error')).toEqual([]);
  } finally { await pip.stop(); await brain.stop(); }
}, 10_000);

test('GPT-Live backend can point, research, and request computer control without bypassing its guardrails', async () => {
  const calls = [
    { name: 'look_at_screen', arguments: '{}' },
    { name: 'point_at', arguments: '{"target_id":"L1"}' },
    { name: 'point_at_spot', arguments: '{"x":500,"y":500}' },
    { name: 'web_research', arguments: '{"question":"What is the fixture editor?"}' },
    { name: 'type_text', arguments: '{"text":"unsafe input"}' },
  ];
  let next = 0;
  const brain = mockBrain('gptlive', {
    onRequest(request) {
      if (new URL(request.url).pathname.endsWith('/responses')) {
        return Response.json({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'Fixture editor\nSmoke Editor is an isolated test screen.' }] }] });
      }
    },
    onMessage(value, socket) {
      const answerRequest = value.type === 'session.instructions.append' && typeof value.content === 'string' && value.content.startsWith('The user has finished holding');
      if (!answerRequest && value.type !== 'response.create') return;
      if (next === calls.length) {
        socket.send(JSON.stringify({ type: 'session.output_transcript.delta', delta: 'Pointed and researched; the fake desktop refused typing.' }));
        return true;
      }
      if (next === 0) socket.send(JSON.stringify({ type: 'session.input_transcript.delta', delta: 'Pip, inspect, point, research and type.', start_ms: 0, end_ms: 100 }));
      const index = next++, call = calls[index];
      socket.send(JSON.stringify({ type: 'session.delegation.created', delegation: { id: 'workflow', target: 'responses' } }));
      socket.send(JSON.stringify({ type: 'response.event', delegation_id: 'workflow', event: { type: 'response.created', response: { id: `response-${index}` } } }));
      socket.send(JSON.stringify({ type: 'response.event', delegation_id: 'workflow', event: { type: 'response.output_item.done', item: { type: 'function_call', call_id: `call-${index}`, ...call } } }));
      socket.send(JSON.stringify({ type: 'response.event', delegation_id: 'workflow', event: { type: 'response.completed', response: { id: `response-${index}`, output: [] } } }));
      return true;
    },
  });
  const pip = await startServer({ brain, desktop: 'fake', settings: { computerControl: true } });
  try {
    const phone = await pip.phone();
    phone.wake();
    await phone.waitFor('mic', value => value.on === true);
    const startup = packet((await brain.waitFor('session.start')).session);
    const backend = packet(packet(startup.delegation).responses);
    expect(packet(startup.delegation).type).toBe('responses');
    expect((backend.tools as unknown[]).map(value => packet(value).name)).toEqual(expect.arrayContaining(calls.map(call => call.name)));
    phone.askStart();
    phone.streamPCM(new Int16Array(2400).fill(1200));
    phone.askEnd();
    expect((await phone.waitFor('caption', value => value.done === true, 5000)).text).toBe('Pointed and researched; the fake desktop refused typing.');
    const outputs = brain.messages('response.item.create').map(value => packet(value.item)).filter(item => item.type === 'function_call_output');
    expect(outputs.map(item => item.call_id)).toEqual(['call-0', 'call-1', 'call-2', 'call-3', 'call-4']);
    expect(outputs[1].output).toContain('Pointing at "Smoke Editor"');
    expect(outputs[2].output).toBe('Pointing there.');
    expect(outputs[3].output).toContain('Smoke Editor is an isolated test screen.');
    expect(outputs[4].output).toContain('Fake desktop refuses focused');
    expect(brain.messages('response.create')).toHaveLength(5);
    expect(phone.messages('error')).toEqual([]);
  } finally { await pip.stop(); await brain.stop(); }
}, 10_000);
