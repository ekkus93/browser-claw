import { defineConfig, devices } from '@playwright/test';

const PORT = 4321;
const BASE_URL = `http://localhost:${PORT}`;

/**
 * Extended (long-running) e2e suite — only run when explicitly invoked
 * (`pnpm test:e2e:extended`). These exercise the real WASM runtime, a real
 * wllama GGUF download + inference, and live provider health checks, in both
 * Chromium and Firefox. They are heavy and network-dependent, so they are not
 * part of the normal gate.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.extended.spec.ts',
  // A real GGUF download can take minutes.
  timeout: 600_000,
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
  },
});
