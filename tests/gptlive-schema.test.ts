import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaults } from '../server/config';
import { gptLiveBackendModel, gptLiveModel, gptLiveSession, toResponsesFunction } from '../server/gptlive-session';
import { sessionTools } from '../server/session';

test('GPT-Live uses audio-only frontend speech and managed Responses delegation', () => {
  const settings = { ...defaults, provider: 'gptlive' as const, voiceName: 'willow' };
  const session = gptLiveSession(settings);
  assert.equal(session.model, gptLiveModel);
  assert.deepEqual(session.audio, { format: { type: 'audio/pcm', rate: 24000 }, output: { voice: 'willow' } });
  assert.equal('modalities' in session, false);
  assert.equal('tools' in session, false);
  assert.deepEqual(session.delegation, {
    type: 'responses',
    responses: {
      model: gptLiveBackendModel,
      instructions: session.delegation.responses.instructions,
      tools: sessionTools(settings).map(toResponsesFunction),
      tool_choice: 'auto',
      parallel_tool_calls: false,
    },
  });
  for (const heading of ['Backchannel policy:', 'Interruption policy:', 'Delegation policy:', 'Backend tools:', 'Delegate to the backend when:', 'Do not delegate to the backend when:']) {
    assert.ok(session.instructions.includes(heading), `missing prompt heading: ${heading}`);
  }
  assert.match(session.delegation.responses.instructions, /web_research/);
  assert.match(session.delegation.responses.instructions, /look_at_screen/);
});

test('GPT-Live seed context stays text-only in the frontend input', () => {
  const session = gptLiveSession({ ...defaults, provider: 'gptlive', voiceName: 'vesper' }, 'Earlier note');
  assert.equal(session.input.length, 1);
  const seeded = session.input[0]!;
  assert.equal(seeded.role, 'user');
  assert.deepEqual(seeded.content, [{ type: 'input_text', text: "Context from this session's notes. Use it as background, not as a new request, and do not respond to it now.\nEarlier note" }]);
  assert.equal(JSON.stringify(session.input).includes('input_image'), false);
});

test('Responses function schemas preserve each existing tool name and parameters', () => {
  for (const original of sessionTools({ ...defaults, provider: 'gptlive' })) {
    const converted = toResponsesFunction(original);
    assert.deepEqual(converted, { type: 'function', name: original.name, description: original.description, parameters: original.parameters, strict: false });
  }
});

test('GPT-Live has no text-only frontend or manual voice-turn controls', () => {
  const session = gptLiveSession({ ...defaults, provider: 'gptlive', voice: false, voiceName: 'vesper', replyMode: 'hold' });
  assert.deepEqual(session.audio, { format: { type: 'audio/pcm', rate: 24000 }, output: { voice: 'vesper' } });
  assert.match(session.instructions, /Speak aloud/);
  assert.equal('turn_detection' in session.audio, false);
  assert.equal('output_modalities' in session, false);
});
