/**
 * Extension-backed PageReaderProvider (Part E9). Wraps the message transport to
 * the Web Research Companion and implements the {@link PageReaderProvider} the
 * WebResearchService consumes. The transport is injected (the real one is
 * `chrome.runtime.sendMessage`), so the mapping/validation is unit-testable.
 */

import {
  isExtensionResponse,
  newRequestId,
  type ExtensionErrorKind,
  type ExtensionRequest,
  type ExtensionResponse,
} from './protocol.ts';
import type {
  CurrentTabReadRequest,
  PageReaderProvider,
  PageReadError,
  PageReadErrorKind,
  PageReadPagesRequest,
  PageReadRequest,
  PageReadResult,
} from '../webresearch/types.ts';

/** Sends one validated request to the extension and resolves its raw response. */
export interface ExtensionTransport {
  send(message: ExtensionRequest): Promise<unknown>;
}

export type ExtensionAuditEvent =
  | 'extension.connected'
  | 'extension.missing'
  | 'web.page_read_started'
  | 'web.page_read_completed'
  | 'web.page_read_failed';

export interface ExtensionPageReaderDeps {
  transport: ExtensionTransport;
  /** Optional hook for audit events (kept Redux-agnostic; wired in G3/E10). */
  onAudit?: (event: ExtensionAuditEvent, detail?: string) => void;
}

const ERROR_KIND_MAP: Record<ExtensionErrorKind, PageReadErrorKind> = {
  permission_denied: 'permission_denied',
  timeout: 'timeout',
  navigation_failed: 'navigation_failed',
  extraction_failed: 'extraction_failed',
  unsupported_url: 'unsupported_url',
  extension_missing: 'extension_missing',
  unsupported: 'internal_error',
  forbidden: 'permission_denied',
  internal_error: 'internal_error',
};

function toError(
  response: Extract<ExtensionResponse, { ok: false }>,
): PageReadError {
  return {
    kind: ERROR_KIND_MAP[response.error.kind] ?? 'internal_error',
    message: response.error.message,
    ...(response.error.retryable !== undefined
      ? { retryable: response.error.retryable }
      : {}),
  };
}

function toResult(
  url: string,
  response: Extract<ExtensionResponse, { ok: true }>,
): PageReadResult {
  const text = typeof response.text === 'string' ? response.text : '';
  return {
    ok: true,
    url,
    finalUrl: typeof response.finalUrl === 'string' ? response.finalUrl : url,
    text,
    length: typeof response.length === 'number' ? response.length : text.length,
    ...(typeof response.title === 'string' ? { title: response.title } : {}),
    ...(typeof response.byline === 'string' ? { byline: response.byline } : {}),
    ...(typeof response.siteName === 'string'
      ? { siteName: response.siteName }
      : {}),
    ...(typeof response.markdown === 'string'
      ? { markdown: response.markdown }
      : {}),
    ...(typeof response.excerpt === 'string'
      ? { excerpt: response.excerpt }
      : {}),
  };
}

export function createExtensionPageReader(
  deps: ExtensionPageReaderDeps,
): PageReaderProvider {
  async function exchange(
    message: ExtensionRequest,
    url: string,
  ): Promise<PageReadResult> {
    deps.onAudit?.('web.page_read_started', url);
    let raw: unknown;
    try {
      raw = await deps.transport.send(message);
    } catch (error) {
      deps.onAudit?.('web.page_read_failed', url);
      return {
        ok: false,
        url,
        error: {
          kind: 'extension_missing',
          message:
            error instanceof Error ? error.message : 'extension unreachable',
        },
      };
    }
    if (!isExtensionResponse(raw)) {
      deps.onAudit?.('web.page_read_failed', url);
      return {
        ok: false,
        url,
        error: {
          kind: 'internal_error',
          message: 'invalid extension response',
        },
      };
    }
    if (!raw.ok) {
      deps.onAudit?.('web.page_read_failed', url);
      return { ok: false, url, error: toError(raw) };
    }
    deps.onAudit?.('web.page_read_completed', url);
    return toResult(url, raw);
  }

  return {
    async isAvailable(): Promise<boolean> {
      try {
        const raw = await deps.transport.send({
          type: 'get_status',
          requestId: newRequestId(),
        });
        const available =
          isExtensionResponse(raw) &&
          raw.ok === true &&
          raw['pageReadingAvailable'] === true;
        deps.onAudit?.(available ? 'extension.connected' : 'extension.missing');
        return available;
      } catch {
        deps.onAudit?.('extension.missing');
        return false;
      }
    },

    readPage(request: PageReadRequest): Promise<PageReadResult> {
      return exchange(
        { type: 'read_page', requestId: newRequestId(), ...request },
        request.url,
      );
    },

    async readPages(request: PageReadPagesRequest): Promise<PageReadResult[]> {
      const max = request.maxPages ?? request.urls.length;
      const results: PageReadResult[] = [];
      for (const url of request.urls.slice(0, max)) {
        results.push(
          await this.readPage({
            url,
            ...(request.format ? { format: request.format } : {}),
            ...(request.maxChars ? { maxChars: request.maxChars } : {}),
            ...(request.timeoutMs ? { timeoutMs: request.timeoutMs } : {}),
          }),
        );
      }
      return results;
    },

    readCurrentTab(request: CurrentTabReadRequest): Promise<PageReadResult> {
      return exchange(
        { type: 'read_current_tab', requestId: newRequestId(), ...request },
        '(current tab)',
      );
    },
  };
}
