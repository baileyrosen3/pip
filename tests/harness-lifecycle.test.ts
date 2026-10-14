import { expect, test } from 'bun:test';
import { mockBrain, withServer } from './harness';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('a failed isolated server startup still stops its mock brain', async () => {
  const brain = mockBrain('gemini');
  try {
    await expect(withServer({ brain, env: {
      BUN_OPTIONS: `--preload=${join(tmpdir(), `pip-missing-preload-${crypto.randomUUID()}.ts`)}`,
    } }, async () => { throw new Error('Failed startup must not run the scenario.'); })).rejects.toThrow();
    await expect(fetch(`${brain.baseURL}/after-cleanup`)).rejects.toThrow();
  } finally { await brain.stop(); }
});
