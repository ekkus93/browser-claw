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
