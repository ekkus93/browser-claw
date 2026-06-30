/**
 * WebResearchService facade (Part E1): combines a SearchProvider and a
 * PageReaderProvider into search / readPage / research. Failures are surfaced as
 * {@link WebResearchError} — never a silent empty result. A missing provider is
 * an explicit "unavailable" error (fail closed).
 */

import {
  WebResearchError,
  type PageContent,
  type PageReadFailure,
  type PageReaderProvider,
  type PageReadRequest,
  type ResearchBundle,
  type ResearchOptions,
  type SearchOptions,
  type SearchProvider,
  type SearchResult,
  type WebResearchService,
} from './types.ts';
import {
  MAX_BATCH_PAGE_READS,
  normalizeOptionalPositiveIntegerLimit,
} from './limits.ts';

export interface WebResearchDeps {
  search?: SearchProvider;
  reader?: PageReaderProvider;
}

export function createWebResearchService(
  deps: WebResearchDeps,
): WebResearchService {
  async function search(
    query: string,
    options?: SearchOptions,
  ): Promise<SearchResult[]> {
    if (!deps.search) {
      throw new WebResearchError(
        'search_unavailable',
        'No search provider is configured.',
      );
    }
    try {
      return await deps.search.search(query, options);
    } catch (error) {
      throw new WebResearchError(
        'search_failed',
        error instanceof Error ? error.message : 'Search failed.',
      );
    }
  }

  async function readPage(
    url: string,
    options?: PageReadRequest,
  ): Promise<PageContent> {
    const reader = deps.reader;
    if (!reader || !(await reader.isAvailable())) {
      throw new WebResearchError(
        'reader_unavailable',
        'No page reader is available (install the BrowserClaw extension).',
      );
    }
    const result = await reader.readPage({ ...options, url });
    if (!result.ok) {
      throw new WebResearchError(
        'page_read_failed',
        `Could not read ${url}: ${result.error.kind} — ${result.error.message}`,
      );
    }
    // Drop the `ok` discriminant, returning just the PageContent.
    const content: PageContent & { ok?: boolean } = { ...result };
    delete content.ok;
    return content;
  }

  async function research(
    query: string,
    options: ResearchOptions = {},
  ): Promise<ResearchBundle> {
    // B3 (FIX7): validate maxPages before using it to slice results.
    const effectiveMaxPages = normalizeOptionalPositiveIntegerLimit(
      options.maxPages,
      'maxPages',
      { max: MAX_BATCH_PAGE_READS },
    );
    const results = await search(query, options);
    const maxPages = effectiveMaxPages ?? 3;
    const pages: PageContent[] = [];
    const failures: PageReadFailure[] = [];
    for (const result of results.slice(0, maxPages)) {
      try {
        pages.push(
          await readPage(result.url, {
            url: result.url,
            ...(options.maxChars ? { maxChars: options.maxChars } : {}),
          }),
        );
      } catch (err) {
        failures.push({
          url: result.url,
          kind: 'internal_error',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
    if (pages.length === 0 && failures.length > 0) {
      throw new WebResearchError(
        'all_page_reads_failed',
        `All ${String(failures.length)} result page(s) failed to read.`,
      );
    }
    return { query, results, pages, failures };
  }

  async function readPages(
    urls: string[],
    options: ResearchOptions = {},
  ): Promise<ResearchBundle> {
    if (urls.length === 0) {
      throw new WebResearchError(
        'page_read_failed',
        'readPages requires at least one URL.',
      );
    }

    const reader = deps.reader;
    if (!reader || !(await reader.isAvailable())) {
      throw new WebResearchError(
        'reader_unavailable',
        'No page reader is available (install the BrowserClaw extension).',
      );
    }

    // B3 (FIX7): validate maxPages before forwarding to provider.
    const effectiveMaxPages = normalizeOptionalPositiveIntegerLimit(
      options.maxPages,
      'maxPages',
      { max: MAX_BATCH_PAGE_READS },
    );

    // C1 (FIX4): delegate to provider batch readPages() when available so the
    // extension's single read_pages message is used rather than N sequential
    // read_page calls. Sequential fallback is explicit and noted.
    const batchResults = await reader.readPages({
      urls,
      ...(effectiveMaxPages !== undefined
        ? { maxPages: effectiveMaxPages }
        : {}),
      ...(options.maxChars !== undefined ? { maxChars: options.maxChars } : {}),
    });

    const pages: PageContent[] = [];
    const failures: PageReadFailure[] = [];

    for (const result of batchResults) {
      if (result.ok) {
        const content: PageContent & { ok?: boolean } = { ...result };
        delete content.ok;
        pages.push(content);
      } else {
        failures.push({
          url: result.url,
          kind: result.error.kind,
          message: result.error.message,
        });
      }
    }

    if (pages.length === 0 && failures.length > 0) {
      throw new WebResearchError(
        'all_page_reads_failed',
        `All ${String(failures.length)} page(s) failed to read.`,
      );
    }
    return { query: '', results: [], pages, failures };
  }

  return { search, readPage, readPages, research };
}
