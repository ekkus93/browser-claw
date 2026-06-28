/**
 * D1: v0.1 search provider resolver. Brave direct CORS is not verified
 * (BRAVE_DIRECT_CORS_VERIFIED = false), so the only available route is the
 * extension-backed search provider. Returns undefined when the extension is
 * absent or does not report webSearchAvailable — callers receive
 * search_unavailable from WebResearchService (fail closed, never silent).
 *
 * A1 (FIX3): the extension search provider now resolves the Brave API key from
 * SecretVault at search time — never at boot. A locked vault or missing key
 * fails visibly as secret_locked / secret_missing.
 */

import { isExtensionResponse, newRequestId } from '../extension/protocol.ts';
import {
  createExtensionSearchProvider,
  ExtensionSearchError,
  type SearchAuditEvent,
} from '../extension/searchProvider.ts';
import type { ExtensionTransport } from '../extension/pageReaderProvider.ts';
import type { KeySource } from '../providers/providerKey.ts';
import type { SearchProvider } from './types.ts';
import { BRAVE_PROFILE_ID, searchProviderSecretId } from './braveSearch.ts';

export interface ConfiguredSearchProviderDeps {
  extensionTransport: ExtensionTransport;
  /**
   * SecretVault (or compatible KeySource) used to resolve the Brave API key at
   * search time. When absent the provider is created without a key (extension
   * must not require one), so pass this in all production wiring.
   */
  secretVault?: KeySource;
  onAudit?: (event: SearchAuditEvent, detail?: string) => void;
}

export async function createConfiguredSearchProvider(
  deps: ConfiguredSearchProviderDeps,
): Promise<SearchProvider | undefined> {
  try {
    const raw = await deps.extensionTransport.send({
      type: 'get_status',
      requestId: newRequestId(),
    });
    if (
      isExtensionResponse(raw) &&
      raw.ok === true &&
      raw['webSearchAvailable'] === true
    ) {
      const resolveApiKey = deps.secretVault
        ? async (): Promise<string> => {
            const vault = deps.secretVault!;
            if (!vault.isUnlocked()) {
              throw new ExtensionSearchError(
                'secret_locked',
                'The secret vault is locked. Unlock it to use Brave Search.',
              );
            }
            const key = await vault.getSecret(
              searchProviderSecretId(BRAVE_PROFILE_ID),
            );
            if (!key || key.trim() === '') {
              throw new ExtensionSearchError(
                'secret_missing',
                'No API key is stored for Brave Search. Add one in Settings → Web research.',
              );
            }
            return key;
          }
        : undefined;

      return createExtensionSearchProvider({
        transport: deps.extensionTransport,
        ...(resolveApiKey ? { resolveApiKey } : {}),
        ...(deps.onAudit ? { onAudit: deps.onAudit } : {}),
      });
    }
  } catch {
    // Extension not reachable — fall through to undefined
  }
  return undefined;
}
