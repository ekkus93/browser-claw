/**
 * Brave Search adapter (Part E2). Implements the {@link SearchProvider}
 * interface against the Brave Web Search API. The API key is injected at
 * construction time (resolved by the host from SecretVault) and never stored
 * inline or logged. Error kinds map to a small closed set so callers get
 * structured failures without raw HTTP details leaking into audit summaries.
 */

import type { SecretFailureKind, KeySource } from '../providers/providerKey.ts';
import type { SearchOptions, SearchProvider, SearchResult } from './types.ts';
import type { SearchProviderProfileRow } from '../db/types.ts';

export const BRAVE_PROFILE_ID = 'brave';
export const BRAVE_SEARCH_URL =
  'https://api.search.brave.com/res/v1/web/search';
export const MAX_SEARCH_RESULTS = 20;

// FIX1-G1: Brave Search API does not support browser-origin CORS.
// A direct browser fetch to api.search.brave.com fails with a CORS error.
// This flag is false until verified otherwise; callers must route through
// the Chrome extension provider (FIX1-G2) when this is false.
export const BRAVE_DIRECT_CORS_VERIFIED = false;

export type SearchErrorKind =
  | 'auth'
  | 'rate_limit'
  | 'network'
  | 'invalid_response'
  | 'unavailable';

export class SearchError extends Error {
  readonly kind: SearchErrorKind;
  constructor(kind: SearchErrorKind, message: string) {
    super(message);
    this.name = 'SearchError';
    this.kind = kind;
  }
}

/** Deterministic SecretVault id that holds a search provider's API key. */
export function searchProviderSecretId(profileId: string): string {
  return `search_provider:${profileId}`;
}

export type SearchKeyResolution =
  | { ok: true; apiKey: string }
  | { ok: false; kind: SecretFailureKind; message: string };

/**
 * Resolve the API key for a search provider profile from an unlocked vault.
 * Mirrors `resolveApiKey` for LLM providers — the key never lands in Redux,
 * audit events, or error messages.
 */
export async function resolveSearchProviderKey(
  vault: KeySource,
  profile: SearchProviderProfileRow,
): Promise<SearchKeyResolution> {
  if (!vault.isUnlocked()) {
    return {
      ok: false,
      kind: 'secret_locked',
      message: 'The secret vault is locked. Unlock it to use Brave Search.',
    };
  }
  const key = await vault.getSecret(searchProviderSecretId(profile.id));
  if (!key) {
    return {
      ok: false,
      kind: 'secret_missing',
      message:
        'No API key is stored for Brave Search. Add one in Settings → Web research.',
    };
  }
  return { ok: true, apiKey: key };
}

export interface BraveSearchDeps {
  apiKey: string;
  /** Injected for tests; defaults to the global fetch. */
  fetch?: typeof globalThis.fetch;
  /**
   * FIX1-G1: Must be true to use the direct browser fetch path.
   * Brave Search API does not support browser-origin CORS; calling without a
   * custom `fetch` dep and without `corsVerified: true` throws immediately.
   * Route through the Chrome extension provider (G2) if CORS is unverified.
   */
  corsVerified?: boolean;
}

/**
 * Create a Brave Search provider with an already-resolved API key. The key is
 * read from the injected `deps` at construction time and never written to any
 * observable state (Redux, IndexedDB, audit logs).
 */
export function createBraveSearchProvider(
  deps: BraveSearchDeps,
): SearchProvider {
  const fetcher = deps.fetch ?? globalThis.fetch.bind(globalThis);

  async function search(
    query: string,
    options?: SearchOptions,
  ): Promise<SearchResult[]> {
    // FIX1-G1: Brave Search API does not support browser-origin CORS.
    // Block the real browser fetch path unless explicitly overridden.
    // Test code that injects deps.fetch is exempt (already in a test context).
    if (!deps.fetch && !deps.corsVerified) {
      throw new SearchError(
        'unavailable',
        'Brave Search direct browser access is not CORS-verified. ' +
          'Configure the Chrome extension search provider (G2) instead.',
      );
    }
    const count = Math.min(options?.maxResults ?? 10, MAX_SEARCH_RESULTS);
    const effectiveQuery = options?.site
      ? `site:${options.site} ${query}`
      : query;
    const url = `${BRAVE_SEARCH_URL}?q=${encodeURIComponent(effectiveQuery)}&count=${String(count)}`;

    let response: Response;
    try {
      response = await fetcher(url, {
        headers: {
          Accept: 'application/json',
          'X-Subscription-Token': deps.apiKey,
        },
      });
    } catch (error) {
      throw new SearchError(
        'network',
        `Brave Search network error: ${
          error instanceof Error ? error.message : 'Network request failed'
        }`,
      );
    }

    if (!response.ok) {
      throw new SearchError(
        classifyStatus(response.status),
        `Brave Search returned status ${String(response.status)}`,
      );
    }

    let body: unknown;
    try {
      body = (await response.json()) as unknown;
    } catch {
      throw new SearchError(
        'invalid_response',
        'Brave Search response was not valid JSON',
      );
    }

    const results = normalizeResults(body);
    if (results === null) {
      throw new SearchError(
        'invalid_response',
        'Brave Search returned an unexpected response shape',
      );
    }
    return results;
  }

  return { search };
}

function classifyStatus(status: number): SearchErrorKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limit';
  if (status >= 500) return 'unavailable';
  return 'invalid_response';
}

function normalizeResults(body: unknown): SearchResult[] | null {
  if (typeof body !== 'object' || body === null) return null;
  const web = (body as Record<string, unknown>).web;
  if (typeof web !== 'object' || web === null) return null;
  const items = (web as Record<string, unknown>).results;
  if (!Array.isArray(items)) return null;

  const output: SearchResult[] = [];
  for (let i = 0; i < items.length; i++) {
    const r = items[i] as Record<string, unknown>;
    if (typeof r?.url !== 'string') continue;
    output.push({
      title: typeof r.title === 'string' ? r.title : r.url,
      url: r.url,
      ...(typeof r.description === 'string' ? { snippet: r.description } : {}),
      rank: i + 1,
    });
  }
  return output;
}
