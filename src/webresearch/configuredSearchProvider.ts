/**
 * D1: v0.1 search provider resolver. Brave direct CORS is not verified
 * (BRAVE_DIRECT_CORS_VERIFIED = false), so the only available route is the
 * extension-backed search provider. Returns undefined when the extension is
 * absent or does not report webSearchAvailable — callers receive
 * search_unavailable from WebResearchService (fail closed, never silent).
 */

import { isExtensionResponse, newRequestId } from '../extension/protocol.ts';
import {
  createExtensionSearchProvider,
  type SearchAuditEvent,
} from '../extension/searchProvider.ts';
import type { ExtensionTransport } from '../extension/pageReaderProvider.ts';
import type { SearchProvider } from './types.ts';

export interface ConfiguredSearchProviderDeps {
  extensionTransport: ExtensionTransport;
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
      return createExtensionSearchProvider({
        transport: deps.extensionTransport,
        ...(deps.onAudit ? { onAudit: deps.onAudit } : {}),
      });
    }
  } catch {
    // Extension not reachable — fall through to undefined
  }
  return undefined;
}
