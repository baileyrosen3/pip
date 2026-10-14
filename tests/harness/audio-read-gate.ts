import { existsSync, watch, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Cross-process filesystem signal, without guessing how long an audio read takes. */
export function waitForFile(path: string, signal = AbortSignal.timeout(2000)): Promise<void> {
  if (existsSync(path)) return Promise.resolve();
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const finish = (error?: Error) => {
    watcher.close(); signal.removeEventListener('abort', aborted);
    if (error) reject(error); else resolve();
  };
  const aborted = () => finish(new Error(`Timed out waiting for ${path}`));
  const watcher = watch(dirname(path), () => { if (existsSync(path)) finish(); });
  watcher.once('error', finish);
  signal.addEventListener('abort', aborted, { once: true });
  if (signal.aborted) aborted();
  else if (existsSync(path)) finish();
  return promise;
}

// Preloaded only by isolated harness servers. Real audio files are still read;
// the gate lets a phone revoke notes consent while that asynchronous read waits.
const root = process.env.PIPCTL_TEST_AUDIO_READ_GATE;
if (root) {
  const fileAt = Bun.file;
  Bun.file = (path, options) => {
    const file = fileAt(path, options);
    if (typeof path !== 'string' || !/chunk-\d+\.m4a$/.test(path)) return file;
    const arrayBuffer = file.arrayBuffer.bind(file);
    file.arrayBuffer = async () => {
      writeFileSync(join(root, 'audio-read-started'), '');
      await waitForFile(join(root, 'audio-read-release'));
      return arrayBuffer();
    };
    return file;
  };
}
