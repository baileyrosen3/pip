import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaults } from '../server/config';
import { realtimeSession } from '../server/session';
import { geminiSetup, toGeminiFunction } from '../server/gemini-session';

test('Gemini tool conversion preserves ids, required arguments and JSON types with blocking execution', () => {
  const tools = realtimeSession({ ...defaults, provider: 'openai' }).tools;
  for (const original of tools) {
    const converted = toGeminiFunction(original);
    assert.equal(converted.name, original.name);
    assert.equal(converted.description, original.description);
    assert.equal(converted.behavior, 'BLOCKING');
    assert.deepEqual(converted.parametersJsonSchema, original.parameters);
    assert.equal('parameters' in converted, false);
    assert.equal('type' in converted, false);
  }
  const click = toGeminiFunction(tools.find(tool => tool.name === 'click')!);
  assert.deepEqual(click.parametersJsonSchema.properties.double, { type: 'boolean', description: 'Double-click instead of a single click.' });
  const point = toGeminiFunction(tools.find(tool => tool.name === 'point_at')!);
  assert.deepEqual(point.parametersJsonSchema.required, ['target_id']);
  const scroll = toGeminiFunction(tools.find(tool => tool.name === 'scroll')!);
  assert.deepEqual(scroll.parametersJsonSchema.properties.direction, { type: 'string', enum: ['up', 'down', 'left', 'right'] });
});

test('Gemini setup never declares paid web_research and honors computer-control permission', () => {
  const setup = geminiSetup({ ...defaults, provider: 'gemini', computerControl: false });
  const functions = setup.tools.flatMap(tool => 'functionDeclarations' in tool ? tool.functionDeclarations : []);
  const names = functions.map(tool => tool.name);
  assert.ok(names.includes('look_at_screen'));
  assert.ok(names.includes('point_at'));
  assert.ok(!names.includes('click'));
  assert.ok(!names.includes('type_text'));
  assert.ok(!names.includes('web_research'));
  assert.ok(setup.tools.some(tool => 'googleSearch' in tool));
});

test('Gemini setup uses raw Live schema, transcription, resumption and documented activity modes', () => {
  for (const mode of ['talk', 'name', 'hold'] as const) {
    const setup = geminiSetup({ ...defaults, provider: 'gemini', replyMode: mode }, 'resume-token');
    assert.equal(setup.model, 'models/gemini-3.8-live');
    assert.deepEqual(setup.generationConfig.responseModalities, ['AUDIO']);
    assert.deepEqual(setup.inputAudioTranscription, {});
    assert.deepEqual(setup.outputAudioTranscription, {});
    assert.deepEqual(setup.sessionResumption, { handle: 'resume-token' });
    assert.deepEqual(setup.contextWindowCompression, { slidingWindow: {} });
    assert.equal(setup.realtimeInputConfig.automaticActivityDetection.disabled, mode === 'hold');
    assert.equal(setup.realtimeInputConfig.turnCoverage, 'TURN_INCLUDES_ALL_INPUT');
    assert.equal(setup.proactivity.proactiveAudio, true);
    assert.ok(!setup.systemInstruction.parts[0].text.includes('The report appears in a card'));
  }
});

test('A required tool argument must have a declared schema property', () => {
  assert.throws(() => toGeminiFunction({ type: 'function', name: 'broken', description: 'Broken schema', parameters: { type: 'object', properties: {}, required: ['missing'] } }), /not declared/);
});

test('Speech controls preserve PCM formats, transcripts and provider-specific interruption policy', () => {
  for (const voice of [false, true]) {
    const openai = realtimeSession({ ...defaults, provider: 'openai', voiceName: 'marin', voice });
    assert.deepEqual(openai.output_modalities, [voice ? 'audio' : 'text']);
    assert.deepEqual(openai.audio.input.format, { type: 'audio/pcm', rate: 24000 });
    assert.equal(openai.audio.input.turn_detection.interrupt_response, voice);
    if (voice) assert.deepEqual(openai.audio.output, { format: { type: 'audio/pcm', rate: 24000 }, voice: 'marin' });
    else assert.equal('output' in openai.audio, false);
    const gemini = geminiSetup({ ...defaults, provider: 'gemini', voice, voiceName: 'Kore' });
    assert.deepEqual(gemini.generationConfig.responseModalities, ['AUDIO']);
    assert.equal(gemini.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, 'Kore');
    assert.equal(gemini.realtimeInputConfig.activityHandling, voice ? 'START_OF_ACTIVITY_INTERRUPTS' : 'NO_INTERRUPTION');
    assert.deepEqual(gemini.outputAudioTranscription, {});
  }
});
