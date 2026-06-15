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
import { SANDBOXED_SCRIPT_RUNTIME } from '../script/scriptPolicy.ts';
import {
  createSandboxScriptEffectHandler,
  runApprovedSandboxScriptEffect,
} from './sandboxScriptRunner.ts';

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
  it('queues a valid request for approval', async () => {
    const handle = createSandboxScriptEffectHandler({ ctx, submit });
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
    const handle = createSandboxScriptEffectHandler({ ctx, submit });
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
});
