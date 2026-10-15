import { object } from './config';
import type { Provider } from './config';
export type ToolCall = { id: string; name: string; arguments: string };
export type ToolOutput = { id: string; name: string; text: string; image?: string };
export type AudioItem = { id: string; index: number };
export type PlaybackItem = AudioItem & { playedMs: number };
export type LiveCallbacks = {
  ready: (resumed: boolean) => void;
  responseStart: (id?: string) => void;
  text: (delta: string) => void;
  responseDone: () => void;
  audio: (pcm: Uint8Array, item?: AudioItem) => void;
  userTurn: (id: string) => void;
  userWords: (id: string, text: string, final: boolean) => void;
  tools: (calls: ToolCall[]) => void;
  cancelTools: (ids: string[]) => void;
  interrupted: () => void;
  emptyCommit: () => void;
  error: (text: string, fatal: boolean) => void;
  disconnected: (code: number, reason: string) => void;
  reconnect: () => void;
};
export interface LiveProvider {
  readonly provider: Provider;
  readonly connected: boolean;
  connect(context: string): void;
  close(reset: boolean): void | Promise<void>;
  /** Returns true when a configuration/key change requires a new connection. */
  configure(): boolean;
  audio(bytes: Uint8Array): void;
  /** Gemini needs activityStart; OpenAI keeps VAD running and only commits on release. */
  beginAsk?(): void;
  endAsk(responseActive: boolean): void;
  respond(): void;
  sayHi(): void;
  toolResults(results: ToolOutput[]): Promise<void>;
  /** The phone reports actual playback start/drain, independent of model generation completion. */
  playback?(on: boolean, items?: PlaybackItem[]): void;
  /** GPT-Live uses a documented instruction append when the phone detects barge-in. */
  interrupt?(): void;
}
const decoder = new TextDecoder();
/** Both APIs may deliver JSON as UTF-8 binary WebSocket frames. */
export async function liveMessage(value: unknown) {
  let text: string;
  if (typeof value === 'string') text = value;
  else if (value instanceof ArrayBuffer) text = decoder.decode(value);
  else if (ArrayBuffer.isView(value)) text = decoder.decode(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  else if (value instanceof Blob) text = await value.text();
  else throw new Error('Unsupported live API frame.');
  return object(JSON.parse(text));
}
export function friendlyLiveError(provider: Provider, text: string) {
  if (provider === 'open') return `Open: ${text.slice(0, 240) || 'Check the speech-to-text, LLM and text-to-speech services in Brain → Advanced.'}`;
  const label = provider === 'gemini' ? 'Gemini' : provider === 'gptlive' ? 'GPT-Live' : 'OpenAI';
  if (provider === 'gemini' && /prepayment credits (?:are )?depleted/i.test(text)) return 'Your Gemini project has billing on and no credits. Use a key from a free-tier project (no billing) or add credits.';
  if (/resource_exhausted|quota|rate.?limit|too many requests|\b429\b|1013/i.test(text)) return provider === 'gemini' ? "Gemini's free limit has been reached. Try again later, or switch to OpenAI in Brain settings." : "OpenAI's usage limit has been reached. Check your API quota or try again later.";
  if (/api.?key|unauthenticated|unauthorized|permission_denied|authentication|\b40[13]\b/i.test(text)) return provider === 'gemini' ? 'Check your Gemini key at aistudio.google.com/apikey, or switch to OpenAI in settings.' : 'Check your OpenAI key and model access at platform.openai.com/api-keys.';
  return `${label}: ${text.slice(0, 240) || 'The live connection could not finish that request.'}`;
}
