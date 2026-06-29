import { test, expect, chromium, type BrowserContext } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertExtensionFixture,
  getExtensionId,
  getServiceWorker,
} from './helpers.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.resolve(
  __dirname,
  '../../extension/chrome-web-research',
);
const APP_ORIGIN = 'http://localhost:5173';

// E1 (FIX4) / D1+D2 (FIX5): preflight assertion — uses shared helper which also
// checks for symlinked service workers (fragile in Docker/headless).
assertExtensionFixture(EXTENSION_PATH);

async function launchCtx(): Promise<BrowserContext> {
  return chromium.launchPersistentContext('', {
    args: [
      '--headless=new',
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
    ],
  });
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (globalThis as any).chrome.runtime.sendMessage(id, m, resolve);
      });
    },
    [extId, msg] as const,
  );
}

// K1 — Extension loading
test('K1: extension loads, service worker is chrome-extension://', async () => {
  const ctx = await launchCtx();
  try {
    // D1 (FIX5): use shared helper that checks existing service workers first.
    const sw = await getServiceWorker(ctx);
    expect(sw.url()).toMatch(/^chrome-extension:\/\//);
  } finally {
    await ctx.close();
  }
});

test('K1: service worker has 32-char alphanumeric extension ID', async () => {
  const ctx = await launchCtx();
  try {
    const id = await getExtensionId(ctx);
    expect(id).toMatch(/^[a-p]{32}$/);
  } finally {
    await ctx.close();
  }
});

// K1 — Allowed origin connects
test('K1: allowed origin can ping the extension', async () => {
  const ctx = await launchCtx();
  try {
    const extId = await getExtensionId(ctx);
    const r = await sendMsg(ctx, extId, { type: 'ping', requestId: 'k1-ping' });
    expect(r).toMatchObject({ ok: true, type: 'pong' });
  } finally {
    await ctx.close();
  }
});

// E2 (FIX4): updated to current nested capability schema (C1 of the extension).
test('K1: get_status reports truthful capability flags', async () => {
  const ctx = await launchCtx();
  try {
    const extId = await getExtensionId(ctx);
    const r = await sendMsg(ctx, extId, {
      type: 'get_status',
      requestId: 'k1-status',
    });
    expect(r).toMatchObject({
      ok: true,
      capabilities: {
        readPage: {
          supported: true,
          requiresHostPermission: true,
          // F1 (FIX4): always false — chrome.permissions.request() requires
          // extension popup; message-based flow throws permission_flow_required.
          permissionRequestSupported: false,
        },
        readCurrentTab: {
          supported: false,
        },
        webSearch: {
          supported: true,
        },
      },
      pageReadingAvailable: true,
      webSearchAvailable: true,
    });
  } finally {
    await ctx.close();
  }
});

// K1 — Blocked URL fails
test('K1: read_page of 127.0.0.1 returns url_blocked', async () => {
  const ctx = await launchCtx();
  try {
    const extId = await getExtensionId(ctx);
    const r = await sendMsg(ctx, extId, {
      type: 'read_page',
      requestId: 'k1-blocked',
      url: 'http://127.0.0.1:5173/',
    });
    expect(r).toMatchObject({ ok: false, error: { kind: 'url_blocked' } });
  } finally {
    await ctx.close();
  }
});

test('K1: read_page of localhost returns url_blocked', async () => {
  const ctx = await launchCtx();
  try {
    const extId = await getExtensionId(ctx);
    const r = await sendMsg(ctx, extId, {
      type: 'read_page',
      requestId: 'k1-localhost',
      url: 'http://localhost:5173/',
    });
    expect(r).toMatchObject({ ok: false, error: { kind: 'url_blocked' } });
  } finally {
    await ctx.close();
  }
});

// K1 — Unknown message type
test('K1: unknown message type returns unsupported_message_type', async () => {
  const ctx = await launchCtx();
  try {
    const extId = await getExtensionId(ctx);
    const r = await sendMsg(ctx, extId, {
      type: 'not_real',
      requestId: 'k1-unk',
    });
    expect(r).toMatchObject({
      ok: false,
      error: { kind: 'unsupported_message_type' },
    });
  } finally {
    await ctx.close();
  }
});

// J1 fixture-page read tests are in fixture-read.extension.spec.ts.
// They use test-extension/ (pre-granted host_permissions for devtest.internal)
// and require devtest.internal → 127.0.0.1 in /etc/hosts (or Docker --add-host).
