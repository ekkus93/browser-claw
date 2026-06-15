import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BrowserClawDB } from '../db/db.ts';
import { MemoryContentStore } from '../workspace/contentStore.ts';
import { WorkspaceFs } from '../workspace/workspaceFs.ts';
import { researchSlug, storeResearchBundle } from './storage.ts';
import type { ResearchBundle } from './types.ts';

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
