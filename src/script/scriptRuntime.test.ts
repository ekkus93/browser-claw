import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserClawDB } from '../db/db.ts';
import { MemoryContentStore } from '../workspace/contentStore.ts';
import { WorkspaceFs } from '../workspace/workspaceFs.ts';
import {
  buildScriptProposal,
  proposeScript,
  rejectScript,
  runApprovedScript,
  type ScriptRuntimeContext,
} from './scriptRuntime.ts';
import { SANDBOX_RUNTIME_LABEL } from './scriptPolicy.ts';
import {
  SCRIPT_REQUEST_TYPE,
  SCRIPT_REQUEST_VERSION,
  validateScriptRequest,
  type BrowserClawScriptRequest,
} from './scriptRequest.ts';
import { SANDBOXED_SCRIPT_RUNTIME } from './scriptPolicy.ts';

const db = new BrowserClawDB();
let ctx: ScriptRuntimeContext;

function rawRequest(
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    type: SCRIPT_REQUEST_TYPE,
    version: SCRIPT_REQUEST_VERSION,
    runtime: SANDBOXED_SCRIPT_RUNTIME,
    title: 'Aggregate',
    reason: 'Need custom aggregation across files.',
    capabilities: {
      fsRead: ['/workspace/docs/**'],
      fsWrite: ['/workspace/reports/**'],
      network: 'deny',
      secrets: 'deny',
    },
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

function validRequest(
  over: Record<string, unknown> = {},
): BrowserClawScriptRequest {
  const result = validateScriptRequest(rawRequest(over));
  if (!result.ok) throw new Error(result.errors.join('; '));
  return result.request;
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

describe('buildScriptProposal (D6)', () => {
  it('previews runtime, reason, code, capabilities, limits, scopes', () => {
    const proposal = buildScriptProposal(validRequest(), 'medium');
    expect(proposal.runtime).toBe(SANDBOX_RUNTIME_LABEL);
    expect(proposal.reason).toMatch(/aggregation/);
    expect(proposal.codePreview).toBe('return "done";');
    expect(proposal.capabilities).toEqual([
      'workspace.read',
      'workspace.write',
    ]);
    expect(proposal.fileScopes).toEqual({
      reads: ['/workspace/docs/**'],
      writes: ['/workspace/reports/**'],
    });
    expect(proposal.network).toBe('deny');
    expect(proposal.limits.timeoutMs).toBe(1000);
  });

  it('truncates a long code preview', () => {
    const proposal = buildScriptProposal(
      validRequest({ code: 'x'.repeat(5000) }),
      'low',
    );
    expect(proposal.codeTruncated).toBe(true);
    expect(proposal.codePreview.length).toBe(2000);
  });
});

describe('proposeScript / rejectScript (D6)', () => {
  it('audits sandbox_requested for a valid request', async () => {
    const result = proposeScript(ctx, rawRequest());
    expect(result.ok).toBe(true);
    expect(await auditTypes()).toContain('script.sandbox_requested');
  });

  it('audits sandbox_rejected for an invalid request', async () => {
    const result = proposeScript(ctx, rawRequest({ reason: '' }));
    expect(result.ok).toBe(false);
    expect(await auditTypes()).toContain('script.sandbox_rejected');
  });

  it('audits an explicit rejection', async () => {
    rejectScript(ctx, validRequest());
    expect(await auditTypes()).toContain('script.sandbox_rejected');
  });
});

describe('runApprovedScript (D6)', () => {
  it('audits the full lifecycle on success', async () => {
    const result = await runApprovedScript(ctx, rawRequest());
    expect(result).toMatchObject({ ok: true, value: 'done' });
    const types = await auditTypes();
    expect(types).toEqual(
      expect.arrayContaining([
        'script.sandbox_approved',
        'script.sandbox_started',
        'script.sandbox_completed',
      ]),
    );
  });

  it('audits capability usage during the run', async () => {
    await ctx.fs.createFile('/workspace/docs/a.md', 'hi', { actor: 'user' });
    await runApprovedScript(
      ctx,
      rawRequest({ code: 'return await fs.readText("/workspace/docs/a.md");' }),
    );
    expect(await auditTypes()).toContain('script.capability_used');
  });

  it('audits a timeout', async () => {
    let t = 0;
    const now = () => {
      t += 10;
      return t;
    };
    const result = await runApprovedScript(
      ctx,
      rawRequest({
        code: 'while (true) {}',
        limits: {
          timeoutMs: 50,
          maxOutputBytes: 100_000,
          maxFileReads: 10,
          maxFileWrites: 10,
        },
      }),
      { now },
    );
    expect(result.ok).toBe(false);
    expect(await auditTypes()).toContain('script.sandbox_timeout');
  });

  it('audits a cancellation', async () => {
    const controller = new AbortController();
    controller.abort();
    await runApprovedScript(ctx, rawRequest({ code: 'while (true) {}' }), {
      signal: controller.signal,
    });
    expect(await auditTypes()).toContain('script.sandbox_cancelled');
  });

  it('audits a failure when the script throws', async () => {
    const result = await runApprovedScript(
      ctx,
      rawRequest({ code: 'throw new Error("boom");' }),
    );
    expect(result.ok).toBe(false);
    expect(await auditTypes()).toContain('script.sandbox_failed');
  });
});
