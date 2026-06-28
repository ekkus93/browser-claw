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

describe('WorkspaceFs search + grep (B5)', () => {
  it('searches by path, extension, tag, and content', async () => {
    await fs.createFile('/workspace/notes/todo.md', 'buy milk', {
      tags: ['home'],
    });
    await fs.createFile('/workspace/notes/plan.txt', 'ship the feature');
    await fs.createFile(
      '/workspace/research/opfs.md',
      'OPFS persistence notes',
    );

    expect((await fs.search({ pathContains: 'notes' })).length).toBe(2);
    expect((await fs.search({ extension: 'md' })).map((r) => r.path)).toEqual([
      '/workspace/notes/todo.md',
      '/workspace/research/opfs.md',
    ]);
    expect((await fs.search({ tag: 'home' })).map((r) => r.path)).toEqual([
      '/workspace/notes/todo.md',
    ]);
    const byText = await fs.search({ textContains: 'persistence' });
    expect(byText.map((r) => r.path)).toEqual(['/workspace/research/opfs.md']);
    expect(byText[0]?.snippet).toContain('persistence');
  });

  it('content search reflects updates and deletions (no stale index)', async () => {
    await fs.createFile('/workspace/a.md', 'alpha');
    expect((await fs.search({ textContains: 'alpha' })).length).toBe(1);
    await fs.updateFile('/workspace/a.md', 'beta');
    expect((await fs.search({ textContains: 'alpha' })).length).toBe(0);
    expect((await fs.search({ textContains: 'beta' })).length).toBe(1);
    await fs.deleteFile('/workspace/a.md');
    expect((await fs.search({ textContains: 'beta' })).length).toBe(0);
  });

  it('greps a subtree, returning line numbers and context', async () => {
    await fs.createFile('/workspace/src/a.txt', 'one\nTWO\nthree');
    await fs.createFile('/workspace/src/b.txt', 'no match here');
    await fs.createFile('/workspace/other/c.txt', 'two');

    const hits = await fs.grep({
      pattern: 'two',
      path: '/workspace/src',
      ignoreCase: true,
      contextLines: 1,
    });
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      path: '/workspace/src/a.txt',
      line: 2,
      text: 'TWO',
    });
    expect(hits[0]?.context).toEqual(['one', 'TWO', 'three']);
  });

  it('treats the pattern literally unless isRegex is set', async () => {
    await fs.createFile('/workspace/r.txt', 'a.b\naxb');
    // Literal '.' matches only the first line.
    expect((await fs.grep({ pattern: 'a.b' })).map((h) => h.line)).toEqual([1]);
    // As a regex, '.' matches any char -> both lines.
    expect(
      (await fs.grep({ pattern: 'a.b', isRegex: true })).map((h) => h.line),
    ).toEqual([1, 2]);
  });

  it('skips binary files in content search/grep', async () => {
    await fs.createFile(
      '/workspace/bin.dat',
      new Uint8Array([0x68, 0x00, 0x69]),
    );
    await fs.createFile('/workspace/txt.txt', 'hi');
    expect((await fs.grep({ pattern: 'hi' })).map((h) => h.path)).toEqual([
      '/workspace/txt.txt',
    ]);
  });

  it('throws on an invalid regex pattern', async () => {
    await fs.createFile('/workspace/x.txt', 'x');
    await expect(fs.grep({ pattern: '(', isRegex: true })).rejects.toThrow(
      /invalid pattern/i,
    );
  });
});

// ---------------------------------------------------------------------------
// I1 — max file size guards for range/line reads
// ---------------------------------------------------------------------------

import {
  MAX_FULL_TEXT_DECODE_BYTES,
  WorkspaceFileTooLargeError,
} from './workspaceFs.ts';

describe('I1 — readTextRange and readLines large-file guards', () => {
  it('I1: small file range read works', async () => {
    await fs.createFile('/workspace/small.txt', 'hello world', {
      overwrite: true,
      actor: 'user',
    });
    const result = await fs.readTextRange('/workspace/small.txt', 0, 5);
    expect(result).toBe('hello');
  });

  it('I1: small file line read works', async () => {
    await fs.createFile('/workspace/lines.txt', 'line1\nline2\nline3', {
      overwrite: true,
      actor: 'user',
    });
    const snip = await fs.readLines('/workspace/lines.txt', 2, 1);
    expect(snip.lines[0]).toBe('line2');
  });

  it('I1: oversized file rejects readTextRange with WorkspaceFileTooLargeError', async () => {
    // Write exactly MAX_FULL_TEXT_DECODE_BYTES + 1 bytes.
    const oversized = new Uint8Array(MAX_FULL_TEXT_DECODE_BYTES + 1).fill(65); // 'A'
    await fs.createFile('/workspace/big.txt', oversized, {
      overwrite: true,
      actor: 'user',
    });
    await expect(fs.readTextRange('/workspace/big.txt', 0, 10)).rejects.toThrow(
      WorkspaceFileTooLargeError,
    );
  });

  it('I1: oversized file rejects readLines with WorkspaceFileTooLargeError', async () => {
    const oversized = new Uint8Array(MAX_FULL_TEXT_DECODE_BYTES + 1).fill(65);
    await fs.createFile('/workspace/biglines.txt', oversized, {
      overwrite: true,
      actor: 'user',
    });
    await expect(fs.readLines('/workspace/biglines.txt', 1, 1)).rejects.toThrow(
      WorkspaceFileTooLargeError,
    );
  });

  it('I1: unicode file within limit is read correctly', async () => {
    await fs.createFile('/workspace/uni.txt', 'a😀b', {
      overwrite: true,
      actor: 'user',
    });
    expect(await fs.readTextRange('/workspace/uni.txt', 0, 3)).toBe('a😀b');
  });
});
