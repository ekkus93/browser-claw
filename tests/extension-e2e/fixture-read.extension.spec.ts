/**
 * J1 — Successful read_page extension E2E test.
 *
 * Requires `devtest.internal` to resolve to 127.0.0.1 (add to /etc/hosts or
 * use the Docker environment). The test-extension pre-grants host_permissions
 * for http://devtest.internal:7779/* so no request_host_permission call is needed.
 *
 * Local setup: echo "127.0.0.1 devtest.internal" >> /etc/hosts
 * Docker: configured automatically in the Dockerfile.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, chromium, type BrowserContext } from '@playwright/test';

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

test('J1: read_page of fixture page returns sanitized content', async () => {
  const ctx = await launchTestCtx();
  try {
    const extId = await getExtensionId(ctx);
    const r = await sendMsg(ctx, extId, {
      type: 'read_page',
      requestId: 'j1-read',
      url: `${FIXTURE_ORIGIN}/public-article.html`,
    });
    expect(r).toMatchObject({ ok: true });
    const result = r as {
      ok: true;
      title?: string;
      text?: string;
      markdown?: string;
    };
    // Title extracted
    expect(result.title ?? result.text ?? '').toContain(
      'Fixture Article Title',
    );
    // Article body text present
    const body = result.text ?? result.markdown ?? '';
    expect(body).toContain('fixture article body text');
    // Script sentinel must NOT leak into extracted text
    expect(body).not.toContain('SCRIPT_SENTINEL_SHOULD_NOT_LEAK');
  } finally {
    await ctx.close();
  }
});

test('J1: read_page of hostile-script page does not leak JS source', async () => {
  const ctx = await launchTestCtx();
  try {
    const extId = await getExtensionId(ctx);
    const r = await sendMsg(ctx, extId, {
      type: 'read_page',
      requestId: 'j1-hostile',
      url: `${FIXTURE_ORIGIN}/hostile-script.html`,
    });
    const result = r as { ok: boolean; text?: string; error?: unknown };
    if (result.ok) {
      // Raw JS source must not appear in extracted text
      expect(result.text ?? '').not.toContain('Object.defineProperty');
      expect(result.text ?? '').not.toContain('querySelectorAll');
    }
    // Either ok:true (cleaned) or ok:false (error) — not a crash
    expect(typeof result.ok).toBe('boolean');
  } finally {
    await ctx.close();
  }
});
