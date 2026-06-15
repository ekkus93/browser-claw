import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';
import auditReducer from '../store/slices/auditSlice.ts';
import approvalsReducer from '../store/slices/approvalsSlice.ts';
import { BrowserClawDB } from '../db/db.ts';
import { MemoryContentStore } from '../workspace/contentStore.ts';
import { WorkspaceFs } from '../workspace/workspaceFs.ts';
import type { PlanOpContext } from '../script/planOps.ts';
import {
  createPlanEffectHandler,
  runApprovedPlanEffect,
} from './planRunner.ts';

const db = new BrowserClawDB();

function makeDeps() {
  const store = configureStore({
    reducer: { audit: auditReducer, approvals: approvalsReducer },
  });
  const submit = vi
    .fn<(command: unknown) => Promise<void>>()
    .mockResolvedValue(undefined);
  const ctx: PlanOpContext = {
    fs: new WorkspaceFs({ db, content: new MemoryContentStore() }),
    db,
    dispatch: store.dispatch,
  };
  return { store, submit, ctx };
}

const planJson = JSON.stringify({
  type: 'browserclaw_plan',
  version: 1,
  title: 'P',
  reason: 'r',
  steps: [
    { id: 'w', op: 'fs.writeText', path: '/workspace/a.txt', content: 'hi' },
  ],
});

beforeEach(async () => {
  await db.open();
  await db.workspace_files.clear();
  await db.audit_events.clear();
});

afterEach(async () => {
  await db.workspace_files.clear();
  await db.audit_events.clear();
});

describe('createPlanEffectHandler (C5)', () => {
  it('queues a valid plan for approval and runs nothing yet', async () => {
    const { store, submit, ctx } = makeDeps();
    const handler = createPlanEffectHandler({ ctx, submit });
    await handler({
      type: 'script_plan_proposal',
      id: 'eff-1',
      plan: JSON.parse(planJson),
    });
    expect(store.getState().approvals.queue[0]).toMatchObject({
      id: 'eff-1',
      kind: 'plan',
      status: 'pending',
    });
    expect(submit).not.toHaveBeenCalled();
    expect(await db.workspace_files.count()).toBe(0);
  });

  it('resolves an invalid plan as a failure without queuing', async () => {
    const { store, submit, ctx } = makeDeps();
    const handler = createPlanEffectHandler({ ctx, submit });
    await handler({
      type: 'script_plan_proposal',
      id: 'eff-bad',
      plan: { type: 'nope' },
    });
    expect(store.getState().approvals.queue).toHaveLength(0);
    expect(submit).toHaveBeenCalledWith({
      type: 'resolve_effect',
      id: 'eff-bad',
      result: {
        ok: false,
        error: expect.objectContaining({ kind: 'plan_invalid' }),
      },
    });
  });
});

describe('runApprovedPlanEffect (C5)', () => {
  it('runs an approved plan and resolves the effect with its outputs', async () => {
    const { submit, ctx } = makeDeps();
    await runApprovedPlanEffect(
      { ctx, submit },
      { id: 'eff-1', status: 'approved', payloadPreview: planJson },
    );
    expect(await ctx.fs.readText('/workspace/a.txt')).toBe('hi');
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'resolve_effect',
        id: 'eff-1',
        result: expect.objectContaining({ ok: true }),
      }),
    );
  });

  it('resolves a rejected plan as a failure and runs nothing', async () => {
    const { submit, ctx } = makeDeps();
    await runApprovedPlanEffect(
      { ctx, submit },
      { id: 'eff-1', status: 'rejected', payloadPreview: planJson },
    );
    expect(await db.workspace_files.count()).toBe(0);
    expect(submit).toHaveBeenCalledWith({
      type: 'resolve_effect',
      id: 'eff-1',
      result: { ok: false, error: { kind: 'user_rejected' } },
    });
  });

  it('resolves a failing plan as an error', async () => {
    const { submit, ctx } = makeDeps();
    const failing = JSON.stringify({
      type: 'browserclaw_plan',
      version: 1,
      title: 'P',
      reason: 'r',
      steps: [{ id: 'r', op: 'fs.readText', path: '/workspace/missing.txt' }],
    });
    await runApprovedPlanEffect(
      { ctx, submit },
      { id: 'eff-1', status: 'approved', payloadPreview: failing },
    );
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        result: expect.objectContaining({ ok: false }),
      }),
    );
  });
});
