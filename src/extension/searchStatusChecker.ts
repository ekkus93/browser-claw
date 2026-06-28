/**
 * FIX1-G3: Search availability status checker. Performs a real probe to
 * distinguish between the five possible states so the UI never claims search
 * is available when it is not.
 *
 * States (mutually exclusive, returned as a tagged union):
 *   - no_provider      — no search provider or extension is configured
 *   - key_locked       — provider configured but vault is locked / key missing
 *   - extension_unavailable — provider requires extension but it is not reachable
 *   - provider_unavailable  — provider reachable but probe search failed
 *   - connected        — probe search succeeded
 */

import { isExtensionResponse, newRequestId } from './protocol.ts';
import type { ExtensionTransport } from './pageReaderProvider.ts';
import type { SearchProvider } from '../webresearch/types.ts';

export type SearchStatusState =
  | { status: 'no_provider' }
  | { status: 'key_locked'; message: string }
  | { status: 'extension_unavailable'; message: string }
  | { status: 'provider_unavailable'; message: string }
  | { status: 'connected'; resultCount: number };

export interface SearchStatusCheckerDeps {
  /** Transport to send a get_status probe to the extension. */
  transport?: ExtensionTransport;
  /** A fully configured search provider to run the probe search. */
  searchProvider?: SearchProvider;
  /**
   * Whether the vault is unlocked and a key is available.
   * Supply false when the vault is locked or no key is stored.
   */
  keyAvailable?: boolean;
  /** Message to return when the key is unavailable. */
  keyUnavailableMessage?: string;
  /** Query used for the probe search. Defaults to 'test'. */
  probeQuery?: string;
}

/**
 * Check search availability. Performs a real probe search; returns a
 * discriminated union describing the state so the UI can be truthful.
 * The probe query MUST be cheap — use the caller's injected `probeQuery`
 * only for status checks, not for actual research output.
 */
export async function checkSearchStatus(
  deps: SearchStatusCheckerDeps,
): Promise<SearchStatusState> {
  const { transport, searchProvider, keyAvailable, probeQuery = 'test' } = deps;

  // No provider configured at all.
  if (!searchProvider && !transport) {
    return { status: 'no_provider' };
  }

  // Provider requires a key (vault path) and it is not available.
  if (keyAvailable === false) {
    return {
      status: 'key_locked',
      message:
        deps.keyUnavailableMessage ??
        'Search API key is locked or not configured.',
    };
  }

  // If an extension transport is provided, verify the extension is reachable
  // and has web search capability.
  if (transport) {
    let extOk: boolean;
    try {
      const raw = await transport.send({
        type: 'get_status',
        requestId: newRequestId(),
      });
      extOk =
        isExtensionResponse(raw) &&
        raw.ok === true &&
        raw['webSearchAvailable'] === true;
    } catch {
      extOk = false;
    }
    if (!extOk) {
      return {
        status: 'extension_unavailable',
        message:
          'The BrowserClaw extension is not installed or does not support web search.',
      };
    }
  }

  // No search provider means we can't probe.
  if (!searchProvider) {
    return {
      status: 'provider_unavailable',
      message: 'No search provider is configured.',
    };
  }

  // Perform a real probe search to verify end-to-end.
  try {
    const results = await searchProvider.search(probeQuery, { maxResults: 1 });
    return { status: 'connected', resultCount: results.length };
  } catch (err) {
    return {
      status: 'provider_unavailable',
      message: err instanceof Error ? err.message : 'Search probe failed.',
    };
  }
}
