/**
 * B1 — read_pages batch handler unit tests.
 *
 * Imports the plain-JS service worker and stubs Chrome APIs
 * so the handler runs without a real browser.
 */
import { describe, expect, it } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;

// Stub Chrome APIs before importing the module.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).chrome = {
  permissions: {
    contains: async () => true,
    request: async () => true,
  },
  tabs: {
    create: async ({ url }: { url: string }) => ({ id: 42, url }),
    onUpdated: {
      addListener: (cb: AnyFn) => {
        // immediately signal 'complete' so waitForTabComplete resolves
        setTimeout(() => cb(42, { status: 'complete' }), 0);
      },
      removeListener: () => undefined,
    },
    remove: async () => undefined,
  },
  scripting: {
    executeScript: async ({ args }: { args: [{ maxChars: number }] }) => [
      {
        result: {
          ok: true,
          finalUrl: 'https://example.com/',
          title: 'Example',
          text: 'x'.repeat(Math.min(args[0].maxChars, 10)),
          markdown: 'body',
          excerpt: 'body',
          length: 10,
        },
      },
    ],
  },
  runtime: { onMessageExternal: null },
};

// The service-worker is plain JS — suppress the implicit-any TS error.
// @ts-expect-error — no declaration file for plain-JS service worker
import { handleReadPages } from '../../extension/chrome-web-research/service-worker.js';

const BLOCKED = 'http://localhost/page';
const URL1 = 'https://example.com/page1';
const URL2 = 'https://example.com/page2';
const URL3 = 'https://example.com/page3';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function rp(msg: Record<string, any>) {
  return handleReadPages(msg) as Promise<Record<string, unknown>>;
}

describe('B1 — handleReadPages (batch)', () => {
  it('B1: single URL batch returns ok:true with one result', async () => {
    const res = await rp({ requestId: 'r1', urls: [URL1] });
    expect(res['ok']).toBe(true);
    const results = res['results'] as unknown[];
    expect(Array.isArray(results)).toBe(true);
    expect(results).toHaveLength(1);
  });

  it('B1: blocked URL yields ok:false in its slot without aborting batch', async () => {
    const res = await rp({ requestId: 'r2', urls: [BLOCKED, URL1] });
    expect(res['ok']).toBe(true);
    const results = res['results'] as Record<string, unknown>[];
    expect(results[0]!['ok']).toBe(false);
    expect((results[0]!['error'] as Record<string, unknown>)['kind']).toBe(
      'url_blocked',
    );
    expect(results[1]!['ok']).toBe(true);
    expect(results).toHaveLength(2);
  });

  it('B1: respects maxPages — only fetches first N URLs', async () => {
    const res = await rp({
      requestId: 'r3',
      urls: [URL1, URL2, URL3],
      maxPages: 2,
    });
    expect(res['ok']).toBe(true);
    expect((res['results'] as unknown[]).length).toBe(2);
  });

  it('B1: empty urls array returns invalid_request error', async () => {
    const res = await rp({ requestId: 'r4', urls: [] });
    expect(res['ok']).toBe(false);
    expect((res['error'] as Record<string, unknown>)['kind']).toBe(
      'invalid_request',
    );
  });

  it('B1: non-array urls returns invalid_request error', async () => {
    const res = await rp({ requestId: 'r5', urls: 'not-an-array' });
    expect(res['ok']).toBe(false);
    expect((res['error'] as Record<string, unknown>)['kind']).toBe(
      'invalid_request',
    );
  });

  it('B1: maxPages capped at 10 even if message requests more', async () => {
    const manyUrls = Array.from(
      { length: 15 },
      (_, i) => `https://example.com/p${String(i)}`,
    );
    const res = await rp({ requestId: 'r6', urls: manyUrls, maxPages: 15 });
    expect(res['ok']).toBe(true);
    expect((res['results'] as unknown[]).length).toBe(10);
  });

  it('B1: non-string URL slot returns invalid_request for that slot', async () => {
    const res = await rp({ requestId: 'r7', urls: [URL1, 42] });
    expect(res['ok']).toBe(true);
    const results = res['results'] as Record<string, unknown>[];
    expect(results[0]!['ok']).toBe(true);
    expect(results[1]!['ok']).toBe(false);
    expect((results[1]!['error'] as Record<string, unknown>)['kind']).toBe(
      'invalid_request',
    );
  });

  it('B1: requestId echoed in top-level response', async () => {
    const res = await rp({ requestId: 'echo-me', urls: [URL1] });
    expect(res['requestId']).toBe('echo-me');
  });
});
