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
import type { AppDispatch } from '../store/store.ts';
import type { BrowserClawDB } from '../db/db.ts';
import type {
  PageReadRequest,
  SearchOptions,
  WebResearchService,
} from '../webresearch/types.ts';
import type { Command, Effect } from './effectTypes.ts';

type WebEffect = Extract<Effect, { type: 'web_search' | 'web_page_read' }>;

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
  const parsed = approval.payloadPreview
    ? (safeParse(approval.payloadPreview) as
        | { url?: unknown; options?: unknown }
        | undefined)
    : undefined;
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

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
