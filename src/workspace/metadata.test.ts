import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { BrowserClawDB } from '../db/db.ts';
import type { WorkspaceFileMeta } from './types.ts';

const db = new BrowserClawDB();

afterEach(async () => {
  await db.open();
  await db.workspace_files.clear();
});

describe('workspace_files metadata table (B1)', () => {
  function meta(over: Partial<WorkspaceFileMeta> = {}): WorkspaceFileMeta {
    return {
      id: 'f1',
      path: '/workspace/notes/a.md',
      kind: 'file',
      sizeBytes: 12,
      createdAt: 1,
      updatedAt: 1,
      createdBy: 'agent',
      ...over,
    };
  }

  it('stores and reads a metadata row', async () => {
    await db.open();
    await db.workspace_files.put(meta());
    const row = await db.workspace_files.get('f1');
    expect(row).toMatchObject({ path: '/workspace/notes/a.md', kind: 'file' });
  });

  it('looks a file up by its unique path index', async () => {
    await db.open();
    await db.workspace_files.put(meta());
    const byPath = await db.workspace_files
      .where('path')
      .equals('/workspace/notes/a.md')
      .first();
    expect(byPath?.id).toBe('f1');
  });

  it('enforces a unique path (&path index)', async () => {
    await db.open();
    await db.workspace_files.put(meta());
    await expect(db.workspace_files.add(meta({ id: 'f2' }))).rejects.toThrow();
  });

  it('queries by the multi-entry tags index', async () => {
    await db.open();
    await db.workspace_files.put(meta({ tags: ['research', 'opfs'] }));
    const tagged = await db.workspace_files
      .where('tags')
      .equals('opfs')
      .toArray();
    expect(tagged.map((r) => r.id)).toEqual(['f1']);
  });
});
