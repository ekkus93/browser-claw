import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserClawDB } from '../db/db.ts';
import { MemoryContentStore } from '../workspace/contentStore.ts';
import { WorkspaceFs } from '../workspace/workspaceFs.ts';
import { executePlanOp, PlanOpError, type PlanOpContext } from './planOps.ts';

const db = new BrowserClawDB();
const dispatch = vi.fn();
let ctx: PlanOpContext;

beforeEach(async () => {
  await db.open();
  await db.workspace_files.clear();
  await db.memories.clear();
  ctx = {
    fs: new WorkspaceFs({ db, content: new MemoryContentStore() }),
    db,
    dispatch,
  };
});

afterEach(async () => {
  await db.workspace_files.clear();
  await db.memories.clear();
});

describe('executePlanOp — fs ops (C2)', () => {
  it('writes, reads, lists, and deletes via the workspace', async () => {
    await executePlanOp(ctx, 'fs.writeText', {
      path: '/workspace/a.md',
      content: 'hello',
    });
    expect(
      await executePlanOp(ctx, 'fs.readText', { path: '/workspace/a.md' }),
    ).toBe('hello');
    const list = (await executePlanOp(ctx, 'fs.list', {
      path: '/workspace',
    })) as { path: string }[];
    expect(list.map((f) => f.path)).toContain('/workspace/a.md');
    await executePlanOp(ctx, 'fs.delete', { path: '/workspace/a.md' });
    await expect(
      executePlanOp(ctx, 'fs.readText', { path: '/workspace/a.md' }),
    ).rejects.toThrow();
  });

  it('appends and greps', async () => {
    await executePlanOp(ctx, 'fs.writeText', {
      path: '/workspace/log.txt',
      content: 'one\n',
    });
    await executePlanOp(ctx, 'fs.appendText', {
      path: '/workspace/log.txt',
      content: 'two',
    });
    const hits = (await executePlanOp(ctx, 'fs.grep', {
      pattern: 'two',
    })) as { line: number }[];
    expect(hits).toHaveLength(1);
  });
});

describe('executePlanOp — memory ops (C2)', () => {
  it('creates and searches memories', async () => {
    await executePlanOp(ctx, 'memory.create', {
      title: 'Rust',
      text: 'ownership basics',
      tags: ['rust'],
    });
    const byText = (await executePlanOp(ctx, 'memory.search', {
      query: 'ownership',
    })) as unknown[];
    expect(byText).toHaveLength(1);
    const byTag = (await executePlanOp(ctx, 'memory.search', {
      tag: 'rust',
    })) as unknown[];
    expect(byTag).toHaveLength(1);
  });
});

describe('executePlanOp — tool.call + web (C2)', () => {
  it('calls a permitted tool through the permission model', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(new Response('<p>hi</p>')),
    ) as unknown as typeof fetch;
    const out = await executePlanOp(
      { ...ctx, allowedTools: ['Page Reader'], toolCtx: { fetchImpl } },
      'tool.call',
      { tool: 'Page Reader', args: { url: 'https://example.com' } },
    );
    expect(out).toBe('hi');
  });

  it('refuses a tool the plan did not allow', async () => {
    await expect(
      executePlanOp(ctx, 'tool.call', {
        tool: 'Page Reader',
        args: { url: 'https://example.com' },
      }),
    ).rejects.toThrow();
  });

  it('web ops throw when no web-research service is configured (not faked)', async () => {
    await expect(
      executePlanOp(ctx, 'web.search', { query: 'x' }),
    ).rejects.toBeInstanceOf(PlanOpError);
  });

  it('web ops delegate to a configured web-research service (E10)', async () => {
    const web = {
      search: vi.fn(() =>
        Promise.resolve([{ title: 'A', url: 'https://x/a' }]),
      ),
      readPage: vi.fn(() =>
        Promise.resolve({
          url: 'https://x/a',
          finalUrl: 'https://x/a',
          text: 'body',
          length: 4,
        }),
      ),
      readPages: vi.fn(() =>
        Promise.resolve({
          query: '',
          results: [],
          pages: [
            {
              url: 'https://x/a',
              finalUrl: 'https://x/a',
              text: 'body',
              length: 4,
            },
          ],
          failures: [],
        }),
      ),
      research: vi.fn(),
    };
    const withWeb = { ...ctx, web };
    expect(await executePlanOp(withWeb, 'web.search', { query: 'q' })).toEqual([
      { title: 'A', url: 'https://x/a' },
    ]);
    expect(
      await executePlanOp(withWeb, 'web.readPage', { url: 'https://x/a' }),
    ).toMatchObject({ text: 'body' });
    const pages = (await executePlanOp(withWeb, 'web.readPages', {
      urls: ['https://x/a', 'https://x/b'],
      maxPages: 1,
    })) as unknown[];
    expect(pages).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// H2 — Grep policy in plan executor
// ---------------------------------------------------------------------------

describe('H2 — grep policy in plan executor', () => {
  beforeEach(async () => {
    await ctx.fs.createFile(
      '/workspace/code.ts',
      'const x = 1;\nconst y = 2;',
      { overwrite: true, actor: 'user' },
    );
  });

  it('H2: literal grep works by default', async () => {
    const results = await executePlanOp(ctx, 'fs.grep', { pattern: 'const' });
    expect(Array.isArray(results)).toBe(true);
    expect((results as unknown[]).length).toBeGreaterThan(0);
  });

  it('H2: regex grep denied without capability', async () => {
    await expect(
      executePlanOp(ctx, 'fs.grep', { pattern: '(const|let)', isRegex: true }),
    ).rejects.toThrow(/Regex grep/);
  });

  it('H2: excessive pattern length rejected', async () => {
    await expect(
      executePlanOp(ctx, 'fs.grep', { pattern: 'x'.repeat(201) }),
    ).rejects.toThrow(/too large/);
  });
});

describe('G1 — plan memory.search excludes sensitive memories', () => {
  it('G1: sensitive memory not returned from plan memory.search', async () => {
    await ctx.db.memories.put({
      id: 'ms1',
      title: 'Normal',
      text: 'okay',
      tags: [],
      source: 'user',
      createdBy: 'user',
      createdAt: Date.now(),
      pinned: false,
      sensitivity: 'normal',
    });
    await ctx.db.memories.put({
      id: 'ms2',
      title: 'Secret',
      text: 'private data',
      tags: [],
      source: 'user',
      createdBy: 'user',
      createdAt: Date.now(),
      pinned: false,
      sensitivity: 'sensitive',
    });
    const result = await executePlanOp(ctx, 'memory.search', {});
    const ids = (result as { id: string }[]).map((r) => r.id);
    expect(ids).toContain('ms1');
    expect(ids).not.toContain('ms2');
  });

  it('G1: normal memory is returned from plan memory.search', async () => {
    await ctx.db.memories.put({
      id: 'mn1',
      title: 'Normal',
      text: 'fine',
      tags: [],
      source: 'user',
      createdBy: 'user',
      createdAt: Date.now(),
      pinned: false,
      sensitivity: 'normal',
    });
    const result = await executePlanOp(ctx, 'memory.search', {});
    const ids = (result as { id: string }[]).map((r) => r.id);
    expect(ids).toContain('mn1');
  });
});

describe('F3 — plan tool.call fail-closed args validation', () => {
  it('F3: plan tool.call with array args throws PlanOpError', async () => {
    await expect(
      executePlanOp(ctx, 'tool.call', { tool: 'Page Reader', args: [1, 2, 3] }),
    ).rejects.toBeInstanceOf(PlanOpError);
  });

  it('F3: plan tool.call with string args throws PlanOpError', async () => {
    await expect(
      executePlanOp(ctx, 'tool.call', { tool: 'Page Reader', args: 'bad' }),
    ).rejects.toBeInstanceOf(PlanOpError);
  });

  it('F3: plan tool.call with number args throws PlanOpError', async () => {
    await expect(
      executePlanOp(ctx, 'tool.call', { tool: 'Page Reader', args: 42 }),
    ).rejects.toBeInstanceOf(PlanOpError);
  });

  it('F3: plan tool.call with undefined args does not throw (no-arg tool path)', async () => {
    await expect(
      executePlanOp(ctx, 'tool.call', { tool: 'Page Reader' }),
    ).rejects.toThrow();
  });
});
