import { describe, expect, it, vi } from 'vitest';
import { createWebResearchService } from './service.ts';
import {
  WebResearchError,
  type PageReaderProvider,
  type PageReadResult,
  type SearchProvider,
  type SearchResult,
} from './types.ts';

const searchProvider = (
  results: { title: string; url: string }[],
): SearchProvider => ({
  search: vi.fn(() => Promise.resolve(results)),
});

function readerWith(
  result: PageReadResult,
  available = true,
): PageReaderProvider {
  return {
    isAvailable: () => Promise.resolve(available),
    readPage: vi.fn(() => Promise.resolve(result)),
    readPages: vi.fn(() => Promise.resolve([result])),
    readCurrentTab: vi.fn(() => Promise.resolve(result)),
  };
}

const okPage: PageReadResult = {
  ok: true,
  url: 'https://x/a',
  finalUrl: 'https://x/a',
  title: 'A',
  text: 'hello',
  length: 5,
};

describe('WebResearchService facade (E1)', () => {
  it('delegates search to the provider', async () => {
    const svc = createWebResearchService({
      search: searchProvider([{ title: 'A', url: 'https://x/a' }]),
    });
    expect(await svc.search('q')).toEqual([{ title: 'A', url: 'https://x/a' }]);
  });

  it('fails closed when no search provider is configured', async () => {
    const svc = createWebResearchService({});
    await expect(svc.search('q')).rejects.toBeInstanceOf(WebResearchError);
  });

  it('reads a page and returns normalized content', async () => {
    const svc = createWebResearchService({ reader: readerWith(okPage) });
    const content = await svc.readPage('https://x/a');
    expect(content).toMatchObject({ title: 'A', text: 'hello', length: 5 });
    expect('ok' in content).toBe(false);
  });

  it('surfaces a page-read failure as a WebResearchError', async () => {
    const svc = createWebResearchService({
      reader: readerWith({
        ok: false,
        url: 'https://x/a',
        error: { kind: 'permission_denied', message: 'denied' },
      }),
    });
    await expect(svc.readPage('https://x/a')).rejects.toMatchObject({
      kind: 'page_read_failed',
    });
  });

  it('reports reader_unavailable when the reader is missing or unavailable', async () => {
    const svc = createWebResearchService({ reader: readerWith(okPage, false) });
    await expect(svc.readPage('https://x/a')).rejects.toMatchObject({
      kind: 'reader_unavailable',
    });
  });

  it('research() combines search + page reads into a bundle (capped at maxPages)', async () => {
    const reader = readerWith(okPage);
    const svc = createWebResearchService({
      search: searchProvider([
        { title: 'A', url: 'https://x/a' },
        { title: 'B', url: 'https://x/b' },
      ]),
      reader,
    });
    const bundle = await svc.research('q', { maxPages: 1 });
    expect(bundle.query).toBe('q');
    expect(bundle.results).toHaveLength(2);
    expect(bundle.pages).toHaveLength(1); // capped at maxPages
    expect(bundle.failures).toHaveLength(0);
  });
});

const failedPage: PageReadResult = {
  ok: false,
  url: 'https://x/a',
  error: { kind: 'permission_denied', message: 'denied' },
};

function twoResults(): SearchResult[] {
  return [
    { title: 'A', url: 'https://x/a' },
    { title: 'B', url: 'https://x/b' },
  ];
}

describe('D3 — research bundle includes failures', () => {
  it('D3: one failed page appears in failures array', async () => {
    // First URL fails, second succeeds.
    let call = 0;
    const reader: PageReaderProvider = {
      isAvailable: () => Promise.resolve(true),
      readPage: vi.fn(() => {
        call += 1;
        return Promise.resolve(call === 1 ? failedPage : okPage);
      }),
      readPages: vi.fn(),
      readCurrentTab: vi.fn(),
    };
    const svc = createWebResearchService({
      search: searchProvider(twoResults()),
      reader,
    });
    const bundle = await svc.research('q', { maxPages: 2 });
    expect(bundle.pages).toHaveLength(1);
    expect(bundle.failures).toHaveLength(1);
    expect(bundle.failures[0]?.url).toBe('https://x/a');
    expect(bundle.failures[0]?.message).toContain('denied');
  });

  it('D3: partial success reports both pages and failures', async () => {
    let call = 0;
    const reader: PageReaderProvider = {
      isAvailable: () => Promise.resolve(true),
      readPage: vi.fn(() => {
        call += 1;
        return Promise.resolve(call % 2 === 0 ? okPage : failedPage);
      }),
      readPages: vi.fn(),
      readCurrentTab: vi.fn(),
    };
    const threeResults: SearchResult[] = [
      { title: 'A', url: 'https://x/a' },
      { title: 'B', url: 'https://x/b' },
      { title: 'C', url: 'https://x/c' },
    ];
    const svc = createWebResearchService({
      search: searchProvider(threeResults),
      reader,
    });
    const bundle = await svc.research('q', { maxPages: 3 });
    expect(bundle.pages.length + bundle.failures.length).toBe(3);
    expect(bundle.pages.length).toBeGreaterThan(0);
    expect(bundle.failures.length).toBeGreaterThan(0);
  });

  it('D3: all failed page reads throws WebResearchError all_page_reads_failed', async () => {
    const reader = readerWith(failedPage);
    const svc = createWebResearchService({
      search: searchProvider(twoResults()),
      reader,
    });
    await expect(svc.research('q', { maxPages: 2 })).rejects.toMatchObject({
      kind: 'all_page_reads_failed',
    });
  });

  it('D3: successful research with no failures includes empty failures array', async () => {
    const svc = createWebResearchService({
      search: searchProvider([{ title: 'A', url: 'https://x/a' }]),
      reader: readerWith(okPage),
    });
    const bundle = await svc.research('q', { maxPages: 1 });
    expect(bundle.failures).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// C1 (FIX4): WebResearchService.readPages() delegates to provider batch method
// ---------------------------------------------------------------------------

describe('C1 — readPages uses provider batch readPages()', () => {
  it('C1: calls provider readPages() not individual readPage()', async () => {
    const reader: PageReaderProvider = {
      isAvailable: () => Promise.resolve(true),
      readPage: vi.fn(),
      readPages: vi.fn(() => Promise.resolve([okPage])),
      readCurrentTab: vi.fn(),
    };
    const svc = createWebResearchService({ reader });
    await svc.readPages(['https://x/a']);
    expect(reader.readPages).toHaveBeenCalledWith(
      expect.objectContaining({ urls: ['https://x/a'] }),
    );
    expect(reader.readPage).not.toHaveBeenCalled();
  });

  it('C1: per-slot failure from provider is preserved in bundle', async () => {
    const reader: PageReaderProvider = {
      isAvailable: () => Promise.resolve(true),
      readPage: vi.fn(),
      readPages: vi.fn(() =>
        Promise.resolve([
          okPage,
          {
            ok: false as const,
            url: 'https://x/b',
            error: { kind: 'permission_denied' as const, message: 'denied' },
          },
        ]),
      ),
      readCurrentTab: vi.fn(),
    };
    const svc = createWebResearchService({ reader });
    const bundle = await svc.readPages(['https://x/a', 'https://x/b']);
    expect(bundle.pages).toHaveLength(1);
    expect(bundle.failures).toHaveLength(1);
    expect(bundle.failures[0]?.url).toBe('https://x/b');
  });

  it('C1: all-page failure throws WebResearchError', async () => {
    const reader = readerWith({
      ok: false,
      url: 'https://x/a',
      error: { kind: 'timeout', message: 'timed out' },
    });
    const svc = createWebResearchService({ reader });
    await expect(svc.readPages(['https://x/a'])).rejects.toMatchObject({
      kind: 'all_page_reads_failed',
    });
  });

  it('C1: reader unavailable throws reader_unavailable', async () => {
    const svc = createWebResearchService({});
    await expect(svc.readPages(['https://x/a'])).rejects.toMatchObject({
      kind: 'reader_unavailable',
    });
  });
});
