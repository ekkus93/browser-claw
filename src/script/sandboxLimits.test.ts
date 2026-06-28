import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserClawDB } from '../db/db.ts';
import { MemoryContentStore } from '../workspace/contentStore.ts';
import { WorkspaceFs } from '../workspace/workspaceFs.ts';
import {
  runSandboxWithLimits,
  type SandboxCapabilityContext,
} from './sandboxCapabilities.ts';
import type { ScriptLimits } from './scriptRequest.ts';

const db = new BrowserClawDB();
const dispatch = vi.fn();
let fs: WorkspaceFs;
let ctx: SandboxCapabilityContext;

const LIMITS: ScriptLimits = {
  timeoutMs: 1000,
  maxOutputBytes: 1_000_000,
  maxFileReads: 100,
  maxFileWrites: 100,
};

beforeEach(async () => {
  await db.open();
  await db.workspace_files.clear();
  fs = new WorkspaceFs({ db, content: new MemoryContentStore() });
  ctx = { fs, db, dispatch };
});

afterEach(async () => {
  await db.workspace_files.clear();
});

describe('runSandboxWithLimits (D5)', () => {
  it('times out an infinite loop', async () => {
    let t = 0;
    const now = () => {
      t += 10;
      return t;
    };
    const result = await runSandboxWithLimits(ctx, 'while (true) {}', {
      capabilities: {},
      limits: { ...LIMITS, timeoutMs: 50 },
      now,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorKind).toBe('timeout');
  });

  it('cancels via an aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await runSandboxWithLimits(ctx, 'while (true) {}', {
      capabilities: {},
      limits: LIMITS,
      signal: controller.signal,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorKind).toBe('cancelled');
  });

  it('rejects an over-budget return value', async () => {
    const result = await runSandboxWithLimits(ctx, 'return "x".repeat(1000);', {
      capabilities: {},
      limits: { ...LIMITS, maxOutputBytes: 50 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorKind).toBe('limit_exceeded');
      expect(result.error).toMatch(/maxOutputBytes/);
    }
  });

  it('rejects too many file reads', async () => {
    await fs.createFile('/workspace/a.md', 'hello', { actor: 'user' });
    const result = await runSandboxWithLimits(
      ctx,
      `for (let i = 0; i < 5; i++) { await fs.readText("/workspace/a.md"); }
       return "done";`,
      {
        capabilities: { fsRead: ['/workspace/**'] },
        limits: { ...LIMITS, maxFileReads: 2 },
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorKind).toBe('limit_exceeded');
      expect(result.error).toMatch(/maxFileReads/);
    }
  });

  it('rejects too many file writes', async () => {
    const result = await runSandboxWithLimits(
      ctx,
      `await fs.writeText("/workspace/a.md", "one");
       await fs.writeText("/workspace/b.md", "two");
       return "done";`,
      {
        capabilities: { fsWrite: ['/workspace/**'] },
        limits: { ...LIMITS, maxFileWrites: 1 },
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/maxFileWrites/);
    // Only the first write committed.
    expect(await fs.readText('/workspace/a.md')).toBe('one');
    await expect(fs.readText('/workspace/b.md')).rejects.toThrow();
  });

  it('rejects too many web page reads', async () => {
    const web = {
      search: vi.fn(),
      readPage: vi.fn(() =>
        Promise.resolve({
          url: 'https://x/a',
          finalUrl: 'https://x/a',
          text: 'b',
          length: 1,
        }),
      ),
      readPages: vi.fn(() =>
        Promise.resolve({ query: '', results: [], pages: [], failures: [] }),
      ),
      research: vi.fn(),
    };
    const result = await runSandboxWithLimits(
      { ...ctx, web },
      `await web.readPage("https://x/a"); await web.readPage("https://x/b");
       return "done";`,
      {
        capabilities: { webRead: ['https://x/**'] },
        limits: { ...LIMITS, maxPagesRead: 1 },
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/maxPagesRead/);
  });

  it('caps log output and collects logs', async () => {
    const within = await runSandboxWithLimits(
      ctx,
      'console.log("hello"); return 1;',
      { capabilities: {}, limits: { ...LIMITS, maxLogBytes: 100 } },
    );
    expect(within).toMatchObject({ ok: true, value: 1, logs: ['hello'] });

    const over = await runSandboxWithLimits(
      ctx,
      'console.log("x".repeat(200)); return 1;',
      { capabilities: {}, limits: { ...LIMITS, maxLogBytes: 10 } },
    );
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.error).toMatch(/maxLogBytes/);
  });

  it('runs a within-limits script to completion', async () => {
    await fs.createFile('/workspace/a.md', 'hi', { actor: 'user' });
    const result = await runSandboxWithLimits(
      ctx,
      'return (await fs.readText("/workspace/a.md")).toUpperCase();',
      { capabilities: { fsRead: ['/workspace/**'] }, limits: LIMITS },
    );
    expect(result).toMatchObject({ ok: true, value: 'HI' });
  });
});
