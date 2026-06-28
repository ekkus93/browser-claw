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

  it('readPages respects the max page limit', async () => {
    const reader = createExtensionPageReader({
      transport: transport(() => ({
        ok: true,
        requestId: 'r',
        text: 't',
        length: 1,
      })),
    });
    const results = await reader.readPages({
      urls: ['https://x/1', 'https://x/2', 'https://x/3'],
      maxPages: 2,
    });
    expect(results).toHaveLength(2);
  });
});
