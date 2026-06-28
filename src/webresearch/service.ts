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
    const results = await search(query, options);
    const maxPages = options.maxPages ?? 3;
    const pages: PageContent[] = [];
    const failures: PageReadFailure[] = [];
    for (const result of results.slice(0, maxPages)) {
      try {
        pages.push(
          await readPage(result.url, {
            url: result.url,
            ...(options.format ? { format: options.format } : {}),
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
    const pages: PageContent[] = [];
    const failures: PageReadFailure[] = [];
    for (const url of urls) {
      try {
        pages.push(
          await readPage(url, {
            url,
            ...(options.format ? { format: options.format } : {}),
            ...(options.maxChars ? { maxChars: options.maxChars } : {}),
          }),
        );
      } catch (err) {
        failures.push({
          url,
          kind: 'internal_error',
          message: err instanceof Error ? err.message : String(err),
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
