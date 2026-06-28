/**
 * Web research provider model (Part E1, spec §5.2). Two independent provider
 * roles — a {@link SearchProvider} that finds result URLs and a
 * {@link PageReaderProvider} that reads page content (extension-backed in v0.1)
 * — combined by a {@link WebResearchService} facade. No network happens here;
 * these are the interfaces + data shapes the providers and facade share.
 */

export type ReadFormat = 'text' | 'markdown';

export interface SearchOptions {
  maxResults?: number;
  /** Optional site/domain restriction passed through to the provider. */
  site?: string;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet?: string;
  /** 1-based rank in the result list. */
  rank?: number;
}

export interface PageReadRequest {
  url: string;
  format?: ReadFormat;
  maxChars?: number;
  timeoutMs?: number;
}

export interface PageReadPagesRequest {
  urls: string[];
  format?: ReadFormat;
  maxChars?: number;
  timeoutMs?: number;
  maxPages?: number;
}

export interface CurrentTabReadRequest {
  format?: ReadFormat;
  maxChars?: number;
}

/** The readable content extracted from a page (the success shape). */
export interface PageContent {
  url: string;
  finalUrl: string;
  title?: string;
  byline?: string;
  siteName?: string;
  text: string;
  markdown?: string;
  excerpt?: string;
  length: number;
}

export type PageReadErrorKind =
  | 'permission_denied'
  | 'timeout'
  | 'navigation_failed'
  | 'extraction_failed'
  | 'unsupported_url'
  | 'extension_missing'
  | 'internal_error';

export interface PageReadError {
  kind: PageReadErrorKind;
  message: string;
  retryable?: boolean;
}

/** A page-read result: the content on success, or a structured error. */
export type PageReadResult =
  | ({ ok: true } & PageContent)
  | { ok: false; url: string; error: PageReadError };

/** One failed page-read within a research run. */
export interface PageReadFailure {
  url: string;
  kind: PageReadErrorKind;
  message: string;
}

/** A stored research run: the query, its results, pages read, and any page failures. */
export interface ResearchBundle {
  query: string;
  results: SearchResult[];
  pages: PageContent[];
  /** Page reads that failed (non-empty when some URLs could not be read). */
  failures: PageReadFailure[];
  summary?: string;
}

export interface ResearchOptions extends SearchOptions {
  maxPages?: number;
  format?: ReadFormat;
  maxChars?: number;
}

export type WebResearchErrorKind =
  | 'search_unavailable'
  | 'search_failed'
  | 'reader_unavailable'
  | 'page_read_failed'
  | 'all_page_reads_failed';

export class WebResearchError extends Error {
  readonly kind: WebResearchErrorKind;
  constructor(kind: WebResearchErrorKind, message: string) {
    super(message);
    this.name = 'WebResearchError';
    this.kind = kind;
  }
}

export interface SearchProvider {
  search(query: string, options?: SearchOptions): Promise<SearchResult[]>;
}

export interface PageReaderProvider {
  isAvailable(): Promise<boolean>;
  readPage(request: PageReadRequest): Promise<PageReadResult>;
  readPages(request: PageReadPagesRequest): Promise<PageReadResult[]>;
  readCurrentTab(request: CurrentTabReadRequest): Promise<PageReadResult>;
}

export interface WebResearchService {
  search(query: string, options?: SearchOptions): Promise<SearchResult[]>;
  readPage(url: string, options?: PageReadRequest): Promise<PageContent>;
  research(query: string, options?: ResearchOptions): Promise<ResearchBundle>;
}
