/**
 * Host handler for the runtime's `web_search` / `web_page_read` effects (Part
 * F3). A read-only web search runs directly (it's metadata, not egress of page
 * content) and resolves with its results. A page read is a network egress of a
 * specific URL, so it is validated and queued for inline approval; nothing is
 * fetched until the user approves, after which the mediated reader runs and the
 * effect resolves with the page content. Every step is audited under the `web`
 * source (summaries are length-capped by the audit layer, so a large page body
 * is never stored whole).
 */

import { approvalRequested } from '../store/slices/approvalsSlice.ts';
import { recordAudit } from '../audit/auditSink.ts';
import { webAuditEvent } from '../audit/auditEvents.ts';
import { classifyFetchUrl } from '../net/urlSafety.ts';
import {
  MAX_BATCH_PAGE_READS,
  MAX_SEARCH_RESULTS,
  MAX_WEB_PAGE_CHARS,
  normalizeOptionalPositiveIntegerLimit,
} from '../webresearch/limits.ts';
import {
  parseApprovalPayloadObject,
  requireStringArrayField,
  requireStringField,
} from './approvalPayload.ts';
import type { AppDispatch } from '../store/store.ts';
import type { BrowserClawDB } from '../db/db.ts';
import type {
  PageReadRequest,
  ResearchOptions,
  SearchOptions,
  WebResearchService,
} from '../webresearch/types.ts';
import type { Command, Effect } from './effectTypes.ts';

type WebEffect = Extract<
  Effect,
  { type: 'web_search' | 'web_page_read' | 'web_research' }
>;

export interface WebEffectDeps {
  web: WebResearchService;
  db: BrowserClawDB;
  dispatch: AppDispatch;
  submit: (command: Command) => Promise<void>;
}

// B1 (FIX4): fail-closed effect payload validators. Even if Rust/WASM runtime
// validation improves, the host must not call providers with empty/malformed values.

class WebEffectPayloadError extends Error {
  readonly kind: string;
  constructor(kind: string, message: string) {
    super(message);
    this.name = 'WebEffectPayloadError';
    this.kind = kind;
  }
}

function requireEffectString(value: string, label: string): string {
  if (value.trim() === '') {
    throw new WebEffectPayloadError(
      'web_effect_missing_field',
      `${label} must be a non-empty string.`,
    );
  }
  return value.trim();
}

function requireEffectStringArray(values: string[], label: string): string[] {
  if (values.length === 0) {
    throw new WebEffectPayloadError(
      'web_effect_missing_field',
      `${label} must be a non-empty array.`,
    );
  }
  return values.map((item, index) => {
    if (item.trim() === '') {
      throw new WebEffectPayloadError(
        'web_effect_invalid_field',
        `${label}[${index}] must be a non-empty string.`,
      );
    }
    return item.trim();
  });
}

async function failInvalidWebEffect(
  deps: WebEffectDeps,
  effectId: string,
  error: unknown,
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  void recordAudit(
    deps.db,
    deps.dispatch,
    webAuditEvent(
      'web.effect_payload_invalid',
      'Web effect payload was invalid.',
      {
        status: 'failure',
        risk: 'medium',
      },
    ),
  );
  await deps.submit({
    type: 'resolve_effect',
    id: effectId,
    result: {
      ok: false,
      error: { kind: 'web_effect_payload_invalid', message, retryable: false },
    },
  });
}

// A1 (FIX10): shared helpers for strict options validation.
function assertPlainOptionsObject(
  input: unknown,
  label: string,
): Record<string, unknown> {
  if (input === undefined) return {};
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new WebEffectPayloadError(
      'web_effect_invalid_field',
      `${label} must be an object.`,
    );
  }
  return input as Record<string, unknown>;
}

function rejectUnknownOptionFields(
  input: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  label: string,
): void {
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) {
      throw new WebEffectPayloadError(
        'web_effect_invalid_field',
        `Unsupported ${label} field: ${key}.`,
      );
    }
  }
}

// A1 (FIX10): only maxResults is supported for web_search effects.
// site is not supported end-to-end; format/timeoutMs are not search fields.
const SEARCH_OPTION_FIELDS: ReadonlySet<string> = new Set(['maxResults']);

function sanitizeSearchOptions(input: unknown): SearchOptions {
  const o = assertPlainOptionsObject(input, 'web_search.options');
  rejectUnknownOptionFields(o, SEARCH_OPTION_FIELDS, 'web_search.options');
  const maxResults =
    o.maxResults !== undefined
      ? normalizeOptionalPositiveIntegerLimit(o.maxResults, 'maxResults', {
          max: MAX_SEARCH_RESULTS,
        })
      : undefined;
  return {
    ...(maxResults !== undefined ? { maxResults } : {}),
  };
}

function sanitizeResearchOptions(input: unknown): ResearchOptions {
  const o = (
    typeof input === 'object' && input !== null ? input : {}
  ) as Record<string, unknown>;
  const maxPages =
    o.maxPages !== undefined
      ? normalizeOptionalPositiveIntegerLimit(o.maxPages, 'maxPages', {
          max: MAX_BATCH_PAGE_READS,
        })
      : undefined;
  // D1 (FIX9): validate maxResults and maxChars so invalid values throw here
  // rather than silently passing through to the provider.
  const maxResults =
    o.maxResults !== undefined
      ? normalizeOptionalPositiveIntegerLimit(o.maxResults, 'maxResults', {
          max: MAX_SEARCH_RESULTS,
        })
      : undefined;
  const maxChars =
    o.maxChars !== undefined
      ? normalizeOptionalPositiveIntegerLimit(o.maxChars, 'maxChars', {
          max: MAX_WEB_PAGE_CHARS,
        })
      : undefined;
  return {
    ...(maxResults !== undefined ? { maxResults } : {}),
    ...(typeof o.site === 'string' ? { site: o.site } : {}),
    ...(maxPages !== undefined ? { maxPages } : {}),
    ...(o.format === 'text' || o.format === 'markdown'
      ? { format: o.format }
      : {}),
    ...(maxChars !== undefined ? { maxChars } : {}),
  };
}

// B1 (FIX10): only maxChars is supported for web_page_read effects.
// format and timeoutMs are not supported end-to-end; reject them.
const PAGE_READ_OPTION_FIELDS: ReadonlySet<string> = new Set(['maxChars']);

function sanitizeReadOptions(input: unknown, url: string): PageReadRequest {
  const o = assertPlainOptionsObject(input, 'web_page_read.options');
  rejectUnknownOptionFields(
    o,
    PAGE_READ_OPTION_FIELDS,
    'web_page_read.options',
  );
  const maxChars =
    o.maxChars !== undefined
      ? normalizeOptionalPositiveIntegerLimit(o.maxChars, 'maxChars', {
          max: MAX_WEB_PAGE_CHARS,
        })
      : undefined;
  return {
    url,
    ...(maxChars !== undefined ? { maxChars } : {}),
  };
}

export function createWebEffectHandler(deps: WebEffectDeps) {
  return async (effect: WebEffect): Promise<void> => {
    if (effect.type === 'web_search') {
      // B1 (FIX4): reject empty query before calling provider.
      // A2 (FIX10): validate options in same try/catch — invalid options audit
      // web.effect_payload_invalid and do not reach web.search_started.
      let query: string;
      let searchOptions: SearchOptions;
      try {
        query = requireEffectString(effect.query, 'web_search.query');
        searchOptions = sanitizeSearchOptions(effect.options);
      } catch (error) {
        await failInvalidWebEffect(deps, effect.id, error);
        return;
      }
      void recordAudit(
        deps.db,
        deps.dispatch,
        webAuditEvent('web.search_started', `Web search: ${query}`, {
          status: 'pending',
        }),
      );
      try {
        const results = await deps.web.search(query, searchOptions);
        void recordAudit(
          deps.db,
          deps.dispatch,
          webAuditEvent(
            'web.search_completed',
            `Web search returned ${results.length} results`,
            { status: 'success' },
          ),
        );
        await deps.submit({
          type: 'resolve_effect',
          id: effect.id,
          result: { ok: true, results },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        void recordAudit(
          deps.db,
          deps.dispatch,
          webAuditEvent('web.search_failed', `Web search failed: ${message}`, {
            risk: 'medium',
            status: 'failure',
          }),
        );
        await deps.submit({
          type: 'resolve_effect',
          id: effect.id,
          result: {
            ok: false,
            error: { kind: 'web_search_failed', message },
          },
        });
      }
      return;
    }

    if (effect.type === 'web_research') {
      // A multi-page research run is bulk egress → gate behind approval.
      // C3 (FIX3): discriminate mode:'query' vs mode:'urls' so URL arrays
      // are never collapsed to an empty query string.
      // B1 (FIX4): validate fields before approval dispatch.
      // C1 (FIX8): wrap option sanitization — invalid effect.options must not
      // throw out of the handler; audit and resolve instead.
      let options: ResearchOptions;
      try {
        options = sanitizeResearchOptions(effect.options);
      } catch (error) {
        await failInvalidWebEffect(deps, effect.id, error);
        return;
      }
      const maxPages = options.maxPages ?? 'default';
      if (effect.mode === 'urls') {
        let urlList: string[];
        try {
          urlList = requireEffectStringArray(effect.urls, 'web_research.urls');
        } catch (error) {
          await failInvalidWebEffect(deps, effect.id, error);
          return;
        }
        deps.dispatch(
          approvalRequested({
            id: effect.id,
            kind: 'bulk_research',
            title: `Read ${String(urlList.length)} page(s)`,
            risk: 'high',
            summary: `Read ${String(urlList.length)} page(s): ${urlList.slice(0, 3).join(', ')}${urlList.length > 3 ? '…' : ''}`,
            payloadPreview: JSON.stringify({ urls: urlList, options }),
          }),
        );
      } else {
        let query: string;
        try {
          query = requireEffectString(effect.query, 'web_research.query');
        } catch (error) {
          await failInvalidWebEffect(deps, effect.id, error);
          return;
        }
        deps.dispatch(
          approvalRequested({
            id: effect.id,
            kind: 'bulk_research',
            title: `Research: ${query}`,
            risk: 'high',
            summary: `Web research "${query}" reading up to ${maxPages} pages${
              options.site ? ` on ${options.site}` : ''
            }`,
            payloadPreview: JSON.stringify({ query, options }),
          }),
        );
      }
      return;
    }

    // web_page_read: validate the URL and gate behind approval.
    // F1 (FIX5): missing/invalid/blocked URL audits web.effect_payload_invalid
    // (consistent with web_search and web_research invalid-payload handling).
    const url = effect.url;
    if (typeof url !== 'string' || url.trim() === '') {
      await failInvalidWebEffect(
        deps,
        effect.id,
        new Error('web_page_read.url must be a non-empty string.'),
      );
      return;
    }
    if (!classifyFetchUrl(url).ok) {
      await failInvalidWebEffect(
        deps,
        effect.id,
        new Error(`web_page_read.url is not an allowed URL: ${url}`),
      );
      return;
    }
    // B2 (FIX10): validate options before queuing approval so invalid options
    // fail early (web.effect_payload_invalid) and never reach the approval card.
    try {
      sanitizeReadOptions(effect.options, url);
    } catch (error) {
      await failInvalidWebEffect(deps, effect.id, error);
      return;
    }
    deps.dispatch(
      approvalRequested({
        id: effect.id,
        kind: 'web_page_read',
        title: `Read web page: ${url}`,
        risk: 'medium',
        summary: `Read web page ${url}`,
        payloadPreview: JSON.stringify({ url, options: effect.options ?? {} }),
      }),
    );
  };
}

export interface ApprovedWebPageRead {
  id: string;
  status: 'approved' | 'rejected';
  /** The `{url, options}` JSON the user reviewed (the approval's payloadPreview). */
  payloadPreview?: string;
}

/**
 * Read (or decline) a web page the user resolved on the approval card, then
 * resolve the runtime effect. Called by the approval-resolution listener.
 */
export async function runApprovedWebPageRead(
  deps: WebEffectDeps,
  approval: ApprovedWebPageRead,
): Promise<void> {
  if (approval.status !== 'approved') {
    void recordAudit(
      deps.db,
      deps.dispatch,
      webAuditEvent('web.page_read_rejected', 'Web page read rejected', {
        status: 'rejected',
      }),
    );
    await deps.submit({
      type: 'resolve_effect',
      id: approval.id,
      result: { ok: false, error: { kind: 'user_rejected' } },
    });
    return;
  }

  // G1 (FIX3): strict payload parsing — fail closed on missing/invalid url.
  let parsed: Record<string, unknown>;
  let url: string;
  try {
    parsed = parseApprovalPayloadObject(
      approval.payloadPreview,
      'web_page_read',
    );
    url = requireStringField(parsed, 'url', 'web_page_read');
  } catch (error) {
    // F1 (FIX5): use shared failInvalidWebEffect to audit web.effect_payload_invalid.
    await failInvalidWebEffect(deps, approval.id, error);
    return;
  }

  if (!classifyFetchUrl(url).ok) {
    // F1 (FIX5): blocked URL after approval must also audit web.effect_payload_invalid.
    await failInvalidWebEffect(
      deps,
      approval.id,
      new Error(`web_page_read.url is not an allowed URL: ${url}`),
    );
    return;
  }

  void recordAudit(
    deps.db,
    deps.dispatch,
    webAuditEvent('web.page_read_started', `Reading web page ${url}`, {
      status: 'pending',
    }),
  );
  try {
    const content = await deps.web.readPage(
      url,
      sanitizeReadOptions(parsed.options, url),
    );
    void recordAudit(
      deps.db,
      deps.dispatch,
      webAuditEvent(
        'web.page_read_completed',
        `Read web page ${content.finalUrl} (${content.length} chars)`,
        { status: 'success' },
      ),
    );
    await deps.submit({
      type: 'resolve_effect',
      id: approval.id,
      result: { ok: true, content },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    void recordAudit(
      deps.db,
      deps.dispatch,
      webAuditEvent(
        'web.page_read_failed',
        `Web page read failed: ${message}`,
        {
          risk: 'medium',
          status: 'failure',
        },
      ),
    );
    await deps.submit({
      type: 'resolve_effect',
      id: approval.id,
      result: { ok: false, error: { kind: 'web_page_read_failed', message } },
    });
  }
}

export interface ApprovedBulkResearch {
  id: string;
  status: 'approved' | 'rejected';
  /** The `{query, options}` JSON the user reviewed (the approval's payloadPreview). */
  payloadPreview?: string;
}

/**
 * Run (or decline) a bulk research operation the user resolved on the approval
 * card, then resolve the runtime effect with the research bundle.
 */
export async function runApprovedBulkResearch(
  deps: WebEffectDeps,
  approval: ApprovedBulkResearch,
): Promise<void> {
  // D1 (FIX6): check rejection BEFORE parsing payload — a rejected malformed
  // approval must audit research_rejected, not bulk_research_payload_invalid.
  if (approval.status !== 'approved') {
    void recordAudit(
      deps.db,
      deps.dispatch,
      webAuditEvent('web.research_rejected', 'Bulk research request rejected', {
        status: 'rejected',
      }),
    );
    await deps.submit({
      type: 'resolve_effect',
      id: approval.id,
      result: { ok: false, error: { kind: 'user_rejected' } },
    });
    return;
  }

  // B2 (FIX4): strict payload parsing — validate every URL slot and check
  // URL safety policy before calling provider.
  // D1 (FIX9): options validation also runs here so invalid options classify
  // as bulk_research_payload_invalid, not research_failed.
  let urls: string[] | undefined;
  let query: string | undefined;
  let options: ResearchOptions;

  try {
    const parsed = parseApprovalPayloadObject(
      approval.payloadPreview,
      'web_bulk_research',
    );

    options = sanitizeResearchOptions(parsed.options);

    if ('urls' in parsed) {
      // URLs mode: validate every slot and check URL safety policy.
      const rawUrls = requireStringArrayField(
        parsed,
        'urls',
        'web_bulk_research',
      );
      for (const url of rawUrls) {
        if (!classifyFetchUrl(url).ok) {
          throw new Error(`URL not allowed by safety policy: ${url}`);
        }
      }
      urls = rawUrls;
    } else {
      // Query mode: require non-empty query string.
      query = requireStringField(parsed, 'query', 'web_bulk_research');
    }
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Invalid bulk research payload';
    void recordAudit(
      deps.db,
      deps.dispatch,
      webAuditEvent('web.bulk_research_payload_invalid', message, {
        risk: 'medium',
        status: 'failure',
      }),
    );
    await deps.submit({
      type: 'resolve_effect',
      id: approval.id,
      result: { ok: false, error: { kind: 'web_invalid_payload', message } },
    });
    return;
  }

  const isUrlsMode = urls !== undefined;
  const label = isUrlsMode
    ? `Read ${String(urls!.length)} page(s)`
    : `Research: ${query ?? ''}`;

  void recordAudit(
    deps.db,
    deps.dispatch,
    webAuditEvent('web.research_started', `${label} started`, {
      status: 'pending',
    }),
  );
  try {
    let bundle: Awaited<ReturnType<typeof deps.web.research>>;
    if (isUrlsMode) {
      bundle = await deps.web.readPages(urls!, options);
    } else {
      bundle = await deps.web.research(query!, options);
    }
    const failCount = bundle.failures?.length ?? 0;
    const summary =
      failCount > 0
        ? `${label} completed (${bundle.pages.length} pages, ${String(failCount)} failed)`
        : `${label} completed (${bundle.pages.length} pages)`;
    void recordAudit(
      deps.db,
      deps.dispatch,
      webAuditEvent('web.research_completed', summary, { status: 'success' }),
    );
    await deps.submit({
      type: 'resolve_effect',
      id: approval.id,
      result: { ok: true, bundle },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    void recordAudit(
      deps.db,
      deps.dispatch,
      webAuditEvent('web.research_failed', `${label} failed: ${message}`, {
        risk: 'medium',
        status: 'failure',
      }),
    );
    await deps.submit({
      type: 'resolve_effect',
      id: approval.id,
      result: { ok: false, error: { kind: 'web_research_failed', message } },
    });
  }
}
