import { describe, expect, it, vi } from 'vitest';
import {
  createBraveSearchProvider,
  resolveSearchProviderKey,
  searchProviderSecretId,
  SearchError,
  BRAVE_PROFILE_ID,
} from './braveSearch.ts';
import type { SearchProviderProfileRow } from '../db/types.ts';

const BRAVE_PROFILE: SearchProviderProfileRow = {
  id: BRAVE_PROFILE_ID,
  kind: 'brave',
  label: 'Brave Search',
  apiKeyMode: 'session',
};

const VALID_RESPONSE = {
  web: {
    results: [
      {
        title: 'First Result',
        url: 'https://example.com/a',
        description: 'A snippet',
      },
      { title: 'Second Result', url: 'https://example.com/b' },
    ],
  },
};

function mockFetch(status: number, body: unknown): typeof globalThis.fetch {
  return vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
  ) as unknown as typeof globalThis.fetch;
}

function errorFetch(error: Error): typeof globalThis.fetch {
  return vi.fn(async () => {
    throw error;
  }) as unknown as typeof globalThis.fetch;
}

// ── resolveSearchProviderKey ──────────────────────────────────────────────────

describe('resolveSearchProviderKey (E2)', () => {
  it('returns secret_locked when the vault is locked', async () => {
    const vault = { isUnlocked: () => false, getSecret: vi.fn() };
    const result = await resolveSearchProviderKey(vault, BRAVE_PROFILE);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe('secret_locked');
    expect(vault.getSecret).not.toHaveBeenCalled();
  });

  it('returns secret_missing when no key is stored', async () => {
    const vault = {
      isUnlocked: () => true,
      getSecret: vi.fn(async () => undefined),
    };
    const result = await resolveSearchProviderKey(vault, BRAVE_PROFILE);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe('secret_missing');
  });

  it('returns ok with apiKey when the vault is unlocked and key present', async () => {
    const vault = {
      isUnlocked: () => true,
      getSecret: vi.fn(async () => 'BSA_real_key_here'),
    };
    const result = await resolveSearchProviderKey(vault, BRAVE_PROFILE);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.apiKey).toBe('BSA_real_key_here');
    expect(vault.getSecret).toHaveBeenCalledWith(
      searchProviderSecretId(BRAVE_PROFILE_ID),
    );
  });

  it('does not include the raw key in failure messages', async () => {
    const vault = { isUnlocked: () => false, getSecret: vi.fn() };
    const result = await resolveSearchProviderKey(vault, BRAVE_PROFILE);
    if (!result.ok) {
      expect(result.message).not.toContain('BSA_');
    }
  });
});

// ── createBraveSearchProvider ─────────────────────────────────────────────────

describe('createBraveSearchProvider (E2)', () => {
  it('returns normalized SearchResult[] for a valid Brave API response', async () => {
    const provider = createBraveSearchProvider({
      apiKey: 'test-key',
      fetch: mockFetch(200, VALID_RESPONSE),
    });
    const results = await provider.search('cats');
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      title: 'First Result',
      url: 'https://example.com/a',
      snippet: 'A snippet',
      rank: 1,
    });
    expect(results[1]).toMatchObject({
      title: 'Second Result',
      url: 'https://example.com/b',
      rank: 2,
    });
  });

  it('sends the count parameter capped at 20', async () => {
    const fetcher = mockFetch(200, VALID_RESPONSE);
    const provider = createBraveSearchProvider({ apiKey: 'k', fetch: fetcher });
    await provider.search('dogs', { maxResults: 50 });
    const [firstArg] = vi.mocked(fetcher).mock.calls[0] ?? [];
    expect(String(firstArg)).toContain('count=20');
  });

  it('prepends site: operator when site option is set', async () => {
    const fetcher = mockFetch(200, VALID_RESPONSE);
    const provider = createBraveSearchProvider({ apiKey: 'k', fetch: fetcher });
    await provider.search('dogs', { site: 'example.com' });
    const [firstArg] = vi.mocked(fetcher).mock.calls[0] ?? [];
    const url = decodeURIComponent(String(firstArg));
    expect(url).toContain('site:example.com dogs');
  });

  it('throws SearchError("auth") on 401', async () => {
    const provider = createBraveSearchProvider({
      apiKey: 'bad-key',
      fetch: mockFetch(401, {}),
    });
    await expect(provider.search('cats')).rejects.toSatisfy(
      (e: unknown) => e instanceof SearchError && e.kind === 'auth',
    );
  });

  it('throws SearchError("auth") on 403', async () => {
    const provider = createBraveSearchProvider({
      apiKey: 'bad-key',
      fetch: mockFetch(403, {}),
    });
    await expect(provider.search('cats')).rejects.toSatisfy(
      (e: unknown) => e instanceof SearchError && e.kind === 'auth',
    );
  });

  it('throws SearchError("rate_limit") on 429', async () => {
    const provider = createBraveSearchProvider({
      apiKey: 'k',
      fetch: mockFetch(429, {}),
    });
    await expect(provider.search('cats')).rejects.toSatisfy(
      (e: unknown) => e instanceof SearchError && e.kind === 'rate_limit',
    );
  });

  it('throws SearchError("unavailable") on 503', async () => {
    const provider = createBraveSearchProvider({
      apiKey: 'k',
      fetch: mockFetch(503, {}),
    });
    await expect(provider.search('cats')).rejects.toSatisfy(
      (e: unknown) => e instanceof SearchError && e.kind === 'unavailable',
    );
  });

  it('throws SearchError("network") on fetch TypeError (CORS/network)', async () => {
    const provider = createBraveSearchProvider({
      apiKey: 'k',
      fetch: errorFetch(new TypeError('Failed to fetch')),
    });
    await expect(provider.search('cats')).rejects.toSatisfy(
      (e: unknown) => e instanceof SearchError && e.kind === 'network',
    );
  });

  it('throws SearchError("invalid_response") on non-JSON body', async () => {
    const fetcher = vi.fn(
      async () => new Response('not-json', { status: 200 }),
    ) as unknown as typeof globalThis.fetch;
    const provider = createBraveSearchProvider({ apiKey: 'k', fetch: fetcher });
    await expect(provider.search('cats')).rejects.toSatisfy(
      (e: unknown) => e instanceof SearchError && e.kind === 'invalid_response',
    );
  });

  it('throws SearchError("invalid_response") on unexpected response shape', async () => {
    const provider = createBraveSearchProvider({
      apiKey: 'k',
      fetch: mockFetch(200, { unexpected: true }),
    });
    await expect(provider.search('cats')).rejects.toSatisfy(
      (e: unknown) => e instanceof SearchError && e.kind === 'invalid_response',
    );
  });

  it('does not include the API key in thrown error messages', async () => {
    const KEY = 'BSA_supersecret_key';
    const provider = createBraveSearchProvider({
      apiKey: KEY,
      fetch: mockFetch(401, {}),
    });
    try {
      await provider.search('cats');
    } catch (e) {
      expect(e instanceof SearchError).toBe(true);
      if (e instanceof SearchError) {
        expect(e.message).not.toContain(KEY);
      }
    }
  });
});
