import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BrowserClawDB } from '../db/db.ts';
import { MemoryContentStore } from './contentStore.ts';
import {
  WorkspaceFs,
  WorkspaceNotFoundError,
  WorkspacePathConflictError,
} from './workspaceFs.ts';

const db = new BrowserClawDB();
let content: MemoryContentStore;
let fs: WorkspaceFs;
let seq: number;

beforeEach(async () => {
  await db.open();
  await db.workspace_files.clear();
  content = new MemoryContentStore();
  seq = 0;
  fs = new WorkspaceFs({
    db,
    content,
    now: () => 1000,
    newId: () => `id-${seq++}`,
  });
});

afterEach(async () => {
  await db.workspace_files.clear();
});

describe('WorkspaceFs CRUD (B3)', () => {
  it('creates, reads, updates, and deletes a file', async () => {
    const created = await fs.createFile('/workspace/notes/a.md', 'hello');
    expect(created).toMatchObject({
      path: '/workspace/notes/a.md',
      kind: 'file',
      sizeBytes: 5,
    });
    expect(created.checksum).toMatch(/^[0-9a-f]{64}$/);

    expect(await fs.readText('/workspace/notes/a.md')).toBe('hello');

    const updated = await fs.updateFile('/workspace/notes/a.md', 'goodbye!');
    expect(updated.sizeBytes).toBe(8);
    expect(await fs.readText('/workspace/notes/a.md')).toBe('goodbye!');

    await fs.deleteFile('/workspace/notes/a.md');
    await expect(fs.readText('/workspace/notes/a.md')).rejects.toBeInstanceOf(
      WorkspaceNotFoundError,
    );
    expect(await content.has('id-0')).toBe(false);
  });

  it('createFile refuses to overwrite without the overwrite flag', async () => {
    await fs.createFile('/workspace/notes/a.md', 'one');
    await expect(
      fs.createFile('/workspace/notes/a.md', 'two'),
    ).rejects.toBeInstanceOf(WorkspacePathConflictError);
    // The original content is intact.
    expect(await fs.readText('/workspace/notes/a.md')).toBe('one');
  });

  it('appends to a file (creating it if absent)', async () => {
    await fs.appendFile('/workspace/notes/log.txt', 'a');
    await fs.appendFile('/workspace/notes/log.txt', 'b');
    const stat = await fs.appendFile('/workspace/notes/log.txt', 'c');
    expect(await fs.readText('/workspace/notes/log.txt')).toBe('abc');
    expect(stat.sizeBytes).toBe(3);
  });

  it('mkdir is idempotent and listDir returns immediate children only', async () => {
    await fs.mkdir('/workspace/proj');
    await fs.mkdir('/workspace/proj'); // no throw
    await fs.createFile('/workspace/proj/a.txt', 'a');
    await fs.createFile('/workspace/proj/b.txt', 'b');
    await fs.createFile('/workspace/proj/sub/c.txt', 'c');

    const entries = await fs.listDir('/workspace/proj');
    expect(entries.map((e) => e.path)).toEqual([
      '/workspace/proj/a.txt',
      '/workspace/proj/b.txt',
    ]);
  });

  it('stat throws for a missing path and returns metadata otherwise', async () => {
    await expect(fs.stat('/workspace/nope.txt')).rejects.toBeInstanceOf(
      WorkspaceNotFoundError,
    );
    await fs.createFile('/workspace/x.txt', 'x');
    expect((await fs.stat('/workspace/x.txt')).kind).toBe('file');
  });

  it('moves a file, keeping its content id, and frees the old path', async () => {
    const created = await fs.createFile('/workspace/a.txt', 'data');
    const moved = await fs.moveFile('/workspace/a.txt', '/workspace/b.txt');
    expect(moved.id).toBe(created.id); // same content id
    expect(await fs.readText('/workspace/b.txt')).toBe('data');
    expect(await fs.exists('/workspace/a.txt')).toBe(false);
  });

  it('copies a file to a new independent content id', async () => {
    const created = await fs.createFile('/workspace/a.txt', 'data');
    const copy = await fs.copyFile('/workspace/a.txt', '/workspace/c.txt');
    expect(copy.id).not.toBe(created.id);
    expect(await fs.readText('/workspace/c.txt')).toBe('data');
    // Editing the copy does not affect the original.
    await fs.updateFile('/workspace/c.txt', 'changed');
    expect(await fs.readText('/workspace/a.txt')).toBe('data');
  });

  it('move/copy refuse to clobber an existing destination', async () => {
    await fs.createFile('/workspace/a.txt', 'a');
    await fs.createFile('/workspace/b.txt', 'b');
    await expect(
      fs.moveFile('/workspace/a.txt', '/workspace/b.txt'),
    ).rejects.toBeInstanceOf(WorkspacePathConflictError);
    await expect(
      fs.copyFile('/workspace/a.txt', '/workspace/b.txt'),
    ).rejects.toBeInstanceOf(WorkspacePathConflictError);
  });

  it('rejects an unsafe path before any storage write', async () => {
    await expect(fs.createFile('/workspace/../escape', 'x')).rejects.toThrow(
      /invalid workspace path/i,
    );
    expect(await db.workspace_files.count()).toBe(0);
  });

  it('a failed content write leaves no metadata row', async () => {
    const failing = new MemoryContentStore();
    failing.write = () => Promise.reject(new Error('disk full'));
    const fs2 = new WorkspaceFs({ db, content: failing, now: () => 1 });
    await expect(fs2.createFile('/workspace/x.txt', 'x')).rejects.toThrow(
      /disk full/,
    );
    expect(await db.workspace_files.count()).toBe(0);
  });
});

describe('WorkspaceFs range reads (B4)', () => {
  it('reads a character range without splitting a multibyte char', async () => {
    // 'a' + emoji (astral, surrogate pair) + 'b'
    await fs.createFile('/workspace/u.txt', 'a😀b');
    expect(await fs.readTextRange('/workspace/u.txt', 0, 2)).toBe('a😀');
    expect(await fs.readTextRange('/workspace/u.txt', 1, 1)).toBe('😀');
    expect(await fs.readTextRange('/workspace/u.txt', 1, 2)).toBe('😀b');
  });

  it('rejects an oversized or negative range', async () => {
    await fs.createFile('/workspace/r.txt', 'data');
    await expect(
      fs.readTextRange('/workspace/r.txt', 0, 1_000_000),
    ).rejects.toThrow(/limit/i);
    await expect(fs.readTextRange('/workspace/r.txt', -1, 1)).rejects.toThrow(
      /non-negative/i,
    );
  });

  it('reads a 1-based line range as a snippet', async () => {
    await fs.createFile('/workspace/l.txt', 'l1\nl2\nl3\nl4\nl5');
    const snip = await fs.readLines('/workspace/l.txt', 2, 2);
    expect(snip.lines).toEqual(['l2', 'l3']);
    expect(snip.startLine).toBe(2);
    expect(snip.endLine).toBe(3);
    expect(snip.text).toBe('l2\nl3');
  });

  it('rejects an invalid line range', async () => {
    await fs.createFile('/workspace/l.txt', 'a\nb');
    await expect(fs.readLines('/workspace/l.txt', 0, 1)).rejects.toThrow(
      /1-based/i,
    );
    await expect(fs.readLines('/workspace/l.txt', 1, 999_999)).rejects.toThrow(
      /limit/i,
    );
  });
});
