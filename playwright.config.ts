import { defineConfig, devices } from '@playwright/test';

const PORT = 4321;
const BASE_URL = `http://localhost:${PORT}`;

/**
 * Playwright drives a real browser against the Vite dev server for visual
 * verification of the screens. E2E specs live in e2e/ (Vitest is scoped to
 * src/, so the two runners don't collide).
 */
export default defineConfig({
  testDir: './e2e',
  // Extended tests (real model download, live network) are opt-in via the
  // extended config; keep them out of the normal fast run.
  testIgnore: '**/*.extended.spec.ts',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: BASE_URL,
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  ],
  webServer: {
    command: `pnpm dev --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 60_000,
    // Run e2e in demo mode: this auto-selects the mock provider (so the chat
    // spec has a provider) and seeds the sample memories the memory specs
    // expect — both behind the safety banner. Demo mode implies the mock
    // provider override.
    env: { VITE_DEMO_MODE: 'true' },
  },
});
