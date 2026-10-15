import { expect, test } from 'bun:test';
import { startServer } from './harness/server';
import { BrowserPage, findBrowser } from './harness/browser';
import type { Provider } from '../server/config';

// Loads the real phone web app in a headless browser against a real Pip server, for every brain, and fails on
// any page error. Catches startup crashes that leave the phone stuck on "Connecting to your computer…".
// Skipped when no Chromium is installed, unless PIPCTL_REQUIRE_BROWSER=1 (CI sets it).
const browser = findBrowser();
const required = process.env.PIPCTL_REQUIRE_BROWSER === '1';
if (required && !browser) throw new Error('PIPCTL_REQUIRE_BROWSER=1 but no chromium/google-chrome is on PATH.');
const token = '1'.repeat(64); // the harness pairing token

for (const provider of ['open', 'gemini', 'openai', 'gptlive'] satisfies Provider[]) {
  test.skipIf(!browser)(`phone app connects and opens settings without errors (${provider} brain)`, async () => {
    const pip = await startServer({ brain: { kind: provider, baseURL: 'http://127.0.0.1:9' }, keys: { openai: '', gemini: '' } });
    const page = await BrowserPage.open(browser!);
    try {
      await page.goto(`${pip.url}/#token=${token}`);
      await page.waitFor(`document.readyState === 'complete' && document.getElementById('connection')?.hidden === true`);
      await page.evaluate(`document.getElementById('face-screen').focus(); document.getElementById('face-screen').dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true }))`);
      await page.waitFor(`document.getElementById('settings-screen')?.hidden === false`);
      // Page exceptions arrive on the same DevTools socket ahead of the waitFor replies above.
      expect(page.errors).toEqual([]);
    } finally { await page.close(); await pip.stop(); }
  }, 30_000);
}
