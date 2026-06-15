import { describe, expect, it, vi } from 'vitest';
import { createExtensionPageReader } from './pageReaderProvider.ts';
import type { ExtensionTransport } from './pageReaderProvider.ts';

function transport(
  responder: (msg: { type: string }) => unknown,
): ExtensionTransport {
  return { send: vi.fn((msg) => Promise.resolve(responder(msg))) };
}

describe('createExtensionPageReader (E9)', () => {
  it('reports availability from a ping/pong', async () => {
    const audits: string[] = [];
    const reader = createExtensionPageReader({
      transport: transport((m) =>
        m.type === 'ping' ? { ok: true, requestId: 'r', type: 'pong' } : {},
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
