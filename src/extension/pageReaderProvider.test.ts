import { describe, expect, it, vi } from 'vitest';
import { createExtensionPageReader } from './pageReaderProvider.ts';
import type { ExtensionTransport } from './pageReaderProvider.ts';

function transport(
  responder: (msg: { type: string }) => unknown,
): ExtensionTransport {
  return { send: vi.fn((msg) => Promise.resolve(responder(msg))) };
}

describe('createExtensionPageReader (E9)', () => {
  it('reports availability from get_status with pageReadingAvailable:true', async () => {
    const audits: string[] = [];
    const reader = createExtensionPageReader({
      transport: transport((m) =>
        m.type === 'get_status'
          ? {
              ok: true,
              requestId: 'r',
              protocolVersion: 1,
              extensionVersion: '0.1.0',
              capabilities: { ping: true, getStatus: true, readPage: true },
              pageReadingAvailable: true,
              currentTabReadingAvailable: true,
            }
          : {},
      ),
      onAudit: (e) => audits.push(e),
    });
    expect(await reader.isAvailable()).toBe(true);
    expect(audits).toContain('extension.connected');
  });

  it('reports unavailable when the transport throws', async () => {
    const reader = createExtensionPageReader({
      transport: { send: () => Promise.reject(new Error('no extension')) },
    });
    expect(await reader.isAvailable()).toBe(false);
  });

  // FIX1-A1: isAvailable() now calls get_status and checks pageReadingAvailable.
  it('A1: reports unavailable when get_status returns pageReadingAvailable: false', async () => {
    const audits: string[] = [];
    const reader = createExtensionPageReader({
      transport: transport((m) =>
        m.type === 'get_status'
          ? {
              ok: true,
              requestId: 'r',
              protocolVersion: 1,
              extensionVersion: '0.1.0',
              capabilities: { ping: true, getStatus: true, readPage: false },
              pageReadingAvailable: false,
              currentTabReadingAvailable: false,
            }
          : {},
      ),
      onAudit: (e) => audits.push(e),
    });
    expect(await reader.isAvailable()).toBe(false);
    expect(audits).toContain('extension.missing');
  });

  it('A1: reports available only when get_status returns pageReadingAvailable: true', async () => {
    const audits: string[] = [];
    const reader = createExtensionPageReader({
      transport: transport((m) =>
        m.type === 'get_status'
          ? {
              ok: true,
              requestId: 'r',
              protocolVersion: 1,
              extensionVersion: '0.2.0',
              capabilities: { ping: true, getStatus: true, readPage: true },
              pageReadingAvailable: true,
              currentTabReadingAvailable: true,
            }
          : {},
      ),
      onAudit: (e) => audits.push(e),
    });
    expect(await reader.isAvailable()).toBe(true);
    expect(audits).toContain('extension.connected');
  });

  it('A1: unsupported request returns ok:false error result', async () => {
    const reader = createExtensionPageReader({
      transport: transport(() => ({
        ok: false,
        requestId: 'r',
        error: {
          kind: 'unsupported',
          message: 'unknown message type: read_page',
        },
      })),
    });
    const result = await reader.readPage({ url: 'https://example.com/' });
    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'internal_error' },
    });
  });

  // FIX1-A3: BrowserClaw-side error kind mappings for read_page responses.
  // Tab lifecycle tests (reads fixture page, closes tab, timeout) require real
  // Chrome and are deferred to Docker E2E lane FIX1-K1.
  it('A3: blocked URL (url_blocked) maps to unsupported_url PageReadError', async () => {
    const reader = createExtensionPageReader({
      transport: transport(() => ({
        ok: false,
        requestId: 'r',
        error: {
          kind: 'url_blocked',
          message: 'Blocked host: localhost',
          retryable: false,
        },
      })),
    });
    const result = await reader.readPage({ url: 'http://localhost/' });
    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'unsupported_url' },
    });
  });

  it('A3: extraction_failed maps to extraction_failed PageReadError', async () => {
    const reader = createExtensionPageReader({
      transport: transport(() => ({
        ok: false,
        requestId: 'r',
        error: {
          kind: 'extraction_failed',
          message: 'Could not extract content',
          retryable: false,
        },
      })),
    });
    const result = await reader.readPage({ url: 'https://example.com/' });
    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'extraction_failed' },
    });
  });

  it('A3: host_permission_missing maps to permission_denied PageReadError', async () => {
    const reader = createExtensionPageReader({
      transport: transport(() => ({
        ok: false,
        requestId: 'r',
        error: {
          kind: 'host_permission_missing',
          message: 'Host permission not granted',
          retryable: false,
        },
      })),
    });
    const result = await reader.readPage({ url: 'https://example.com/' });
    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'permission_denied' },
    });
  });

  it('A3: page_load_timeout maps to timeout PageReadError', async () => {
    const reader = createExtensionPageReader({
      transport: transport(() => ({
        ok: false,
        requestId: 'r',
        error: {
          kind: 'page_load_timeout',
          message: 'timed out',
          retryable: true,
        },
      })),
    });
    const result = await reader.readPage({ url: 'https://example.com/' });
    expect(result).toMatchObject({ ok: false, error: { kind: 'timeout' } });
  });

  // FIX1-A4: BrowserClaw-side tests for read_current_tab.
  // Active tab live tests require real Chrome — deferred to FIX1-K1.
  it('A4: read_current_tab success is mapped to a PageReadResult', async () => {
    const reader = createExtensionPageReader({
      transport: transport(() => ({
        ok: true,
        requestId: 'r',
        finalUrl: 'https://example.com/current',
        title: 'Current Page',
        text: 'page content',
        markdown: 'page content',
        excerpt: 'page content',
        length: 12,
      })),
    });
    const result = await reader.readCurrentTab({});
    expect(result).toMatchObject({
      ok: true,
      text: 'page content',
      title: 'Current Page',
    });
  });

  it('A4: no active tab (internal_error) maps to internal_error PageReadError', async () => {
    const reader = createExtensionPageReader({
      transport: transport(() => ({
        ok: false,
        requestId: 'r',
        error: {
          kind: 'internal_error',
          message: 'No active tab found',
          retryable: false,
        },
      })),
    });
    const result = await reader.readCurrentTab({});
    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'internal_error' },
    });
  });

  it('A4: blocked current tab URL returns unsupported_url', async () => {
    const reader = createExtensionPageReader({
      transport: transport(() => ({
        ok: false,
        requestId: 'r',
        error: {
          kind: 'url_blocked',
          message: 'Blocked host: 192.168.1.1',
          retryable: false,
        },
      })),
    });
    const result = await reader.readCurrentTab({});
    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'unsupported_url' },
    });
  });

  it('maps a successful read into a PageReadResult', async () => {
    const reader = createExtensionPageReader({
      transport: transport(() => ({
        ok: true,
        requestId: 'r',
        finalUrl: 'https://x/a',
        title: 'A',
        text: 'hello',
        markdown: '# A',
        length: 5,
      })),
    });
    const result = await reader.readPage({ url: 'https://x/a' });
    expect(result).toMatchObject({
      ok: true,
      url: 'https://x/a',
      finalUrl: 'https://x/a',
      title: 'A',
      text: 'hello',
      markdown: '# A',
    });
  });

  it('maps an extension error response to a PageReadResult error', async () => {
    const reader = createExtensionPageReader({
      transport: transport(() => ({
        ok: false,
        requestId: 'r',
        error: { kind: 'permission_denied', message: 'denied' },
      })),
    });
    const result = await reader.readPage({ url: 'https://x/a' });
    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'permission_denied' },
    });
  });

  it('treats a malformed response as an internal error', async () => {
    const reader = createExtensionPageReader({
      transport: transport(() => ({ garbage: true })),
    });
    const result = await reader.readPage({ url: 'https://x/a' });
    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'internal_error' },
    });
  });

  // F1 (FIX3): readPages sends ONE read_pages message, not sequential readPage calls.
  it('F1: readPages sends a single read_pages message to the extension', async () => {
    const send = vi.fn((msg: Record<string, unknown>) => {
      if (msg['type'] === 'read_pages') {
        return Promise.resolve({
          ok: true,
          requestId: 'r',
          results: [
            {
              ok: true,
              url: 'https://x/1',
              finalUrl: 'https://x/1',
              text: 'a',
              length: 1,
            },
            {
              ok: true,
              url: 'https://x/2',
              finalUrl: 'https://x/2',
              text: 'b',
              length: 1,
            },
          ],
        });
      }
      return Promise.resolve({
        ok: false,
        requestId: 'r',
        error: { kind: 'invalid_request', message: 'unexpected' },
      });
    });
    const reader = createExtensionPageReader({
      transport: { send: send as ExtensionTransport['send'] },
    });
    const results = await reader.readPages({
      urls: ['https://x/1', 'https://x/2'],
    });
    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'read_pages' }),
    );
    expect(results).toHaveLength(2);
    expect(results[0]?.ok).toBe(true);
    expect(results[1]?.ok).toBe(true);
  });

  it('F1: readPages passes maxPages through in the extension message', async () => {
    const send = vi.fn((msg: Record<string, unknown>) =>
      Promise.resolve({
        ok: true,
        requestId: 'r',
        results: (msg['urls'] as string[])
          .slice(0, (msg['maxPages'] as number) ?? 10)
          .map((url) => ({
            ok: true,
            url,
            finalUrl: url,
            text: 'x',
            length: 1,
          })),
      }),
    );
    const reader = createExtensionPageReader({
      transport: { send: send as ExtensionTransport['send'] },
    });
    await reader.readPages({
      urls: ['https://x/1', 'https://x/2', 'https://x/3'],
      maxPages: 2,
    });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ maxPages: 2 }));
  });

  it('F1: readPages preserves per-slot failures from the extension response', async () => {
    const reader = createExtensionPageReader({
      transport: transport(() => ({
        ok: true,
        requestId: 'r',
        results: [
          {
            ok: true,
            url: 'https://x/1',
            finalUrl: 'https://x/1',
            text: 'ok',
            length: 2,
          },
          {
            ok: false,
            url: 'https://x/2',
            error: {
              kind: 'url_blocked',
              message: 'blocked',
              retryable: false,
            },
          },
        ],
      })),
    });
    const results = await reader.readPages({
      urls: ['https://x/1', 'https://x/2'],
    });
    expect(results[0]?.ok).toBe(true);
    expect(results[1]?.ok).toBe(false);
    const slot1 = results[1];
    if (slot1 && !slot1.ok) {
      expect(slot1.error.kind).toBe('unsupported_url');
    }
  });

  it('D2+E1: maxPages sent in message — only expected URLs in result; skipped URL absent', async () => {
    // Extension honours maxPages=2 and returns only 2 of 3 slots.
    // E1 (FIX5): URLs beyond maxPages are intentionally skipped and must NOT appear
    // as failure entries — only the 2 expectedUrls are in the result set.
    const reader = createExtensionPageReader({
      transport: transport((msg) => {
        const m = msg as Record<string, unknown>;
        const urls = m['urls'] as string[];
        const maxPages = (m['maxPages'] as number | undefined) ?? urls.length;
        return {
          ok: true,
          requestId: 'r',
          results: urls.slice(0, maxPages).map((url) => ({
            ok: true,
            url,
            finalUrl: url,
            text: 't',
            length: 1,
          })),
        };
      }),
    });
    const results = await reader.readPages({
      urls: ['https://x/1', 'https://x/2', 'https://x/3'],
      maxPages: 2,
    });
    // Only the 2 expected URLs are in the result; x/3 is silently skipped.
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.ok)).toBe(true);
    const urls = results.map((r) => r.url);
    expect(urls).toContain('https://x/1');
    expect(urls).toContain('https://x/2');
    expect(urls).not.toContain('https://x/3');
  });

  // D1 (FIX4): reject ok:true responses with no readable content.

  it('D1: ok:true readPage with no text and no markdown returns extraction_failed', async () => {
    const reader = createExtensionPageReader({
      transport: transport(() => ({
        ok: true,
        requestId: 'r',
        finalUrl: 'https://x/a',
        text: '',
        length: 0,
      })),
    });
    const result = await reader.readPage({ url: 'https://x/a' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('extraction_failed');
    }
  });

  it('D1: ok:true readPage with whitespace-only text returns extraction_failed', async () => {
    const reader = createExtensionPageReader({
      transport: transport(() => ({
        ok: true,
        requestId: 'r',
        finalUrl: 'https://x/a',
        text: '   ',
        length: 3,
      })),
    });
    const result = await reader.readPage({ url: 'https://x/a' });
    expect(result.ok).toBe(false);
  });

  it('D1: ok:true readPage with markdown (no text) is accepted', async () => {
    const reader = createExtensionPageReader({
      transport: transport(() => ({
        ok: true,
        requestId: 'r',
        finalUrl: 'https://x/a',
        markdown: '# Hello',
        length: 7,
      })),
    });
    const result = await reader.readPage({ url: 'https://x/a' });
    expect(result.ok).toBe(true);
  });

  it('D1: ok:true batch slot with empty text returns extraction_failed', async () => {
    const reader = createExtensionPageReader({
      transport: transport(() => ({
        ok: true,
        requestId: 'r',
        results: [
          {
            ok: true,
            url: 'https://x/a',
            finalUrl: 'https://x/a',
            text: '',
            length: 0,
          },
        ],
      })),
    });
    const results = await reader.readPages({ urls: ['https://x/a'] });
    expect(results[0]?.ok).toBe(false);
    if (results[0] && !results[0].ok) {
      expect(results[0].error.kind).toBe('extraction_failed');
    }
  });

  // D2 (FIX4): batch response must account for every requested URL.

  it('D2: fewer result slots than requested URLs creates missing-slot failure', async () => {
    const reader = createExtensionPageReader({
      transport: transport(() => ({
        ok: true,
        requestId: 'r',
        results: [
          {
            ok: true,
            url: 'https://x/a',
            finalUrl: 'https://x/a',
            text: 'hello',
            length: 5,
          },
        ],
      })),
    });
    const results = await reader.readPages({
      urls: ['https://x/a', 'https://x/b'],
    });
    expect(results).toHaveLength(2);
    expect(results[0]?.ok).toBe(true);
    expect(results[1]?.ok).toBe(false);
    if (results[1] && !results[1].ok) {
      expect(results[1].url).toBe('https://x/b');
      expect(results[1].error.kind).toBe('internal_error');
    }
  });

  it('D2: all requested URLs are represented even when results are out-of-order', async () => {
    const reader = createExtensionPageReader({
      transport: transport((m) => {
        if ((m as Record<string, unknown>)['type'] === 'read_pages') {
          return {
            ok: true,
            requestId: 'r',
            results: [
              {
                ok: true,
                url: 'https://x/b',
                finalUrl: 'https://x/b',
                text: 'b',
                length: 1,
              },
              {
                ok: true,
                url: 'https://x/a',
                finalUrl: 'https://x/a',
                text: 'a',
                length: 1,
              },
            ],
          };
        }
        return {};
      }),
    });
    const results = await reader.readPages({
      urls: ['https://x/a', 'https://x/b'],
    });
    expect(results).toHaveLength(2);
    const byUrl = new Map(results.map((r) => [r.url, r]));
    expect(byUrl.get('https://x/a')?.ok).toBe(true);
    expect(byUrl.get('https://x/b')?.ok).toBe(true);
  });

  it('D2: extension returns empty results array — all URLs become failures', async () => {
    const reader = createExtensionPageReader({
      transport: transport(() => ({
        ok: true,
        requestId: 'r',
        results: [],
      })),
    });
    const results = await reader.readPages({
      urls: ['https://x/a', 'https://x/b'],
    });
    expect(results).toHaveLength(2);
    expect(results.every((r) => !r.ok)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// E1 (FIX5) — maxPages must not generate failures for intentionally skipped URLs
// ---------------------------------------------------------------------------

describe('E1 (FIX5) — readPages maxPages semantics', () => {
  function readPagesTransport(
    resultUrls: string[],
  ): ReturnType<typeof transport> {
    return transport(() => ({
      ok: true,
      requestId: 'r',
      results: resultUrls.map((url) => ({
        url,
        ok: true,
        finalUrl: url,
        text: `body of ${url}`,
        length: 10,
      })),
    }));
  }

  it('E1: 4 URLs + maxPages 2 + 2 results → no missing failures for URLs 3 and 4', async () => {
    const reader = createExtensionPageReader({
      transport: readPagesTransport(['https://x/a', 'https://x/b']),
    });
    const results = await reader.readPages({
      urls: ['https://x/a', 'https://x/b', 'https://x/c', 'https://x/d'],
      maxPages: 2,
    });
    expect(results).toHaveLength(2);
    const urls = results.map((r) => r.url);
    expect(urls).not.toContain('https://x/c');
    expect(urls).not.toContain('https://x/d');
    expect(results.every((r) => r.ok)).toBe(true);
  });

  it('E1: 4 URLs + maxPages 2 + 1 result → one missing failure for URL 2', async () => {
    const reader = createExtensionPageReader({
      transport: readPagesTransport(['https://x/a']),
    });
    const results = await reader.readPages({
      urls: ['https://x/a', 'https://x/b', 'https://x/c', 'https://x/d'],
      maxPages: 2,
    });
    expect(results).toHaveLength(2);
    const byUrl = new Map(results.map((r) => [r.url, r]));
    expect(byUrl.get('https://x/a')?.ok).toBe(true);
    expect(byUrl.get('https://x/b')?.ok).toBe(false);
    expect(byUrl.has('https://x/c')).toBe(false);
    expect(byUrl.has('https://x/d')).toBe(false);
  });

  it('E1: no maxPages + missing result → missing failure', async () => {
    const reader = createExtensionPageReader({
      transport: readPagesTransport(['https://x/a']),
    });
    const results = await reader.readPages({
      urls: ['https://x/a', 'https://x/b'],
    });
    expect(results).toHaveLength(2);
    const byUrl = new Map(results.map((r) => [r.url, r]));
    expect(byUrl.get('https://x/a')?.ok).toBe(true);
    expect(byUrl.get('https://x/b')?.ok).toBe(false);
  });

  // E1 (FIX6): top-level errors must also use expectedUrls, not request.urls.

  it('E1 FIX6: 4 URLs + maxPages 2 + transport throw → 2 failures, not 4', async () => {
    const reader = createExtensionPageReader({
      transport: transport(() => {
        throw new Error('extension unreachable');
      }),
    });
    const results = await reader.readPages({
      urls: ['https://x/a', 'https://x/b', 'https://x/c', 'https://x/d'],
      maxPages: 2,
    });
    expect(results).toHaveLength(2);
    const urls = results.map((r) => r.url);
    expect(urls).not.toContain('https://x/c');
    expect(urls).not.toContain('https://x/d');
    expect(results.every((r) => !r.ok)).toBe(true);
  });

  it('E1 FIX6: 4 URLs + maxPages 2 + invalid top-level response → 2 failures, not 4', async () => {
    const reader = createExtensionPageReader({
      transport: transport(() => ({
        ok: false,
        error: { message: 'batch failed' },
      })),
    });
    const results = await reader.readPages({
      urls: ['https://x/a', 'https://x/b', 'https://x/c', 'https://x/d'],
      maxPages: 2,
    });
    expect(results).toHaveLength(2);
    const urls = results.map((r) => r.url);
    expect(urls).not.toContain('https://x/c');
    expect(urls).not.toContain('https://x/d');
  });

  it('E1 FIX6: no maxPages + transport throw → failures for all requested URLs', async () => {
    const reader = createExtensionPageReader({
      transport: transport(() => {
        throw new Error('gone');
      }),
    });
    const results = await reader.readPages({
      urls: ['https://x/a', 'https://x/b'],
    });
    expect(results).toHaveLength(2);
  });
});

// B3 (FIX7) — maxPages validation in pageReaderProvider.

describe('B3 (FIX7) — maxPages validation in readPages', () => {
  it('B3: maxPages 0 returns failure for every URL', async () => {
    const reader = createExtensionPageReader({
      transport: transport(() => ({ ok: true, requestId: 'r', results: [] })),
    });
    const results = await reader.readPages({
      urls: ['https://x/a', 'https://x/b'],
      maxPages: 0,
    });
    expect(results.every((r) => !r.ok)).toBe(true);
  });

  it('B3: maxPages -1 returns failure', async () => {
    const reader = createExtensionPageReader({
      transport: transport(() => ({ ok: true, requestId: 'r', results: [] })),
    });
    const results = await reader.readPages({
      urls: ['https://x/a'],
      maxPages: -1,
    });
    expect(results.every((r) => !r.ok)).toBe(true);
  });

  it('B3: maxPages 1.5 returns failure', async () => {
    const reader = createExtensionPageReader({
      transport: transport(() => ({ ok: true, requestId: 'r', results: [] })),
    });
    const results = await reader.readPages({
      urls: ['https://x/a'],
      maxPages: 1.5,
    });
    expect(results.every((r) => !r.ok)).toBe(true);
  });

  it('B3: valid maxPages 2 sends normalized value in extension message', async () => {
    const send = vi.fn(() =>
      Promise.resolve({
        ok: true,
        requestId: 'r',
        results: [
          {
            url: 'https://x/a',
            ok: true,
            finalUrl: 'https://x/a',
            text: 'body a',
            length: 6,
          },
          {
            url: 'https://x/b',
            ok: true,
            finalUrl: 'https://x/b',
            text: 'body b',
            length: 6,
          },
        ],
      }),
    );
    const reader = createExtensionPageReader({ transport: { send } });
    await reader.readPages({
      urls: ['https://x/a', 'https://x/b', 'https://x/c'],
      maxPages: 2,
    });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ maxPages: 2 }));
  });
});
