import { test, expect } from '@playwright/test';

/**
 * Visual smoke: load each screen in a real browser and capture a full-page
 * screenshot into e2e/screenshots/ for review.
 */
const ROUTES = [
  { path: '/onboarding', name: 'onboarding' },
  { path: '/chat', name: 'chat' },
  { path: '/models', name: 'models' },
  { path: '/storage', name: 'storage' },
  { path: '/skills', name: 'skills' },
  { path: '/memories', name: 'memories' },
  { path: '/audit', name: 'audit' },
  { path: '/security', name: 'security' },
  { path: '/settings', name: 'settings' },
  { path: '/workflow', name: 'workflow' },
  { path: '/showcase', name: 'showcase' },
];

for (const route of ROUTES) {
  test(`renders ${route.name}`, async ({ page }, testInfo) => {
    await page.goto(route.path, { waitUntil: 'domcontentloaded' });
    // Wait for the React app to mount something into #root.
    await expect(page.locator('#root *').first()).toBeVisible({
      timeout: 15_000,
    });
    // Let fonts/layout settle before capturing.
    await page.waitForTimeout(400);
    await page.screenshot({
      path: `e2e/screenshots/${testInfo.project.name}/${route.name}.png`,
      fullPage: true,
    });
  });
}
