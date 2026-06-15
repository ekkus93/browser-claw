import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserClawDB } from '../db/db.ts';
import { MemoryContentStore } from '../workspace/contentStore.ts';
import { WorkspaceFs } from '../workspace/workspaceFs.ts';
import type { PlanOpContext } from './planOps.ts';
import type { BrowserClawPlan } from './planSchema.ts';
import {
  buildPlanProposal,
  classifyPlanRisk,
  proposePlan,
  rejectPlan,
  runApprovedPlan,
} from './planRuntime.ts';

const db = new BrowserClawDB();
let ctx: PlanOpContext;

function makePlan(steps: BrowserClawPlan['steps']): BrowserClawPlan {
  return {
    type: 'browserclaw_plan',
    version: 1,
    title: 'P',
    reason: 'r',
    steps,
  };
}

beforeEach(async () => {
  await db.open();
  await db.workspace_files.clear();
  await db.audit_events.clear();
  ctx = {
    fs: new WorkspaceFs({ db, content: new MemoryContentStore() }),
    db,
    dispatch: vi.fn(),
  };
});

afterEach(async () => {
  await db.workspace_files.clear();
  await db.audit_events.clear();
});

async function auditTypes(): Promise<string[]> {
  return (await db.audit_events.toArray()).map((e) => e.type);
}

describe('plan proposal + risk (C4)', () => {
  it('classifies risk and builds a capability/file/step preview', () => {
    const proposal = buildPlanProposal(
      makePlan([
        { id: 'r', op: 'fs.readText', path: '/workspace/in.md' },
        {
          id: 'w',
          op: 'fs.writeText',
          path: '/workspace/out.md',
          contentFrom: 'r',
        },
      ]),
    );
    expect(proposal.runtime).toBe('Structured Plan DSL v0.1');
    expect(proposal.risk).toBe('medium');
    expect(proposal.capabilities).toContain('workspace.write');
    expect(proposal.files.reads).toContain('/workspace/in.md');
    expect(proposal.files.writes).toContain('/workspace/out.md');
    expect(proposal.steps.map((s) => s.op)).toEqual([
      'fs.readText',
      'fs.writeText',
    ]);
  });

  it('marks a deleting plan high risk', () => {
    expect(
      classifyPlanRisk(
        makePlan([{ id: 'd', op: 'fs.delete', path: '/workspace/a' }]),
      ),
    ).toBe('high');
  });
});

describe('plan lifecycle audit (C4)', () => {
  it('audits requested on propose and rejected on reject', async () => {
    const plan = makePlan([{ id: 'r', op: 'fs.list', path: '/workspace' }]);
    proposePlan(ctx, plan);
    rejectPlan(ctx, plan);
    await vi.waitFor(async () => {
      const types = await auditTypes();
      expect(types).toContain('script.plan_requested');
      expect(types).toContain('script.plan_rejected');
    });
  });

  it('audits started + completed for an approved plan that runs', async () => {
    const result = await runApprovedPlan(
      ctx,
      makePlan([
        {
          id: 'w',
          op: 'fs.writeText',
          path: '/workspace/a.txt',
          content: 'hi',
        },
      ]),
    );
    expect(result.ok).toBe(true);
    await vi.waitFor(async () => {
      const types = await auditTypes();
      expect(types).toContain('script.plan_started');
      expect(types).toContain('script.plan_completed');
    });
    const events = await db.audit_events.toArray();
    expect(events.every((e) => e.source === 'script')).toBe(true);
  });

  it('audits failed when a step fails', async () => {
    const result = await runApprovedPlan(
      ctx,
      makePlan([
        { id: 'r', op: 'fs.readText', path: '/workspace/missing.txt' },
      ]),
    );
    expect(result.ok).toBe(false);
    await vi.waitFor(async () => {
      expect(await auditTypes()).toContain('script.plan_failed');
    });
  });
});
