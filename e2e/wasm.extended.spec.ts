import { test, expect } from '@playwright/test';

/**
 * Verifies the real Rust runtime, compiled to WebAssembly, instantiates and
 * runs in the browser (Chromium + Firefox). The /wasm-probe page loads the
 * wasm, dispatches a command, and reports the result.
 */
test('wasm runtime instantiates and runs in the browser', async ({ page }) => {
  await page.goto('/wasm-probe', { waitUntil: 'domcontentloaded' });
  const probe = page.getByTestId('wasm-probe');
  await expect(probe).toHaveText(/wasm-ok/, { timeout: 30_000 });
  await expect(probe).toContainText('mc=1');
});
