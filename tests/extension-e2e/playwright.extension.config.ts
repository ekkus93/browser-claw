import { defineConfig } from '@playwright/test';
import path from 'node:path';

const PORT = 5173;
const BASE_URL = `http://localhost:${PORT}`;

export const EXTENSION_PATH = path.resolve(
  import.meta.dirname,
  '../../extension/chrome-web-research',
);

/**
 * Playwright config for extension E2E tests (K1). These tests require:
 *   1. Chromium with the extension loaded via --load-extension
 *   2. The Vite dev server on localhost:5173 (externally_connectable origin)
 *   3. Fixture pages served from the same origin
 *
 * The dev server and fixture serving are handled by the webServer config below.
 * Only Chromium is supported (Firefox/WebKit don't support Chrome extensions).
 *
 * Run with: pnpm run test:extension:e2e
 */
export default defineConfig({
  testDir: '.',
  testMatch: '**/*.extension.spec.ts',
  fullyParallel: false,
  timeout: 60_000,
  reporter: 'list',
  projects: [
    {
      name: 'chromium-extension',
      use: {
        // Extension tests use a launchPersistentContext in the spec itself;
        // browser is set here so Playwright installs Chromium if needed.
        browserName: 'chromium',
      },
    },
  ],
  webServer: {
    command: `pnpm dev --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 60_000,
    env: { VITE_DEMO_MODE: 'true' },
  },
});
