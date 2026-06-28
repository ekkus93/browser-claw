/**
 * J2 — App-level extension E2E tests.
 *
 * These tests exercise BrowserClaw's app-level integration with the Chrome
 * Web Research Companion extension:
 *
 *   - Settings "Check" button probes the extension and shows "Connected".
 *   - read_page succeeds from the BrowserClaw app origin (externally_connectable).
 *   - Settings shows "Not detected" when the extension is missing/unreachable.
 *
 * Requires `devtest.internal` → 127.0.0.1 (add to /etc/hosts or use Docker).
 * The test-extension at tests/extension-e2e/test-extension pre-grants
 * host_permissions for http://devtest.internal:7779/* so no runtime permission
 * request is needed.
 *
 * Audit events and workspace creation are exercised at the unit-test level in
 * pageReaderProvider.test.ts and workspaceRunner tests; this E2E layer focuses
 * on transport connectivity and UI error display.
 *
 * Local setup: echo "127.0.0.1 devtest.internal" >> /etc/hosts
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, chromium, type BrowserContext } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const FIXTURE_HOST = 'devtest.internal';
const FIXTURE_PORT = 7779;
const FIXTURE_ORIGIN = `http://${FIXTURE_HOST}:${FIXTURE_PORT}`;
const FIXTURE_DIR = path.resolve(__dirname, 'fixtures');

const TEST_EXTENSION_PATH = path.resolve(__dirname, 'test-extension');
const APP_ORIGIN = 'http://localhost:5173';

let fixtureServer: http.Server | null = null;

test.beforeAll(async () => {
  fixtureServer = http.createServer((req, res) => {
    const safePath = path.resolve(
      FIXTURE_DIR,
      (req.url ?? '/').replace(/^\//, '') || 'index.html',
    );
    if (!safePath.startsWith(FIXTURE_DIR)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    try {
      const data = fs.readFileSync(safePath);
      const ext = path.extname(safePath).toLowerCase();
      const ct = ext === '.html' ? 'text/html; charset=utf-8' : 'text/plain';
      res.writeHead(200, { 'Content-Type': ct });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
  });
  await new Promise<void>((resolve) =>
    fixtureServer!.listen(FIXTURE_PORT, '0.0.0.0', resolve),
  );
});

test.afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    fixtureServer?.close((err) => (err ? reject(err) : resolve())),
  );
});

async function launchTestCtx(): Promise<BrowserContext> {
  return chromium.launchPersistentContext('', {
    args: [
      '--headless=new',
      `--disable-extensions-except=${TEST_EXTENSION_PATH}`,
      `--load-extension=${TEST_EXTENSION_PATH}`,
    ],
  });
}

async function getExtensionId(ctx: BrowserContext): Promise<string> {
  const sw = await ctx.waitForEvent('serviceworker', { timeout: 20_000 });
  return sw.url().split('/')[2]!;
}

interface ChromeRuntime {
  sendMessage(
    extensionId: string,
    message: unknown,
    callback?: (response: unknown) => void,
  ): void;
}
type GlobalWithChrome = typeof globalThis & {
  chrome: { runtime: ChromeRuntime };
};

async function sendMsg(
  ctx: BrowserContext,
  extId: string,
  msg: Record<string, unknown>,
): Promise<unknown> {
  const page = await ctx.newPage();
  await page.goto(`${APP_ORIGIN}/`, { waitUntil: 'domcontentloaded' });
  return page.evaluate(
    async ([id, m]) => {
      return new Promise<unknown>((resolve) => {
        (globalThis as GlobalWithChrome).chrome.runtime.sendMessage(
          id,
          m,
          resolve,
        );
      });
    },
    [extId, msg] as const,
  );
}

test('J2: Settings Check button shows Connected when extension is loaded', async () => {
  const ctx = await launchTestCtx();
  try {
    const extId = await getExtensionId(ctx);
    // Navigate to Settings with ?ext_id override (dev-mode URL param).
    // This wires the extension probe without requiring VITE_CHROME_EXTENSION_ID
    // to be baked in at build time.
    const page = await ctx.newPage();
    await page.goto(`${APP_ORIGIN}/settings?ext_id=${extId}`, {
      waitUntil: 'domcontentloaded',
    });
    const checkBtn = page.getByRole('button', { name: 'Check' });
    await expect(checkBtn).toBeVisible({ timeout: 10_000 });
    await checkBtn.click();
    // Wait for status badge to show Connected
    await expect(page.getByText('Connected')).toBeVisible({ timeout: 10_000 });
  } finally {
    await ctx.close();
  }
});

test('J2: read_page from app page origin returns sanitized page content', async () => {
  // Exercises chrome.runtime.sendMessage from http://localhost:5173 (the
  // externally_connectable origin) and verifies page content is returned.
  // This proves the app → extension message path works end-to-end.
  const ctx = await launchTestCtx();
  try {
    const extId = await getExtensionId(ctx);
    const r = await sendMsg(ctx, extId, {
      type: 'read_page',
      requestId: 'j2-read',
      url: `${FIXTURE_ORIGIN}/public-article.html`,
    });
    expect(r).toMatchObject({ ok: true });
    const result = r as { ok: true; text?: string; title?: string };
    const body = result.text ?? '';
    expect(body).toContain('fixture article body text');
    // Script sentinels must not appear in the extracted text
    expect(body).not.toContain('SCRIPT_SENTINEL_SHOULD_NOT_LEAK');
  } finally {
    await ctx.close();
  }
});

test('J2: Settings shows Not detected when extension is missing', async () => {
  // Load a browser context WITHOUT the extension; use a fake extension ID so
  // the Settings probe wires up but cannot reach any real extension.
  const ctx = await chromium.launchPersistentContext('', {
    args: ['--headless=new'],
  });
  try {
    // 32 hex chars — valid format but no matching extension
    const fakeId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const page = await ctx.newPage();
    await page.goto(`${APP_ORIGIN}/settings?ext_id=${fakeId}`, {
      waitUntil: 'domcontentloaded',
    });
    const checkBtn = page.getByRole('button', { name: 'Check' });
    await expect(checkBtn).toBeVisible({ timeout: 10_000 });
    await checkBtn.click();
    await expect(page.getByText('Not detected')).toBeVisible({
      timeout: 10_000,
    });
  } finally {
    await ctx.close();
  }
});
