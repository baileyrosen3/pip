import type { Settings } from './config';
import { sessionTools, sessionInstructions } from './session';
import type { FunctionTool } from './session';
export const geminiLiveModel = 'gemini-3.8-live';
export type GeminiFunction = { name: string; description: string; behavior: 'BLOCKING'; parametersJsonSchema: FunctionTool['parameters'] };
/** parametersJsonSchema is the Live API's documented JSON-Schema field: keep ids, required fields and booleans intact. */
export function toGeminiFunction(tool: FunctionTool): GeminiFunction {
  if (tool.parameters.type !== 'object') throw new Error('A function must have an object parameter schema.');
  for (const required of tool.parameters.required) if (!Object.hasOwn(tool.parameters.properties, required)) throw new Error(`Required parameter ${required} is not declared.`);
  return { name: tool.name, description: tool.description, behavior: 'BLOCKING', parametersJsonSchema: tool.parameters };
}
/** Keep the raw Live endpoint and its setup together so API-version compatibility is testable. */
export function geminiConnection(settings: Settings, base: string, key: string, handle?: string) {
  // Proactive audio is accepted by v1alpha; the deployed v1beta rejects setup.proactivity with 1007.
  const url = new URL(base.replace(/^http/, 'ws') + '/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent');
  url.searchParams.set('key', key);
  return { url, setup: geminiSetup(settings, handle) };
}
export function geminiSetup(settings: Settings, handle?: string) {
  const functions = sessionTools(settings).filter(tool => tool.name !== 'web_research').map(toGeminiFunction);
  // Raw BidiGenerateContent uses generationConfig, not the SDK's flattened responseModalities option.
  return {
    model: `models/${geminiLiveModel}`,
    generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: settings.voiceName } } } },
    systemInstruction: { parts: [{ text: sessionInstructions(settings, 'gemini') }] },
    tools: [{ googleSearch: {} }, { functionDeclarations: functions }],
    realtimeInputConfig: {
      automaticActivityDetection: settings.replyMode === 'hold' ? { disabled: true } : { disabled: false, prefixPaddingMs: 300, silenceDurationMs: 700 },
      activityHandling: settings.voice ? 'START_OF_ACTIVITY_INTERRUPTS' : 'NO_INTERRUPTION',
      turnCoverage: 'TURN_INCLUDES_ALL_INPUT',
    },
    inputAudioTranscription: {}, outputAudioTranscription: {},
    proactivity: { proactiveAudio: true },
    sessionResumption: handle ? { handle } : {},
    contextWindowCompression: { slidingWindow: {} },
  };
}
