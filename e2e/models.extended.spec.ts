import { test, expect } from '@playwright/test';

/**
 * Live provider health check from the UI — no API key required. Clicking Test
 * on the Ollama local endpoint makes a real network request from the browser;
 * the resulting status (reachable/unreachable/model-not-found/...) replaces
 * "Not configured". We assert that real resolution happened, not a specific
 * outcome, since it depends on what's listening locally. Chromium + Firefox.
 */
test('models: Test runs a live health check (no key needed)', async ({
  page,
}) => {
  await page.goto('/models', { waitUntil: 'domcontentloaded' });

  const ollamaStatus = page.getByRole('listitem').filter({ hasText: 'Ollama' });
  await expect(ollamaStatus).toContainText('Not configured');

  // Test buttons in order: OpenAI, Anthropic, OpenAI-compatible, Ollama,
  // llama-server. The 4th (index 3) is the Ollama local endpoint.
  await page.getByRole('button', { name: 'Test' }).nth(3).click();

  // The real network check resolves the status away from "Not configured".
  await expect(ollamaStatus).not.toContainText('Not configured', {
    timeout: 30_000,
  });
});
