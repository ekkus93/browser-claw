import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserClawDB } from '../db/db.ts';
import { MemoryContentStore } from '../workspace/contentStore.ts';
import { WorkspaceFs } from '../workspace/workspaceFs.ts';
import type { WorkspaceOpsDeps } from '../workspace/workspaceOps.ts';
import {
  createWorkspaceEffectHandler,
  parseWorkspaceOp,
  runApprovedWorkspaceEffect,
} from './workspaceRunner.ts';

const db = new BrowserClawDB();
const submit = vi.fn().mockResolvedValue(undefined);
const dispatch = vi.fn();
let fs: WorkspaceFs;
let ops: WorkspaceOpsDeps;

beforeEach(async () => {
  await db.open();
  await db.workspace_files.clear();
  await db.audit_events.clear();
  submit.mockClear();
  dispatch.mockClear();
  fs = new WorkspaceFs({ db, content: new MemoryContentStore() });
  ops = { fs, db, dispatch };
});

afterEach(async () => {
  await db.workspace_files.clear();
  await db.audit_events.clear();
});

describe('parseWorkspaceOp (F3)', () => {
  it('accepts a well-formed op and rejects malformed ones', () => {
    expect(
      parseWorkspaceOp({
        kind: 'create',
        path: '/workspace/a.md',
        content: 'x',
      }),
    ).toMatchObject({ kind: 'create' });
    expect(
      parseWorkspaceOp({ kind: 'create', path: '/etc/x', content: 'x' }),
    ).toBeNull();
    expect(parseWorkspaceOp({ kind: 'bogus' })).toBeNull();
    expect(
      parseWorkspaceOp({ kind: 'move', from: '/workspace/a', to: 'x' }),
    ).toBeNull();
  });
});

describe('createWorkspaceEffectHandler (F3)', () => {
  it('queues a mutating op for approval with the right kind', async () => {
    const handle = createWorkspaceEffectHandler({ ops, submit });
    await handle({
      type: 'workspace_file_op',
      id: 'w1',
      op: { kind: 'delete', path: '/workspace/a.md' },
    });
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'approvals/approvalRequested',
        payload: expect.objectContaining({
          id: 'w1',
          kind: 'workspace_delete',
          risk: 'high',
        }),
      }),
    );
    expect(submit).not.toHaveBeenCalled();
  });

  it('runs a read-only search directly without approval', async () => {
    await fs.createFile('/workspace/a.md', 'needle', { actor: 'user' });
    const handle = createWorkspaceEffectHandler({ ops, submit });
    await handle({
      type: 'workspace_search',
      id: 'w2',
      query: { textContains: 'needle' },
    });
    expect(dispatch).not.toHaveBeenCalled();
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'resolve_effect',
        id: 'w2',
        result: expect.objectContaining({ ok: true }),
      }),
    );
  });

  it('resolves an invalid op as a failure', async () => {
    const handle = createWorkspaceEffectHandler({ ops, submit });
    await handle({
      type: 'workspace_file_op',
      id: 'w3',
      op: { kind: 'create', path: '/etc/passwd', content: 'x' },
    });
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        result: expect.objectContaining({ ok: false }),
      }),
    );
  });
});

describe('runApprovedWorkspaceEffect (F3)', () => {
  it('executes an approved op and resolves with the stat', async () => {
    await runApprovedWorkspaceEffect(
      { ops, submit },
      {
        id: 'w4',
        status: 'approved',
        payloadPreview: JSON.stringify({
          kind: 'create',
          path: '/workspace/out.md',
          content: 'body',
        }),
      },
    );
    expect(await fs.readText('/workspace/out.md')).toBe('body');
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'w4',
        result: expect.objectContaining({ ok: true }),
      }),
    );
  });

  it('declines a rejected op and audits permission_denied', async () => {
    await runApprovedWorkspaceEffect(
      { ops, submit },
      {
        id: 'w5',
        status: 'rejected',
        payloadPreview: JSON.stringify({
          kind: 'delete',
          path: '/workspace/a.md',
        }),
      },
    );
    expect(submit).toHaveBeenCalledWith({
      type: 'resolve_effect',
      id: 'w5',
      result: { ok: false, error: { kind: 'user_rejected' } },
    });
    const types = (await db.audit_events.toArray()).map((e) => e.type);
    expect(types).toContain('workspace.permission_denied');
  });
});
