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
import {
  MAX_BATCH_PAGE_READS,
  MAX_WEB_PAGE_CHARS,
  normalizeOptionalPositiveIntegerLimit,
  LimitValidationError,
} from '../webresearch/limits.ts';
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
  // C1 (FIX11): extension invalid_request maps to invalid_request, not internal_error.
  // internal_error is reserved for unexpected failures and malformed extension responses.
  invalid_request: 'invalid_request',
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

// D1 (FIX4): require non-empty readable content in successful page responses.
function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function toResult(
  url: string,
  response: Extract<ExtensionResponse, { ok: true }>,
): PageReadResult {
  // D1 (FIX4): reject ok:true with no readable content.
  const text = nonEmptyString(response.text);
  const markdown = nonEmptyString(response.markdown);
  if (!text && !markdown) {
    return {
      ok: false,
      url,
      error: {
        kind: 'extraction_failed',
        message:
          'Extension reported success but returned no readable page content.',
      },
    };
  }
  const finalUrl = nonEmptyString(response.finalUrl) ?? url;
  const body = text ?? markdown ?? '';
  return {
    ok: true,
    url,
    finalUrl,
    text: body,
    length: typeof response.length === 'number' ? response.length : body.length,
    ...(typeof response.title === 'string' ? { title: response.title } : {}),
    ...(typeof response.byline === 'string' ? { byline: response.byline } : {}),
    ...(typeof response.siteName === 'string'
      ? { siteName: response.siteName }
      : {}),
    ...(markdown ? { markdown } : {}),
    ...(typeof response.excerpt === 'string'
      ? { excerpt: response.excerpt }
      : {}),
  };
}

// D1/D2 (FIX10): shared maxChars validator used by both readPage() and readPages().
function normalizeOptionalMaxChars(value: unknown): number | undefined {
  return normalizeOptionalPositiveIntegerLimit(value, 'maxChars', {
    max: MAX_WEB_PAGE_CHARS,
  });
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
      // D1 (FIX10): validate maxChars before forwarding to the extension.
      let maxChars: number | undefined;
      try {
        maxChars = normalizeOptionalMaxChars(request.maxChars);
      } catch (err) {
        const message =
          err instanceof LimitValidationError
            ? err.message
            : 'Invalid maxChars.';
        // C1 (FIX11): local invalid caller input uses invalid_request, not internal_error.
        return Promise.resolve({
          ok: false,
          url: request.url,
          error: { kind: 'invalid_request', message, retryable: false },
        });
      }
      return exchange(
        {
          type: 'read_page',
          requestId: newRequestId(),
          ...request,
          ...(maxChars !== undefined ? { maxChars } : {}),
        },
        request.url,
      );
    },

    async readPages(request: PageReadPagesRequest): Promise<PageReadResult[]> {
      // B3 (FIX7): validate maxPages before computing expectedUrls so invalid
      // values cannot expand the effective URL subset.
      let effectiveMaxPages: number | undefined;
      try {
        effectiveMaxPages = normalizeOptionalPositiveIntegerLimit(
          request.maxPages,
          'maxPages',
          { max: MAX_BATCH_PAGE_READS },
        );
      } catch (err) {
        const message =
          err instanceof LimitValidationError
            ? err.message
            : 'invalid maxPages';
        // C1 (FIX11): invalid caller input uses invalid_request, not internal_error.
        return request.urls.map((url) => ({
          ok: false as const,
          url,
          error: { kind: 'invalid_request' as const, message },
        }));
      }

      // E1 (FIX6): compute expectedUrls once at the top — used for ALL failure
      // and success mappings so top-level errors don't map over skipped URLs.
      const expectedUrls =
        effectiveMaxPages !== undefined
          ? request.urls.slice(
              0,
              Math.min(effectiveMaxPages, request.urls.length),
            )
          : request.urls;

      // D2 (FIX10): validate maxChars independently after effectiveMaxPages and
      // expectedUrls are established — mirrors the maxPages try/catch above.
      let effectiveMaxChars: number | undefined;
      try {
        effectiveMaxChars = normalizeOptionalMaxChars(request.maxChars);
      } catch (err) {
        const message =
          err instanceof LimitValidationError
            ? err.message
            : 'Invalid maxChars.';
        // C1 (FIX11): invalid caller input uses invalid_request, not internal_error.
        return expectedUrls.map((url) => ({
          ok: false as const,
          url,
          error: { kind: 'invalid_request' as const, message },
        }));
      }

      // F1 (FIX3): send one read_pages message to the extension — no looping.
      const requestId = newRequestId();
      let raw: unknown;
      try {
        raw = await deps.transport.send({
          type: 'read_pages',
          requestId,
          urls: request.urls,
          ...(effectiveMaxPages !== undefined
            ? { maxPages: effectiveMaxPages }
            : {}),
          ...(request.format !== undefined ? { format: request.format } : {}),
          ...(effectiveMaxChars !== undefined
            ? { maxChars: effectiveMaxChars }
            : {}),
          ...(request.timeoutMs !== undefined
            ? { timeoutMs: request.timeoutMs }
            : {}),
        });
      } catch (error) {
        return expectedUrls.map((url) => ({
          ok: false as const,
          url,
          error: {
            kind: 'extension_missing' as const,
            message:
              error instanceof Error ? error.message : 'extension unreachable',
          },
        }));
      }

      // A1 (FIX12): split top-level batch errors into 3 cases so that the
      // extension's own error kind (e.g. invalid_request) is preserved via
      // toError(), while truly malformed responses stay internal_error.
      if (!isExtensionResponse(raw)) {
        return expectedUrls.map((url) => ({
          ok: false as const,
          url,
          error: {
            kind: 'internal_error' as const,
            message: 'invalid extension response',
            retryable: false,
          },
        }));
      }

      if (!raw.ok) {
        const error = toError(raw);
        return expectedUrls.map((url) => ({ ok: false as const, url, error }));
      }

      if (!Array.isArray(raw['results'])) {
        return expectedUrls.map((url) => ({
          ok: false as const,
          url,
          error: {
            kind: 'internal_error' as const,
            message: 'invalid extension response',
            retryable: false,
          },
        }));
      }

      // D2 (FIX4): map results by URL so missing slots become failure entries.
      // Build a lookup keyed by the URL field each slot reports.
      const slotByUrl = new Map<string, Record<string, unknown>>();
      for (const slot of raw['results'] as unknown[]) {
        const s = slot as Record<string, unknown>;
        const slotUrl = typeof s['url'] === 'string' ? s['url'] : undefined;
        if (slotUrl) slotByUrl.set(slotUrl, s);
      }

      // (E1 FIX5 moved to top of function — expectedUrls already computed above)

      return expectedUrls.map((url) => {
        const s = slotByUrl.get(url);
        if (!s) {
          // D2: extension did not return a result for this URL.
          return {
            ok: false as const,
            url,
            error: {
              kind: 'internal_error' as const,
              message: 'Extension did not return a result for this URL.',
            },
          };
        }
        if (s['ok'] === true) {
          // D1 (FIX4): reject ok:true batch slots with no readable content.
          const text = nonEmptyString(s['text']);
          const markdown = nonEmptyString(s['markdown']);
          if (!text && !markdown) {
            return {
              ok: false as const,
              url,
              error: {
                kind: 'extraction_failed' as const,
                message:
                  'Extension reported success but returned no readable page content.',
              },
            };
          }
          const finalUrl = nonEmptyString(s['finalUrl']) ?? url;
          const body = text ?? markdown ?? '';
          return {
            ok: true as const,
            url,
            finalUrl,
            text: body,
            length: typeof s['length'] === 'number' ? s['length'] : body.length,
            ...(typeof s['title'] === 'string' ? { title: s['title'] } : {}),
            ...(markdown ? { markdown } : {}),
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
