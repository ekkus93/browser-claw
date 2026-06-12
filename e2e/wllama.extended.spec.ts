import { test, expect } from '@playwright/test';

/**
 * Real browser-local inference: downloads a small GGUF from Hugging Face via
 * wllama, loads it as WASM, and runs a completion — verified in Chromium and
 * Firefox. Heavy and network-dependent, so it's in the extended suite only.
 */
test('wllama downloads a GGUF and runs inference in the browser', async ({
  page,
}) => {
  await page.goto('/wllama-probe', { waitUntil: 'domcontentloaded' });
  const probe = page.getByTestId('wllama-probe');
  // Allow time for the download + single-threaded inference.
  await expect(probe).toHaveText(/^done:/, { timeout: 540_000 });
});
