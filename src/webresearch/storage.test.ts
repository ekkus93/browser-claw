import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserClawDB } from '../db/db.ts';
import { MemoryContentStore } from '../workspace/contentStore.ts';
import { WorkspaceFs } from '../workspace/workspaceFs.ts';
import { researchSlug, storeResearchBundle } from './storage.ts';
import { createWebResearchService } from './service.ts';
import type { PageReadRequest, ResearchBundle } from './types.ts';

const db = new BrowserClawDB();
let fs: WorkspaceFs;

beforeEach(async () => {
  await db.open();
  await db.workspace_files.clear();
  fs = new WorkspaceFs({ db, content: new MemoryContentStore() });
});

afterEach(async () => {
  await db.workspace_files.clear();
});

describe('researchSlug', () => {
  it('produces a filesystem-safe slug', () => {
    expect(researchSlug('OPFS & SQLite WASM!')).toBe('opfs-sqlite-wasm');
    expect(researchSlug('   ')).toBe('research');
    expect(researchSlug('a'.repeat(100)).length).toBeLessThanOrEqual(60);
  });
});

// H2: search -> read page via mocked extension -> write workspace research bundle.
describe('web research flow (H2)', () => {
  it('search + read page via mocked reader + store bundle in workspace', async () => {
    const service = createWebResearchService({
      search: {
        search: vi.fn(async () => [
          { title: 'Article', url: 'https://example.com/article', rank: 1 },
        ]),
      },
      reader: {
        isAvailable: vi.fn(async () => true),
        readPage: vi.fn(async (req: PageReadRequest) => ({
          ok: true as const,
          url: req.url,
          finalUrl: req.url,
          text: 'Page body.',
          markdown: '# Article\nPage body.',
          length: 10,
        })),
        readPages: vi.fn(async () => []),
        readCurrentTab: vi.fn(async () => ({
          ok: false as const,
          url: '',
          error: { kind: 'internal_error' as const, message: '' },
        })),
      },
    });
    const bundle = await service.research('example query', { maxPages: 1 });
    expect(bundle.results).toHaveLength(1);
    expect(bundle.pages).toHaveLength(1);
    const stored = await storeResearchBundle(fs, bundle, () => 9999);
    expect(stored.pagePaths).toHaveLength(1);
    const content = await fs.readText(stored.pagePaths[0]!);
    expect(content).toContain('# Article');
    // The search-results.json includes the result URL.
    const results = await fs.readText(stored.resultsPath);
    expect(results).toContain('https://example.com/article');
  });

  it('extension missing (no reader) -> readPage throws reader_unavailable', async () => {
    const service = createWebResearchService({
      search: {
        search: vi.fn(async () => [{ title: 'A', url: 'https://example.com' }]),
      },
    });
    await expect(service.readPage('https://example.com')).rejects.toMatchObject(
      {
        kind: 'reader_unavailable',
      },
    );
  });

  it('host permission denied -> readPage throws page_read_failed', async () => {
    const service = createWebResearchService({
      search: {
        search: vi.fn(async () => []),
      },
      reader: {
        isAvailable: vi.fn(async () => true),
        readPage: vi.fn(async (req: PageReadRequest) => ({
          ok: false as const,
          url: req.url,
          error: {
            kind: 'permission_denied' as const,
            message: 'Host permission denied',
          },
        })),
        readPages: vi.fn(async () => []),
        readCurrentTab: vi.fn(async () => ({
          ok: false as const,
          url: '',
          error: { kind: 'internal_error' as const, message: '' },
        })),
      },
    });
    await expect(
      service.readPage('https://restricted.example.com/'),
    ).rejects.toMatchObject({ kind: 'page_read_failed' });
  });
});

describe('storeResearchBundle (E10)', () => {
  it('writes search results and one file per page under a safe path', async () => {
    const bundle: ResearchBundle = {
      query: 'OPFS persistence',
      results: [{ title: 'A', url: 'https://example.com/a' }],
      pages: [
        {
          url: 'https://example.com/a',
          finalUrl: 'https://example.com/a',
          title: 'A',
          text: 'plain',
          markdown: '# A\n\nbody',
          length: 6,
        },
      ],
      failures: [],
    };
    const stored = await storeResearchBundle(fs, bundle, () => 42);

    expect(stored.dir).toBe('/workspace/research/opfs-persistence-42');
    expect(await fs.readText(stored.resultsPath)).toContain(
      'https://example.com/a',
    );
    expect(stored.pagePaths).toHaveLength(1);
    expect(await fs.readText(stored.pagePaths[0]!)).toContain('# A');
    // Every written path is a valid workspace path (no throw on stat).
    expect((await fs.stat(stored.resultsPath)).kind).toBe('file');
  });
});
