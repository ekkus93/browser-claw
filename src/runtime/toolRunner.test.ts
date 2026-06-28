import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';
import auditReducer from '../store/slices/auditSlice.ts';
import approvalsReducer from '../store/slices/approvalsSlice.ts';
import { BrowserClawDB } from '../db/db.ts';
import { createToolEffectHandler, runApprovedToolCall } from './toolRunner.ts';
import { setApprovalPolicy } from '../settings/appSettings.ts';
import type { Effect } from './effectTypes.ts';

const db = new BrowserClawDB();

function makeHandler(opts: { getConversationId?: () => string } = {}) {
  const store = configureStore({
    reducer: { audit: auditReducer, approvals: approvalsReducer },
  });
  const submit = vi
    .fn<(command: unknown) => Promise<void>>()
    .mockResolvedValue(undefined);
  const handler = createToolEffectHandler({
    db,
    dispatch: store.dispatch,
    submit,
    ...(opts.getConversationId
      ? { getConversationId: opts.getConversationId }
      : {}),
  });
  return { store, submit, handler };
}

function proposal(
  skillId: string,
  name: string,
): Extract<Effect, { type: 'tool_call_proposal' }> {
  return {
    type: 'tool_call_proposal',
    id: 'eff-1',
    skill_id: skillId,
    name,
    args: { url: 'https://example.com' },
    risk: 'medium',
  };
}

async function installSkill(opts: {
  id: string;
  enabled: boolean;
  tools: string[];
}) {
  await db.skills.put({
    id: opts.id,
    name: opts.id,
    version: '1.0.0',
    description: '',
    source: 'skill_md',
    enabled: opts.enabled,
    installedAt: 1,
  });
  await db.skill_permissions.put({
    skillId: opts.id,
    value: { tools: opts.tools, read: [], write: [], network: false },
  });
}

afterEach(async () => {
  await db.open();
  await db.skills.clear();
  await db.skill_state.clear();
  await db.skill_permissions.clear();
  await db.audit_events.clear();
  await db.memories.clear();
  await db.app_settings.clear();
});

describe('createToolEffectHandler — permission enforcement (fail closed)', () => {
  it('queues the call for approval when the skill declared the tool', async () => {
    await db.open();
    await installSkill({
      id: 'web-search',
      enabled: true,
      tools: ['Page Reader'],
    });
    const { store, submit, handler } = makeHandler();

    await handler(proposal('web-search', 'Page Reader'));

    expect(store.getState().approvals.queue[0]).toMatchObject({
      id: 'eff-1',
      kind: 'tool_call',
      status: 'pending',
    });
    // Nothing resolved/ran — it awaits the user's approval.
    expect(submit).not.toHaveBeenCalled();
    // The proposal is audited (pending) before approval.
    const proposed = await db.audit_events
      .where('type')
      .equals('tool.proposed')
      .toArray();
    expect(proposed[0]?.status).toBe('pending');
    expect(proposed[0]?.toolName).toBe('Page Reader');
  });

  it('denies a tool the skill did not declare (audited + resolved failure)', async () => {
    await db.open();
    await installSkill({
      id: 'web-search',
      enabled: true,
      tools: ['File Reader'],
    });
    const { store, submit, handler } = makeHandler();

    await handler(proposal('web-search', 'Page Reader'));

    expect(store.getState().approvals.queue).toHaveLength(0);
    expect(submit).toHaveBeenCalledWith({
      type: 'resolve_effect',
      id: 'eff-1',
      result: {
        ok: false,
        error: expect.objectContaining({ kind: 'tool_not_permitted' }),
      },
    });
    const denied = await db.audit_events
      .where('type')
      .equals('tool.denied')
      .toArray();
    expect(denied[0]?.status).toBe('failure');
    expect(denied[0]?.toolName).toBe('Page Reader');
  });

  it('denies a disabled skill', async () => {
    await db.open();
    await installSkill({
      id: 'web-search',
      enabled: false,
      tools: ['Page Reader'],
    });
    const { submit, handler } = makeHandler();
    await handler(proposal('web-search', 'Page Reader'));
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'resolve_effect' }),
    );
  });

  it('denies an unknown skill and a call with no active skill', async () => {
    await db.open();
    const { submit, handler } = makeHandler();
    await handler(proposal('ghost', 'Page Reader'));
    await handler(proposal('', 'Page Reader'));
    expect(submit).toHaveBeenCalledTimes(2);
  });
});

describe('createToolEffectHandler — approval policy', () => {
  it('queues even a low-risk call under the default (fail-closed) policy', async () => {
    await db.open();
    await installSkill({
      id: 'web-search',
      enabled: true,
      tools: ['Page Reader'],
    });
    const { store, submit, handler } = makeHandler();

    await handler({ ...proposal('web-search', 'Page Reader'), risk: 'low' });

    // Default is require_all: nothing auto-runs, the user must confirm.
    expect(store.getState().approvals.queue[0]?.status).toBe('pending');
    expect(submit).not.toHaveBeenCalled();
  });

  it('auto-approves and runs a medium-risk call when the policy is relaxed', async () => {
    await db.open();
    await db.memories.clear();
    await setApprovalPolicy(db, 'auto_low_medium');
    await installSkill({ id: 'mem', enabled: true, tools: ['Remember'] });
    const { store, submit, handler } = makeHandler({
      getConversationId: () => 'c-auto',
    });

    await handler({
      type: 'tool_call_proposal',
      id: 'eff-auto',
      skill_id: 'mem',
      name: 'Remember',
      args: { title: 'Auto fact', text: 'remembered without a card' },
      risk: 'medium',
    });

    // No approval card was shown — it ran straight through and resolved.
    expect(store.getState().approvals.queue).toHaveLength(0);
    expect(submit).toHaveBeenCalledWith({
      type: 'resolve_effect',
      id: 'eff-auto',
      result: { ok: true, text: 'Saved memory: Auto fact' },
    });
    // But it is NOT silent: the auto-approval and the run are both audited,
    // and the memory carries the conversation provenance.
    const autoApproved = await db.audit_events
      .where('type')
      .equals('tool.auto_approved')
      .toArray();
    expect(autoApproved[0]?.status).toBe('success');
    const rows = await db.memories.toArray();
    expect(rows[0]).toMatchObject({
      title: 'Auto fact',
      conversationId: 'c-auto',
    });
  });

  it('NEVER auto-approves a high-risk call, even under the relaxed policy', async () => {
    await db.open();
    await setApprovalPolicy(db, 'auto_low_medium');
    await installSkill({
      id: 'web-search',
      enabled: true,
      tools: ['Page Reader'],
    });
    const { store, submit, handler } = makeHandler();

    await handler({ ...proposal('web-search', 'Page Reader'), risk: 'high' });

    // High risk always prompts: it is queued, nothing ran/resolved.
    expect(store.getState().approvals.queue[0]).toMatchObject({
      status: 'pending',
      risk: 'high',
    });
    expect(submit).not.toHaveBeenCalled();
  });
});

describe('runApprovedToolCall', () => {
  it('runs an approved tool and resolves the effect with its output', async () => {
    await db.open();
    await installSkill({ id: 'web', enabled: true, tools: ['Page Reader'] });
    const { store, submit } = makeHandler();
    const fetchImpl = vi.fn(() =>
      Promise.resolve(new Response('<p>hello</p>')),
    ) as unknown as typeof fetch;

    await runApprovedToolCall(
      { db, dispatch: store.dispatch, submit, ctx: { fetchImpl } },
      {
        id: 'eff-3',
        status: 'approved',
        toolName: 'Page Reader',
        argsJson: '{"url":"https://example.com"}',
        skillId: 'web',
      },
    );

    expect(submit).toHaveBeenCalledWith({
      type: 'resolve_effect',
      id: 'eff-3',
      result: { ok: true, text: 'hello' },
    });
    const audited = await db.audit_events
      .where('type')
      .equals('tool.executed')
      .toArray();
    expect(audited[0]?.status).toBe('success');
  });

  it('resolves a rejected tool call as a failure (never runs it)', async () => {
    await db.open();
    const { store, submit } = makeHandler();
    const fetchImpl = vi.fn() as unknown as typeof fetch;

    await runApprovedToolCall(
      { db, dispatch: store.dispatch, submit, ctx: { fetchImpl } },
      {
        id: 'eff-3',
        status: 'rejected',
        toolName: 'Page Reader',
        argsJson: '{}',
      },
    );

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(submit).toHaveBeenCalledWith({
      type: 'resolve_effect',
      id: 'eff-3',
      result: { ok: false, error: { kind: 'user_rejected' } },
    });
  });

  it('Remember persists a provenance-tagged memory and audits memory.created', async () => {
    await db.open();
    await db.memories.clear();
    await installSkill({
      id: 'web-search',
      enabled: true,
      tools: ['Remember'],
    });
    const { store, submit } = makeHandler();

    await runApprovedToolCall(
      { db, dispatch: store.dispatch, submit },
      {
        id: 'eff-5',
        status: 'approved',
        toolName: 'Remember',
        argsJson: JSON.stringify({
          title: 'Rust ownership',
          text: 'borrow checker basics',
          tags: ['rust'],
        }),
        conversationId: 'c1',
        skillId: 'web-search',
      },
    );

    const rows = await db.memories.toArray();
    expect(rows[0]).toMatchObject({
      title: 'Rust ownership',
      text: 'borrow checker basics',
      tags: ['rust'],
      createdBy: 'assistant',
      conversationId: 'c1',
      skillId: 'web-search',
    });
    const created = await db.audit_events
      .where('type')
      .equals('memory.created')
      .toArray();
    expect(created[0]?.status).toBe('success');
    expect(created[0]?.skillId).toBe('web-search');
    expect(submit).toHaveBeenCalledWith({
      type: 'resolve_effect',
      id: 'eff-5',
      result: { ok: true, text: 'Saved memory: Rust ownership' },
    });
  });

  it('Remember with missing fields fails (no memory written)', async () => {
    await db.open();
    await db.memories.clear();
    await installSkill({
      id: 'web-search',
      enabled: true,
      tools: ['Remember'],
    });
    const { store, submit } = makeHandler();

    await runApprovedToolCall(
      { db, dispatch: store.dispatch, submit },
      {
        id: 'eff-6',
        status: 'approved',
        toolName: 'Remember',
        argsJson: JSON.stringify({ title: 'no body' }),
        conversationId: 'c1',
        skillId: 'web-search',
      },
    );

    expect(await db.memories.count()).toBe(0);
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        result: expect.objectContaining({ ok: false }),
      }),
    );
  });

  it('resolves a tool error as a failure and audits it', async () => {
    await db.open();
    await installSkill({ id: 'web', enabled: true, tools: ['Page Reader'] });
    const { store, submit } = makeHandler();
    const fetchImpl = vi.fn(() =>
      Promise.resolve(new Response('nope', { status: 500 })),
    ) as unknown as typeof fetch;

    await runApprovedToolCall(
      { db, dispatch: store.dispatch, submit, ctx: { fetchImpl } },
      {
        id: 'eff-3',
        status: 'approved',
        toolName: 'Page Reader',
        argsJson: '{"url":"https://example.com"}',
        skillId: 'web',
      },
    );

    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        result: expect.objectContaining({ ok: false }),
      }),
    );
    const failed = await db.audit_events
      .where('type')
      .equals('tool.failed')
      .toArray();
    expect(failed[0]?.status).toBe('failure');
  });
});

describe('runApprovedToolCall — execution-time permission re-check (A1.1)', () => {
  const fetchImpl = vi.fn(() =>
    Promise.resolve(new Response('<p>hello</p>')),
  ) as unknown as typeof fetch;

  async function runWith(skillId: string | undefined) {
    const { store, submit } = makeHandler();
    await runApprovedToolCall(
      { db, dispatch: store.dispatch, submit, ctx: { fetchImpl } },
      {
        id: 'eff-rc',
        status: 'approved',
        toolName: 'Page Reader',
        argsJson: '{"url":"https://example.com"}',
        ...(skillId !== undefined ? { skillId } : {}),
      },
    );
    return submit;
  }

  function expectBlocked(submit: ReturnType<typeof vi.fn>) {
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(submit).toHaveBeenCalledWith({
      type: 'resolve_effect',
      id: 'eff-rc',
      result: {
        ok: false,
        error: expect.objectContaining({ kind: 'tool_not_permitted' }),
      },
    });
  }

  it('blocks a tool whose skill was disabled after approval (audited)', async () => {
    await db.open();
    await installSkill({ id: 'web', enabled: false, tools: ['Page Reader'] });
    const submit = await runWith('web');
    expectBlocked(submit);
    const blocked = await db.audit_events
      .where('type')
      .equals('tool.permission_recheck_failed')
      .toArray();
    expect(blocked[0]?.status).toBe('failure');
    expect(blocked[0]?.skillId).toBe('web');
  });

  it('blocks a tool whose permission was revoked after approval', async () => {
    await db.open();
    await installSkill({ id: 'web', enabled: true, tools: [] });
    const submit = await runWith('web');
    expectBlocked(submit);
  });

  it('blocks a forged/stale approval with no valid skillId', async () => {
    await db.open();
    const submit = await runWith(undefined);
    expectBlocked(submit);
  });

  it('blocks an approval naming a skill that no longer exists', async () => {
    await db.open();
    const submit = await runWith('ghost');
    expectBlocked(submit);
  });
});

// ---------------------------------------------------------------------------
// FIX1-F1 — parseApprovedArgsOrThrow
// ---------------------------------------------------------------------------

describe('F1 — parseApprovedArgsOrThrow', () => {
  async function runWithArgs(argsJson: string | undefined) {
    await db.open();
    await db.skills.clear();
    await db.audit_events.clear();
    await installSkill({
      id: 'web-search',
      enabled: true,
      tools: ['Page Reader'],
    });
    const store = configureStore({
      reducer: { audit: auditReducer, approvals: approvalsReducer },
    });
    const submit = vi
      .fn<(command: unknown) => Promise<void>>()
      .mockResolvedValue(undefined);
    const fetchImpl = vi.fn(() =>
      Promise.resolve(new Response('<p>ok</p>')),
    ) as unknown as typeof fetch;
    await runApprovedToolCall(
      { db, dispatch: store.dispatch, submit, ctx: { fetchImpl } },
      {
        id: 'eff-f1',
        status: 'approved',
        toolName: 'Page Reader',
        ...(argsJson !== undefined ? { argsJson } : {}),
        skillId: 'web-search',
      },
    );
    const auditTypes = store.getState().audit.recent.map((e) => e.type);
    return { submit, auditTypes };
  }

  it('F1: empty argsJson -> {} (valid for no-arg call)', async () => {
    // Page Reader needs a url, but the key point is the args are parsed as {} without throwing
    const { submit } = await runWithArgs('');
    // The tool itself will fail (no url), but not from args parse failure
    expect(submit.mock.calls[0]?.[0]).not.toMatchObject({
      result: { ok: false, error: { kind: 'tool_args_parse_failed' } },
    });
  });

  it('F1: valid object args are accepted', async () => {
    const { submit } = await runWithArgs(
      JSON.stringify({ url: 'https://example.com' }),
    );
    // Tool runs (may fail for other reasons like no-cors in jsdom) but not args parse failure
    expect(submit.mock.calls[0]?.[0]).not.toMatchObject({
      result: { ok: false, error: { kind: 'tool_args_parse_failed' } },
    });
  });

  it('F1: invalid JSON throws — tool not executed', async () => {
    const { submit, auditTypes } = await runWithArgs('{ not json }');
    expect(submit.mock.calls[0]?.[0]).toMatchObject({
      result: { ok: false, error: { kind: 'tool_args_parse_failed' } },
    });
    expect(auditTypes).toContain('tool.args_parse_failed');
  });

  it('F1: array args rejected — tool not executed', async () => {
    const { submit, auditTypes } = await runWithArgs('[1,2,3]');
    expect(submit.mock.calls[0]?.[0]).toMatchObject({
      result: { ok: false, error: { kind: 'tool_args_parse_failed' } },
    });
    expect(auditTypes).toContain('tool.args_parse_failed');
  });

  it('F1: string args rejected', async () => {
    const { submit } = await runWithArgs('"hello"');
    expect(submit.mock.calls[0]?.[0]).toMatchObject({
      result: { ok: false, error: { kind: 'tool_args_parse_failed' } },
    });
  });

  it('F1: number args rejected', async () => {
    const { submit } = await runWithArgs('42');
    expect(submit.mock.calls[0]?.[0]).toMatchObject({
      result: { ok: false, error: { kind: 'tool_args_parse_failed' } },
    });
  });
});
