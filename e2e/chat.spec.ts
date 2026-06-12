import { test, expect } from '@playwright/test';

test('chat converses end to end via the mock provider', async ({ page }) => {
  await page.goto('/chat', { waitUntil: 'domcontentloaded' });

  const composer = page.getByRole('textbox', { name: 'Message' });
  await composer.fill('hello there');
  await page.getByRole('button', { name: /send/i }).click();

  // the user message appears, then the runtime + mock provider answer
  await expect(page.getByText('hello there', { exact: true })).toBeVisible();
  await expect(page.getByText(/Mock response to: hello there/i)).toBeVisible({
    timeout: 10_000,
  });
});
