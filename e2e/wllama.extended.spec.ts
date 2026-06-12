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

/**
 * The IndexedDB blob cache (the no-OPFS fallback for browser-local models) must
 * download a model once and then serve it from IndexedDB across reloads without
 * re-downloading. Verified by counting Hugging Face requests — deterministic in
 * both browsers since it doesn't depend on wllama/OPFS.
 */
test('model blob cache downloads once and serves from IndexedDB after a reload', async ({
  page,
}) => {
  let downloads = 0;
  page.on('request', (req) => {
    const url = req.url();
    if (url.includes('huggingface.co') && url.includes('/resolve/')) {
      downloads += 1;
    }
  });

  const probe = page.getByTestId('cache-probe');

  // First load: downloads the model and writes it to the cache (count >= 1).
  await page.goto('/model-cache-probe', { waitUntil: 'domcontentloaded' });
  await expect(probe).toHaveText(/^done:.*count=[1-9]/, { timeout: 300_000 });
  expect(downloads).toBeGreaterThan(0);
  const afterFirst = downloads;

  // Reload (fresh JS, persisted IndexedDB): served from cache, no new download.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(probe).toHaveText(/^done:.*count=[1-9]/, { timeout: 60_000 });
  expect(downloads).toBe(afterFirst);
});
