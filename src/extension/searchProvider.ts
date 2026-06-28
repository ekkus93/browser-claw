/**
 * Extension-backed SearchProvider (FIX1-G2). Routes web search through the
 * Web Research Companion extension so the API key never crosses browser CORS
 * restrictions. The key is forwarded from SecretVault in-memory; it is never
 * written to IndexedDB, Redux state, audit event details, or logs.
 */

import {
  isExtensionResponse,
  newRequestId,
  type ExtensionRequest,
} from './protocol.ts';
import type { SearchOptions, SearchProvider, SearchResult } from '../webresearch/types.ts';
import type { ExtensionTransport } from './pageReaderProvider.ts';

export type SearchAuditEvent =
  | 'web.search_started'
  | 'web.search_completed'
  | 'web.search_failed'
  | 'extension.missing';

export interface ChromeExtensionSearchDeps {
  transport: ExtensionTransport;
  /** API key resolved from SecretVault; forwarded to the extension in-memory. */
  apiKey?: string;
  /** Optional hook for audit events; target must never include the key. */
  onAudit?: (event: SearchAuditEvent, detail?: string) => void;
}

export class ExtensionSearchError extends Error {
  readonly kind: 'extension_missing' | 'auth' | 'rate_limit' | 'unavailable' | 'invalid_response';
  constructor(
    kind: ExtensionSearchError['kind'],
    message: string,
  ) {
    super(message);
    this.name = 'ExtensionSearchError';
    this.kind = kind;
  }
}

function normalizeResults(raw: unknown): SearchResult[] {
  if (!Array.isArray(raw)) return [];
  const out: SearchResult[] = [];
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i] as Record<string, unknown>;
    if (typeof r?.url !== 'string') continue;
    out.push({
      title: typeof r.title === 'string' ? r.title : r.url,
      url: r.url,
      ...(typeof r.snippet === 'string' ? { snippet: r.snippet } : {}),
      rank: i + 1,
    });
  }
  return out;
}

/**
 * Create an extension-backed {@link SearchProvider}. The optional `apiKey` is
 * forwarded to the extension for use in the upstream search API call; the key
 * is in-memory only — never stored in IndexedDB, Redux, or audit records.
 */
export function createExtensionSearchProvider(
  deps: ChromeExtensionSearchDeps,
): SearchProvider {
  const { transport, onAudit } = deps;

  return {
    async search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
      const requestId = newRequestId();
      onAudit?.('web.search_started', query);

      const message: ExtensionRequest = {
        type: 'web_search',
        requestId,
        query,
        ...(deps.apiKey !== undefined ? { apiKey: deps.apiKey } : {}),
        ...(options?.maxResults !== undefined ? { maxResults: options.maxResults } : {}),
      };

      let raw: unknown;
      try {
        raw = await transport.send(message);
      } catch (err) {
        onAudit?.(
          'extension.missing',
          err instanceof Error ? err.message : 'Extension transport unavailable',
        );
        throw new ExtensionSearchError(
          'extension_missing',
          'Chrome extension not available for search',
        );
      }

      if (!isExtensionResponse(raw)) {
        onAudit?.('web.search_failed', 'invalid response shape');
        throw new ExtensionSearchError(
          'invalid_response',
          'Extension returned an unrecognised response',
        );
      }

      if (!raw.ok) {
        const kind = raw.error.kind;
        const searchKind: ExtensionSearchError['kind'] =
          kind === 'permission_denied' || kind === 'origin_not_allowed' ? 'auth'
          : 'unavailable';
        onAudit?.('web.search_failed', kind);
        throw new ExtensionSearchError(searchKind, raw.error.message);
      }

      const results = normalizeResults(raw.results);
      onAudit?.('web.search_completed', `${String(results.length)} results`);
      return results;
    },
  };
}
