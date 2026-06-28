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
import { tryParseApprovalPayload } from './approvalPayload.ts';
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

function sanitizeSearchOptions(input: unknown): SearchOptions {
  const o = (
    typeof input === 'object' && input !== null ? input : {}
  ) as Record<string, unknown>;
  return {
    ...(typeof o.maxResults === 'number' ? { maxResults: o.maxResults } : {}),
    ...(typeof o.site === 'string' ? { site: o.site } : {}),
  };
}

function sanitizeResearchOptions(input: unknown): ResearchOptions {
  const o = (
    typeof input === 'object' && input !== null ? input : {}
  ) as Record<string, unknown>;
  return {
    ...(typeof o.maxResults === 'number' ? { maxResults: o.maxResults } : {}),
    ...(typeof o.site === 'string' ? { site: o.site } : {}),
    ...(typeof o.maxPages === 'number' ? { maxPages: o.maxPages } : {}),
    ...(o.format === 'text' || o.format === 'markdown'
      ? { format: o.format }
      : {}),
    ...(typeof o.maxChars === 'number' ? { maxChars: o.maxChars } : {}),
  };
}

function sanitizeReadOptions(input: unknown, url: string): PageReadRequest {
  const o = (
    typeof input === 'object' && input !== null ? input : {}
  ) as Record<string, unknown>;
  return {
    url,
    ...(o.format === 'text' || o.format === 'markdown'
      ? { format: o.format }
      : {}),
    ...(typeof o.maxChars === 'number' ? { maxChars: o.maxChars } : {}),
    ...(typeof o.timeoutMs === 'number' ? { timeoutMs: o.timeoutMs } : {}),
  };
}

export function createWebEffectHandler(deps: WebEffectDeps) {
  return async (effect: WebEffect): Promise<void> => {
    if (effect.type === 'web_search') {
      const query = typeof effect.query === 'string' ? effect.query : '';
      void recordAudit(
        deps.db,
        deps.dispatch,
        webAuditEvent('web.search_started', `Web search: ${query}`, {
          status: 'pending',
        }),
      );
      try {
        const results = await deps.web.search(
          query,
          sanitizeSearchOptions(effect.options),
        );
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
      // A multi-page research run (search + read N pages) is bulk egress -> gate.
      const query = typeof effect.query === 'string' ? effect.query : '';
      const options = sanitizeResearchOptions(effect.options);
      const maxPages = options.maxPages ?? 'default';
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
      return;
    }

    // web_page_read: validate the URL and gate behind approval.
    const url = effect.url;
    if (typeof url !== 'string' || !classifyFetchUrl(url).ok) {
      await deps.submit({
        type: 'resolve_effect',
        id: effect.id,
        result: {
          ok: false,
          error: { kind: 'web_invalid_url', message: 'URL is not allowed' },
        },
      });
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
  const parsed = tryParseApprovalPayload(approval.payloadPreview);
  const url = typeof parsed?.url === 'string' ? parsed.url : undefined;

  if (approval.status !== 'approved') {
    void recordAudit(
      deps.db,
      deps.dispatch,
      webAuditEvent(
        'web.page_read_rejected',
        `Web page read rejected: ${url ?? 'unknown'}`,
        { status: 'rejected' },
      ),
    );
    await deps.submit({
      type: 'resolve_effect',
      id: approval.id,
      result: { ok: false, error: { kind: 'user_rejected' } },
    });
    return;
  }

  if (!url || !classifyFetchUrl(url).ok) {
    await deps.submit({
      type: 'resolve_effect',
      id: approval.id,
      result: {
        ok: false,
        error: { kind: 'web_invalid_url', message: 'URL is not allowed' },
      },
    });
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
      sanitizeReadOptions(parsed?.options, url),
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
  const parsed = tryParseApprovalPayload(approval.payloadPreview);
  const query = typeof parsed?.query === 'string' ? parsed.query : '';

  if (approval.status !== 'approved') {
    void recordAudit(
      deps.db,
      deps.dispatch,
      webAuditEvent('web.research_rejected', `Research rejected: ${query}`, {
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

  void recordAudit(
    deps.db,
    deps.dispatch,
    webAuditEvent('web.research_started', `Research started: ${query}`, {
      status: 'pending',
    }),
  );
  try {
    const bundle = await deps.web.research(
      query,
      sanitizeResearchOptions(parsed?.options),
    );
    const failCount = bundle.failures?.length ?? 0;
    const summary =
      failCount > 0
        ? `Research completed: ${query} (${bundle.pages.length} pages, ${String(failCount)} failed)`
        : `Research completed: ${query} (${bundle.pages.length} pages)`;
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
      webAuditEvent('web.research_failed', `Research failed: ${message}`, {
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

