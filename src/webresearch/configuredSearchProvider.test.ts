import { describe, expect, it } from 'vitest';
import { createConfiguredSearchProvider } from './configuredSearchProvider.ts';
import { ExtensionSearchError } from '../extension/searchProvider.ts';

function makeTransport(response: Record<string, unknown>, throws = false) {
  return {
    async send(): Promise<unknown> {
      if (throws) throw new Error('extension not reachable');
      return response;
    },
  };
}

function makeSearchTransport(statusResponse: Record<string, unknown>) {
  let callCount = 0;
  const messages: Record<string, unknown>[] = [];
  return {
    async send(msg: unknown): Promise<unknown> {
      const m = msg as Record<string, unknown>;
      messages.push(m);
      if (m.type === 'get_status') {
        return { ok: true, requestId: m.requestId, ...statusResponse };
      }
      callCount++;
      return {
        ok: true,
        requestId: m.requestId,
        results: [{ title: 'R', url: 'https://example.com/', rank: 1 }],
      };
    },
    get searchCallCount() {
      return callCount;
    },
    get sentMessages() {
      return messages;
    },
  };
}

function makeVault(opts: { unlocked?: boolean; key?: string } = {}): {
  isUnlocked(): boolean;
  getSecret(id: string): Promise<string | undefined>;
} {
  const unlocked = opts.unlocked ?? true;
  const key = opts.key ?? 'brave-api-key-abc123';
  return {
    isUnlocked: () => unlocked,
    getSecret: async (id: string) => (id.includes('brave') ? key : undefined),
  };
}

describe('D1 — createConfiguredSearchProvider', () => {
  it('D1: returns a SearchProvider when extension reports webSearchAvailable:true', async () => {
    const transport = makeTransport({
      ok: true,
      requestId: 'r1',
      webSearchAvailable: true,
    });
    const provider = await createConfiguredSearchProvider({
      extensionTransport: transport,
    });
    expect(provider).toBeDefined();
    expect(typeof provider?.search).toBe('function');
  });

  it('D1: returns undefined when extension reports webSearchAvailable:false', async () => {
    const transport = makeTransport({
      ok: true,
      requestId: 'r1',
      webSearchAvailable: false,
    });
    const provider = await createConfiguredSearchProvider({
      extensionTransport: transport,
    });
    expect(provider).toBeUndefined();
  });

  it('D1: returns undefined when extension is not reachable', async () => {
    const transport = makeTransport({}, true);
    const provider = await createConfiguredSearchProvider({
      extensionTransport: transport,
    });
    expect(provider).toBeUndefined();
  });

  it('D1: returned provider delegates search calls to the extension', async () => {
    const results = [{ title: 'A', url: 'https://a.example.com/', rank: 1 }];
    let lastMessage: Record<string, unknown> | undefined;
    const transport = {
      async send(msg: unknown): Promise<unknown> {
        const m = msg as Record<string, unknown>;
        if (m.type === 'get_status') {
          return { ok: true, requestId: m.requestId, webSearchAvailable: true };
        }
        lastMessage = m;
        return { ok: true, requestId: m.requestId, results };
      },
    };
    const provider = await createConfiguredSearchProvider({
      extensionTransport: transport,
    });
    const found = await provider!.search('hello');
    expect(lastMessage?.type).toBe('web_search');
    expect(lastMessage?.query).toBe('hello');
    expect(found).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ url: 'https://a.example.com/' }),
      ]),
    );
  });
});

describe('A1 — secretVault wiring in configuredSearchProvider', () => {
  it('A1: saved key is forwarded inside the web_search extension message', async () => {
    const transport = makeSearchTransport({ webSearchAvailable: true });
    const vault = makeVault({ key: 'my-brave-api-key' });
    const provider = await createConfiguredSearchProvider({
      extensionTransport: transport,
      secretVault: vault,
    });
    await provider!.search('hello');
    const searchMsg = transport.sentMessages.find(
      (m) => m.type === 'web_search',
    );
    expect(searchMsg?.apiKey).toBe('my-brave-api-key');
  });

  it('A1: missing key fails visibly as secret_missing — extension not called', async () => {
    const transport = makeSearchTransport({ webSearchAvailable: true });
    const vault = makeVault({ key: '' }); // empty key = missing
    const provider = await createConfiguredSearchProvider({
      extensionTransport: transport,
      secretVault: vault,
    });
    let caught: unknown;
    await provider!.search('q').catch((e) => {
      caught = e;
    });
    expect(caught).toBeInstanceOf(ExtensionSearchError);
    expect((caught as ExtensionSearchError).kind).toBe('secret_missing');
    expect(transport.searchCallCount).toBe(0);
  });

  it('A1: locked vault fails visibly as secret_locked — extension not called', async () => {
    const transport = makeSearchTransport({ webSearchAvailable: true });
    const vault = makeVault({ unlocked: false });
    const provider = await createConfiguredSearchProvider({
      extensionTransport: transport,
      secretVault: vault,
    });
    let caught: unknown;
    await provider!.search('q').catch((e) => {
      caught = e;
    });
    expect(caught).toBeInstanceOf(ExtensionSearchError);
    expect((caught as ExtensionSearchError).kind).toBe('secret_locked');
    expect(transport.searchCallCount).toBe(0);
  });

  it('A1: audit events do not contain raw API key material', async () => {
    const transport = makeSearchTransport({ webSearchAvailable: true });
    const vault = makeVault({ key: 'super-secret-brave-key-xyz' });
    const auditDetails: string[] = [];
    const provider = await createConfiguredSearchProvider({
      extensionTransport: transport,
      secretVault: vault,
      onAudit: (_event, detail) => {
        if (detail) auditDetails.push(detail);
      },
    });
    await provider!.search('test query');
    for (const detail of auditDetails) {
      expect(detail).not.toContain('super-secret-brave-key-xyz');
    }
  });

  it('A1: no secretVault provided — provider created without key (backward compat)', async () => {
    const transport = makeSearchTransport({ webSearchAvailable: true });
    const provider = await createConfiguredSearchProvider({
      extensionTransport: transport,
    });
    // Should still work (no resolveApiKey means no key forwarded)
    await provider!.search('q');
    const searchMsg = transport.sentMessages.find(
      (m) => m.type === 'web_search',
    );
    expect(searchMsg?.apiKey).toBeUndefined();
  });
});
