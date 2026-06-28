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
  // A2 canonical error kinds
  unsupported_message_type: 'internal_error',
  invalid_request: 'internal_error',
  origin_not_allowed: 'permission_denied',
  permission_denied: 'permission_denied',
  host_permission_missing: 'permission_denied',
  url_blocked: 'unsupported_url',
  tab_create_failed: 'internal_error',
  page_load_timeout: 'timeout',
  script_injection_failed: 'internal_error',
  extraction_failed: 'extraction_failed',
  output_too_large: 'internal_error',
  internal_error: 'internal_error',
  // C2: permission flow required (needs extension popup / user gesture)
  permission_flow_required: 'permission_denied',
  // C3: current-tab read not supported in v0.1
  current_tab_read_unavailable: 'internal_error',
  // Legacy kinds
  timeout: 'timeout',
  navigation_failed: 'navigation_failed',
  unsupported_url: 'unsupported_url',
  extension_missing: 'extension_missing',
  unsupported: 'internal_error',
  forbidden: 'permission_denied',
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
      // F1 (FIX3): send one read_pages message to the extension — no looping.
      const requestId = newRequestId();
      let raw: unknown;
      try {
        raw = await deps.transport.send({
          type: 'read_pages',
          requestId,
          urls: request.urls,
          ...(request.maxPages !== undefined
            ? { maxPages: request.maxPages }
            : {}),
          ...(request.format !== undefined ? { format: request.format } : {}),
          ...(request.maxChars !== undefined
            ? { maxChars: request.maxChars }
            : {}),
          ...(request.timeoutMs !== undefined
            ? { timeoutMs: request.timeoutMs }
            : {}),
        });
      } catch (error) {
        return request.urls.map((url) => ({
          ok: false as const,
          url,
          error: {
            kind: 'extension_missing' as const,
            message:
              error instanceof Error ? error.message : 'extension unreachable',
          },
        }));
      }

      // Top-level error — extension rejected the batch itself.
      if (
        !isExtensionResponse(raw) ||
        !raw.ok ||
        !Array.isArray(raw['results'])
      ) {
        const errorMsg =
          isExtensionResponse(raw) && !raw.ok
            ? raw.error.message
            : 'invalid extension response';
        return request.urls.map((url) => ({
          ok: false as const,
          url,
          error: { kind: 'internal_error' as const, message: errorMsg },
        }));
      }

      // Map per-slot results, preserving failures.
      return (raw['results'] as unknown[]).map((slot, i) => {
        const url = request.urls[i] ?? '';
        const s = slot as Record<string, unknown>;
        if (s['ok'] === true) {
          const text = typeof s['text'] === 'string' ? s['text'] : '';
          return {
            ok: true as const,
            url,
            finalUrl: typeof s['finalUrl'] === 'string' ? s['finalUrl'] : url,
            text,
            length: typeof s['length'] === 'number' ? s['length'] : text.length,
            ...(typeof s['title'] === 'string' ? { title: s['title'] } : {}),
            ...(typeof s['markdown'] === 'string'
              ? { markdown: s['markdown'] }
              : {}),
            ...(typeof s['excerpt'] === 'string'
              ? { excerpt: s['excerpt'] }
              : {}),
          };
        }
        const err = (s['error'] ?? {}) as Record<string, unknown>;
        return {
          ok: false as const,
          url,
          error: {
            kind: (ERROR_KIND_MAP[err['kind'] as ExtensionErrorKind] ??
              'internal_error') as PageReadErrorKind,
            message:
              typeof err['message'] === 'string'
                ? err['message']
                : 'Page read failed.',
          },
        };
      });
    },

    readCurrentTab(request: CurrentTabReadRequest): Promise<PageReadResult> {
      return exchange(
        { type: 'read_current_tab', requestId: newRequestId(), ...request },
        '(current tab)',
      );
    },
  };
}
