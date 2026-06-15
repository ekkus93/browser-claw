import { describe, expect, it, vi } from 'vitest';
import { createWebResearchService } from './service.ts';
import {
  WebResearchError,
  type PageReaderProvider,
  type PageReadResult,
  type SearchProvider,
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

  it('research() combines search + page reads into a bundle, skipping failures', async () => {
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
  });
});
