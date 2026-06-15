import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserClawDB } from '../db/db.ts';
import { MemoryContentStore } from '../workspace/contentStore.ts';
import { WorkspaceFs } from '../workspace/workspaceFs.ts';
import { executePlan } from './planExecutor.ts';
import type { PlanOpContext } from './planOps.ts';

const db = new BrowserClawDB();
let ctx: PlanOpContext;

function plan(steps: unknown[]) {
  return {
    type: 'browserclaw_plan',
    version: 1,
    title: 't',
    reason: 'r',
    steps,
  };
}

beforeEach(async () => {
  await db.open();
  await db.workspace_files.clear();
  ctx = {
    fs: new WorkspaceFs({ db, content: new MemoryContentStore() }),
    db,
    dispatch: vi.fn(),
  };
});

afterEach(async () => {
  await db.workspace_files.clear();
});

describe('executePlan (C3)', () => {
  it('runs steps sequentially and resolves *From references', async () => {
    await ctx.fs.createFile('/workspace/in.txt', 'payload');
    const result = await executePlan(
      ctx,
      plan([
        { id: 'read', op: 'fs.readText', path: '/workspace/in.txt' },
        {
          id: 'write',
          op: 'fs.writeText',
          path: '/workspace/out.txt',
          contentFrom: 'read',
        },
      ]),
    );
    expect(result.ok).toBe(true);
    expect(result.steps.map((s) => s.ok)).toEqual([true, true]);
    expect(await ctx.fs.readText('/workspace/out.txt')).toBe('payload');
  });

  it('rejects an invalid plan before running anything', async () => {
    const result = await executePlan(ctx, plan([{ id: 'a', op: 'nope' }]));
    expect(result.ok).toBe(false);
    expect(result.errorKind).toBe('validation_error');
  });

  it('stops on the first failing step', async () => {
    const result = await executePlan(
      ctx,
      plan([
        { id: 'a', op: 'fs.writeText', path: '/workspace/a.txt', content: 'x' },
        { id: 'b', op: 'fs.readText', path: '/workspace/missing.txt' },
        { id: 'c', op: 'fs.writeText', path: '/workspace/c.txt', content: 'y' },
      ]),
    );
    expect(result.ok).toBe(false);
    expect(result.errorKind).toBe('step_failed');
    expect(result.steps.map((s) => s.ok)).toEqual([true, false]);
    // The step after the failure never ran.
    expect(await ctx.fs.exists('/workspace/c.txt')).toBe(false);
  });

  it('enforces the output size limit', async () => {
    await ctx.fs.createFile('/workspace/big.txt', 'x'.repeat(5000));
    const result = await executePlan(
      ctx,
      plan([{ id: 'r', op: 'fs.readText', path: '/workspace/big.txt' }]),
      { limits: { maxOutputBytes: 100 } },
    );
    expect(result.ok).toBe(false);
    expect(result.errorKind).toBe('output_limit_exceeded');
  });

  it('enforces a timeout', async () => {
    let t = 0;
    const result = await executePlan(
      ctx,
      plan([
        { id: 'a', op: 'fs.writeText', path: '/workspace/a.txt', content: '1' },
        { id: 'b', op: 'fs.writeText', path: '/workspace/b.txt', content: '2' },
      ]),
      { limits: { timeoutMs: 10 }, now: () => (t += 100) },
    );
    expect(result.ok).toBe(false);
    expect(result.errorKind).toBe('timeout');
  });

  it('honors cancellation', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await executePlan(
      ctx,
      plan([
        { id: 'a', op: 'fs.writeText', path: '/workspace/a.txt', content: '1' },
      ]),
      { signal: controller.signal },
    );
    expect(result.ok).toBe(false);
    expect(result.errorKind).toBe('cancelled');
  });

  it('enforces a file-write limit', async () => {
    const result = await executePlan(
      ctx,
      plan([
        { id: 'a', op: 'fs.writeText', path: '/workspace/a.txt', content: '1' },
        { id: 'b', op: 'fs.writeText', path: '/workspace/b.txt', content: '2' },
      ]),
      { limits: { maxFileWrites: 1 } },
    );
    expect(result.ok).toBe(false);
    expect(result.errorKind).toBe('limit_exceeded');
  });
});
