import { test, expect } from '@playwright/test';

test('keyboard: activating a nav link with Enter navigates', async ({
  page,
}) => {
  await page.goto('/chat', { waitUntil: 'domcontentloaded' });
  const modelsLink = page.getByRole('link', { name: 'Models' });
  await modelsLink.focus();
  await expect(modelsLink).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('heading', { name: 'Models', exact: true }),
  ).toBeVisible();
});

test('persistence: an edited memory survives a reload', async ({ page }) => {
  await page.goto('/memories', { waitUntil: 'domcontentloaded' });
  await expect(
    page.getByRole('button', { name: /Rust\/WASM architecture/ }),
  ).toBeVisible({ timeout: 10_000 });

  await page.getByRole('button', { name: 'Edit' }).click();
  const title = page.getByLabel('Title');
  await title.fill('Persisted edit');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(
    page.getByRole('heading', { name: 'Persisted edit' }),
  ).toBeVisible();

  await page.reload({ waitUntil: 'domcontentloaded' });
  // The edit was written to IndexedDB, so it comes back after reload.
  await expect(
    page.getByRole('button', { name: /Persisted edit/ }),
  ).toBeVisible({ timeout: 10_000 });
});
