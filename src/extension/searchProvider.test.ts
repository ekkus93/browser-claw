import { describe, expect, it, vi } from 'vitest';
import {
  createExtensionSearchProvider,
  ExtensionSearchError,
  type SearchAuditEvent,
} from './searchProvider.ts';

function makeTransport(response: unknown, rejects?: boolean) {
  return {
    send: vi.fn(() =>
      rejects
        ? Promise.reject(new Error('chrome not available'))
        : Promise.resolve(response),
    ),
  };
}

function makeResults(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    title: `Result ${String(i + 1)}`,
    url: `https://example.com/r${String(i + 1)}`,
    snippet: `Snippet ${String(i + 1)}`,
  }));
}

// ---------------------------------------------------------------------------
// G2 — ChromeExtensionSearchProvider
// ---------------------------------------------------------------------------

describe('G2 — createExtensionSearchProvider', () => {
  it('G2: extension search success — returns normalised results', async () => {
    const items = makeResults(2);
    const transport = makeTransport({
      ok: true,
      requestId: 'r1',
      results: items,
    });
    const provider = createExtensionSearchProvider({
      transport,
      resolveApiKey: async () => 'test-key',
    });
    const results = await provider.search('openai GPT');
    expect(results).toHaveLength(2);
    expect(results[0]?.url).toBe('https://example.com/r1');
    expect(results[0]?.rank).toBe(1);
    expect(results[1]?.rank).toBe(2);
  });

  it('G2: extension unavailable (transport throws) → ExtensionSearchError extension_missing', async () => {
    const transport = makeTransport(null, true);
    const provider = createExtensionSearchProvider({ transport });
    let caught: unknown;
    await provider.search('q').catch((e) => {
      caught = e;
    });
    expect(caught).toBeInstanceOf(ExtensionSearchError);
    expect((caught as ExtensionSearchError).kind).toBe('extension_missing');
  });

  it('G2: extension auth failure → ExtensionSearchError auth', async () => {
    const transport = makeTransport({
      ok: false,
      requestId: 'r1',
      error: { kind: 'permission_denied', message: '401 Unauthorized' },
    });
    const provider = createExtensionSearchProvider({
      transport,
      resolveApiKey: async () => 'bad-key',
    });
    let caught: unknown;
    await provider.search('q').catch((e) => {
      caught = e;
    });
    expect(caught).toBeInstanceOf(ExtensionSearchError);
    expect((caught as ExtensionSearchError).kind).toBe('auth');
  });

  it('G2: extension rate-limit / provider error → ExtensionSearchError unavailable', async () => {
    const transport = makeTransport({
      ok: false,
      requestId: 'r1',
      error: {
        kind: 'internal_error',
        message: '429 Too Many Requests',
        retryable: true,
      },
    });
    const provider = createExtensionSearchProvider({
      transport,
      resolveApiKey: async () => 'key',
    });
    let caught: unknown;
    await provider.search('q').catch((e) => {
      caught = e;
    });
    expect(caught).toBeInstanceOf(ExtensionSearchError);
    expect((caught as ExtensionSearchError).kind).toBe('unavailable');
  });

  it('G2: invalid response shape → ExtensionSearchError invalid_response', async () => {
    const transport = makeTransport('not-a-response-object');
    const provider = createExtensionSearchProvider({ transport });
    let caught: unknown;
    await provider.search('q').catch((e) => {
      caught = e;
    });
    expect(caught).toBeInstanceOf(ExtensionSearchError);
    expect((caught as ExtensionSearchError).kind).toBe('invalid_response');
  });

  it('G2/A1: resolveApiKey throwing secret_missing propagates visibly', async () => {
    const transport = makeTransport({ ok: true, requestId: 'r1', results: [] });
    const provider = createExtensionSearchProvider({
      transport,
      resolveApiKey: async () => {
        throw new ExtensionSearchError(
          'secret_missing',
          'No API key configured',
        );
      },
    });
    let caught: unknown;
    await provider.search('q').catch((e) => {
      caught = e;
    });
    expect(caught).toBeInstanceOf(ExtensionSearchError);
    expect((caught as ExtensionSearchError).kind).toBe('secret_missing');
    // Transport must NOT be called if key resolution fails
    expect(transport.send).not.toHaveBeenCalled();
  });

  it('G2/A1: resolveApiKey throwing secret_locked propagates visibly', async () => {
    const transport = makeTransport({ ok: true, requestId: 'r1', results: [] });
    const provider = createExtensionSearchProvider({
      transport,
      resolveApiKey: async () => {
        throw new ExtensionSearchError('secret_locked', 'Vault is locked');
      },
    });
    let caught: unknown;
    await provider.search('q').catch((e) => {
      caught = e;
    });
    expect(caught).toBeInstanceOf(ExtensionSearchError);
    expect((caught as ExtensionSearchError).kind).toBe('secret_locked');
    expect(transport.send).not.toHaveBeenCalled();
  });

  it('G2/A1: resolveApiKey result is forwarded in the extension message', async () => {
    let capturedMsg: Record<string, unknown> | undefined;
    const transport = {
      send: vi.fn(async (msg: unknown) => {
        capturedMsg = msg as Record<string, unknown>;
        return { ok: true, requestId: 'r1', results: [] };
      }),
    };
    const provider = createExtensionSearchProvider({
      transport,
      resolveApiKey: async () => 'live-api-key',
    });
    await provider.search('q');
    expect(capturedMsg?.apiKey).toBe('live-api-key');
  });

  it('G2: no key leakage — resolved API key does not appear in audit event details', async () => {
    const transport = makeTransport({
      ok: true,
      requestId: 'r1',
      results: makeResults(1),
    });
    const auditDetails: string[] = [];
    const provider = createExtensionSearchProvider({
      transport,
      resolveApiKey: async () => 'super-secret-api-key-12345',
      onAudit: (_event: SearchAuditEvent, detail?: string) => {
        if (detail) auditDetails.push(detail);
      },
    });
    await provider.search('query');
    for (const detail of auditDetails) {
      expect(detail).not.toContain('super-secret-api-key-12345');
    }
  });

  it('G2: audit events emitted — started + completed on success', async () => {
    const transport = makeTransport({
      ok: true,
      requestId: 'r1',
      results: makeResults(3),
    });
    const events: SearchAuditEvent[] = [];
    const provider = createExtensionSearchProvider({
      transport,
      resolveApiKey: async () => 'key',
      onAudit: (e: SearchAuditEvent) => events.push(e),
    });
    await provider.search('q');
    expect(events).toContain('web.search_started');
    expect(events).toContain('web.search_completed');
    expect(events).not.toContain('web.search_failed');
  });

  it('G2: audit event emitted on failure — search_failed', async () => {
    const transport = makeTransport({
      ok: false,
      requestId: 'r1',
      error: { kind: 'internal_error', message: 'error' },
    });
    const events: SearchAuditEvent[] = [];
    const provider = createExtensionSearchProvider({
      transport,
      resolveApiKey: async () => 'key',
      onAudit: (e: SearchAuditEvent) => events.push(e),
    });
    await provider.search('q').catch(() => {});
    expect(events).toContain('web.search_failed');
    expect(events).not.toContain('web.search_completed');
  });
});
