import { describe, expect, it } from 'vitest';
import { createConfiguredSearchProvider } from './configuredSearchProvider.ts';

function makeTransport(response: Record<string, unknown>, throws = false) {
  return {
    async send(): Promise<unknown> {
      if (throws) throw new Error('extension not reachable');
      return response;
    },
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
