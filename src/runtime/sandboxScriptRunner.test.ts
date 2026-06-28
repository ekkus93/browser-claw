import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserClawDB } from '../db/db.ts';
import { MemoryContentStore } from '../workspace/contentStore.ts';
import { WorkspaceFs } from '../workspace/workspaceFs.ts';
import type { ScriptRuntimeContext } from '../script/scriptRuntime.ts';
import {
  SCRIPT_REQUEST_TYPE,
  SCRIPT_REQUEST_VERSION,
} from '../script/scriptRequest.ts';
import {
  SANDBOXED_SCRIPT_RUNTIME,
  type ScriptExecutionPolicy,
} from '../script/scriptPolicy.ts';
import {
  createSandboxScriptEffectHandler,
  runApprovedSandboxScriptEffect,
} from './sandboxScriptRunner.ts';

const ENABLED_POLICY: ScriptExecutionPolicy = {
  defaultRuntime: 'plan_dsl',
  sandboxedScriptingEnabled: true,
  advancedMode: true,
};
const loadEnabled = (): Promise<ScriptExecutionPolicy> =>
  Promise.resolve(ENABLED_POLICY);

const db = new BrowserClawDB();
const submit = vi.fn().mockResolvedValue(undefined);
const dispatch = vi.fn();
let ctx: ScriptRuntimeContext;

function request(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: SCRIPT_REQUEST_TYPE,
    version: SCRIPT_REQUEST_VERSION,
    runtime: SANDBOXED_SCRIPT_RUNTIME,
    title: 'Aggregate',
    reason: 'Need custom aggregation across files.',
    capabilities: { fsRead: ['/workspace/docs/**'], secrets: 'deny' },
    limits: {
      timeoutMs: 1000,
      maxOutputBytes: 100_000,
      maxFileReads: 100,
      maxFileWrites: 10,
    },
    code: 'return "done";',
    ...over,
  };
}

beforeEach(async () => {
  await db.open();
  await db.workspace_files.clear();
  await db.audit_events.clear();
  submit.mockClear();
  dispatch.mockClear();
  ctx = {
    fs: new WorkspaceFs({ db, content: new MemoryContentStore() }),
    db,
    dispatch,
  };
});

afterEach(async () => {
  await db.workspace_files.clear();
  await db.audit_events.clear();
});

describe('createSandboxScriptEffectHandler (F3)', () => {
  it('queues a valid request for approval when policy is enabled', async () => {
    const handle = createSandboxScriptEffectHandler({
      ctx,
      submit,
      loadScriptExecutionPolicy: loadEnabled,
    });
    await handle({
      type: 'sandbox_script_proposal',
      id: 'e1',
      request: request(),
    });
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'approvals/approvalRequested',
        payload: expect.objectContaining({
          id: 'e1',
          kind: 'sandbox_script',
        }),
      }),
    );
    expect(submit).not.toHaveBeenCalled();
  });

  it('resolves an invalid request as a failure (nothing queued)', async () => {
    const handle = createSandboxScriptEffectHandler({
      ctx,
      submit,
      loadScriptExecutionPolicy: loadEnabled,
    });
    await handle({
      type: 'sandbox_script_proposal',
      id: 'e2',
      request: request({ reason: '' }),
    });
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'resolve_effect',
        id: 'e2',
        result: expect.objectContaining({ ok: false }),
      }),
    );
  });

  // B1: policy enforcement before approval queuing.

  it('B1: disabled policy blocks approval and resolves as failure', async () => {
    const disabledPolicy: ScriptExecutionPolicy = {
      defaultRuntime: 'plan_dsl',
      sandboxedScriptingEnabled: false,
      advancedMode: false,
    };
    const handle = createSandboxScriptEffectHandler({
      ctx,
      submit,
      loadScriptExecutionPolicy: () => Promise.resolve(disabledPolicy),
    });
    await handle({
      type: 'sandbox_script_proposal',
      id: 'b1-disabled',
      request: request(),
    });
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'resolve_effect',
        id: 'b1-disabled',
        result: expect.objectContaining({ ok: false }),
      }),
    );
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'approvals/approvalRequested' }),
    );
  });

  it('B1: advanced-mode-required blocks approval and resolves as failure', async () => {
    const noAdvanced: ScriptExecutionPolicy = {
      defaultRuntime: 'plan_dsl',
      sandboxedScriptingEnabled: true,
      advancedMode: false,
    };
    const handle = createSandboxScriptEffectHandler({
      ctx,
      submit,
      loadScriptExecutionPolicy: () => Promise.resolve(noAdvanced),
    });
    await handle({
      type: 'sandbox_script_proposal',
      id: 'b1-advanced',
      request: request(),
    });
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'resolve_effect',
        id: 'b1-advanced',
        result: expect.objectContaining({ ok: false }),
      }),
    );
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'approvals/approvalRequested' }),
    );
  });

  it('B1: disabled policy block is audited as script.sandbox_blocked_by_policy', async () => {
    const disabledPolicy: ScriptExecutionPolicy = {
      defaultRuntime: 'plan_dsl',
      sandboxedScriptingEnabled: false,
      advancedMode: false,
    };
    const handle = createSandboxScriptEffectHandler({
      ctx,
      submit,
      loadScriptExecutionPolicy: () => Promise.resolve(disabledPolicy),
    });
    await handle({
      type: 'sandbox_script_proposal',
      id: 'b1-audit',
      request: request(),
    });
    // Allow the fire-and-forget audit write to settle.
    await new Promise((r) => setTimeout(r, 10));
    const types = (await db.audit_events.toArray()).map((e) => e.type);
    expect(types).toContain('script.sandbox_blocked_by_policy');
  });

  it('B1: default (no loadScriptExecutionPolicy) blocks because DEFAULT_SCRIPT_POLICY disables sandbox', async () => {
    const handle = createSandboxScriptEffectHandler({ ctx, submit });
    await handle({
      type: 'sandbox_script_proposal',
      id: 'b1-default',
      request: request(),
    });
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'resolve_effect',
        id: 'b1-default',
        result: expect.objectContaining({ ok: false }),
      }),
    );
  });
});

describe('runApprovedSandboxScriptEffect (F3)', () => {
  it('runs an approved script and resolves with its result', async () => {
    await runApprovedSandboxScriptEffect(
      { ctx, submit },
      {
        id: 'e3',
        status: 'approved',
        payloadPreview: JSON.stringify(request()),
      },
    );
    expect(submit).toHaveBeenCalledWith({
      type: 'resolve_effect',
      id: 'e3',
      result: { ok: true, value: 'done' },
    });
    const types = (await db.audit_events.toArray()).map((e) => e.type);
    expect(types).toContain('script.sandbox_completed');
  });

  it('declines a rejected script and resolves as user_rejected', async () => {
    await runApprovedSandboxScriptEffect(
      { ctx, submit },
      {
        id: 'e4',
        status: 'rejected',
        payloadPreview: JSON.stringify(request()),
      },
    );
    expect(submit).toHaveBeenCalledWith({
      type: 'resolve_effect',
      id: 'e4',
      result: { ok: false, error: { kind: 'user_rejected' } },
    });
    const types = (await db.audit_events.toArray()).map((e) => e.type);
    expect(types).toContain('script.sandbox_rejected');
  });

  // H2: sandbox script -> approve -> mediated file operation succeeds.
  it('runs an approved script with fsWrite capability and writes the file (H2)', async () => {
    const writeReq = request({
      code: `await fs.writeText('/workspace/h2-out.txt', 'written by sandbox')`,
      capabilities: {
        fsRead: ['/workspace/**'],
        fsWrite: ['/workspace/**'],
        secrets: 'deny',
      },
      limits: {
        timeoutMs: 5000,
        maxOutputBytes: 100_000,
        maxFileReads: 10,
        maxFileWrites: 10,
      },
    });
    await runApprovedSandboxScriptEffect(
      { ctx, submit },
      {
        id: 'e-write',
        status: 'approved',
        payloadPreview: JSON.stringify(writeReq),
      },
    );
    expect(await ctx.fs.readText('/workspace/h2-out.txt')).toBe(
      'written by sandbox',
    );
    const types = (await db.audit_events.toArray()).map((e) => e.type);
    expect(types).toContain('script.sandbox_completed');
    expect(types).toContain('script.capability_used');
  });

  // H2: sandbox script requests forbidden capability -> denied/audited.
  it('denies access outside the declared scope and audits script.capability_denied (H2)', async () => {
    await ctx.fs.createFile('/workspace/secret.txt', 'do not read', {
      actor: 'agent',
      overwrite: true,
    });
    const forbiddenReq = request({
      code: `await fs.readText('/workspace/secret.txt')`,
      capabilities: {
        // Only /workspace/allowed/**, not /workspace/secret.txt
        fsRead: ['/workspace/allowed/**'],
        secrets: 'deny',
      },
    });
    await runApprovedSandboxScriptEffect(
      { ctx, submit },
      {
        id: 'e-deny',
        status: 'approved',
        payloadPreview: JSON.stringify(forbiddenReq),
      },
    );
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'e-deny',
        result: expect.objectContaining({ ok: false }),
      }),
    );
    const types = (await db.audit_events.toArray()).map((e) => e.type);
    expect(types).toContain('script.capability_denied');
  });
});
