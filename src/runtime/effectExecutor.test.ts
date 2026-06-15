import 'fake-indexeddb/auto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';
import auditReducer from '../store/slices/auditSlice.ts';
import approvalsReducer from '../store/slices/approvalsSlice.ts';
import runtimeReducer from '../store/slices/runtimeSlice.ts';
import { BrowserClawDB } from '../db/db.ts';
import {
  executeEffect,
  type EffectContext,
  type EffectPorts,
} from './effectExecutor.ts';
import type { Effect } from './effectTypes.ts';

const db = new BrowserClawDB();

afterAll(() => {
  db.close();
});

function makeCtx(ports?: EffectPorts) {
  const store = configureStore({
    reducer: {
      audit: auditReducer,
      approvals: approvalsReducer,
      runtime: runtimeReducer,
    },
  });
  const ctx: EffectContext = {
    dispatch: store.dispatch,
    db,
    now: () => 1234,
    ...(ports ? { ports } : {}),
  };
  return { store, ctx };
}

describe('executeEffect', () => {
  it('routes audit_append into the audit feed', async () => {
    const { store, ctx } = makeCtx();
    await executeEffect(
      {
        type: 'audit_append',
        id: 'a1',
        event_type: 'x',
        summary: 's',
        risk: 'low',
      },
      ctx,
    );
    expect(store.getState().audit.recent[0]).toMatchObject({
      type: 'x',
      risk: 'low',
      at: 1234,
    });
    // It was also persisted durably.
    const durable = await ctx.db.audit_events
      .where('type')
      .equals('x')
      .toArray();
    expect(durable[0]).toMatchObject({ source: 'runtime', risk: 'low' });
    // An ordinary runtime audit event records as success.
    expect(durable[0]?.status).toBe('success');
  });

  it('records runtime.resolve_unknown_effect with a failure status (A2.2)', async () => {
    const { ctx } = makeCtx();
    await executeEffect(
      {
        type: 'audit_append',
        id: 'a2',
        event_type: 'runtime.resolve_unknown_effect',
        summary: 'stray resolve',
        risk: 'medium',
      },
      ctx,
    );
    const durable = await ctx.db.audit_events
      .where('type')
      .equals('runtime.resolve_unknown_effect')
      .toArray();
    expect(durable[0]).toMatchObject({
      source: 'runtime',
      risk: 'medium',
      status: 'failure',
    });
  });

  it('routes tool_call_proposal to the injected tool port', async () => {
    const tool = vi.fn();
    const { ctx } = makeCtx({ tool });
    await executeEffect(
      {
        type: 'tool_call_proposal',
        id: 't1',
        skill_id: 'web-search',
        name: 'Page Reader',
        args: { url: 'https://example.com' },
        risk: 'medium',
      },
      ctx,
    );
    expect(tool).toHaveBeenCalledOnce();
  });

  it('fails when the tool handler is missing', async () => {
    const { store, ctx } = makeCtx(); // no tool port
    await expect(
      executeEffect(
        {
          type: 'tool_call_proposal',
          id: 't1',
          skill_id: 'web-search',
          name: 'Page Reader',
          args: {},
          risk: 'medium',
        },
        ctx,
      ),
    ).rejects.toThrow(/tool/);
    expect(store.getState().runtime.status).toBe('error');
  });

  it('persists runtime_snapshot_save to Dexie', async () => {
    await db.open();
    const { ctx } = makeCtx();
    await executeEffect(
      { type: 'runtime_snapshot_save', id: 'snap-1', snapshot: { ok: true } },
      ctx,
    );
    const row = await db.runtime_snapshots.get('snap-1');
    expect(row?.snapshot).toEqual({ ok: true });
  });

  it('delegates unimplemented effects to injected ports', async () => {
    const llmRequest = vi.fn();
    const { ctx } = makeCtx({ llmRequest });
    await executeEffect(
      { type: 'llm_request', id: 'l1', conversation_id: 'c1', prompt: 'hi' },
      ctx,
    );
    expect(llmRequest).toHaveBeenCalledOnce();
  });

  it('routes a plan proposal to the plan port, failing closed if unwired (C5)', async () => {
    await db.open();
    const plan = vi.fn();
    const wired = makeCtx({ plan });
    await executeEffect(
      { type: 'script_plan_proposal', id: 'p1', plan: {} },
      wired.ctx,
    );
    expect(plan).toHaveBeenCalledOnce();

    const { store, ctx } = makeCtx();
    await expect(
      executeEffect({ type: 'script_plan_proposal', id: 'p2', plan: {} }, ctx),
    ).rejects.toThrow(/plan/);
    expect(store.getState().runtime.status).toBe('error');
  });

  it('fails closed on an unknown effect type (audited + visible)', async () => {
    await db.open();
    const { store, ctx } = makeCtx();
    await expect(
      executeEffect(
        { type: 'bogus_effect', id: 'x' } as unknown as Effect,
        ctx,
      ),
    ).rejects.toThrow(/unknown effect type/);

    // User-visible runtime error + durable failure audit — never a silent skip.
    expect(store.getState().runtime.status).toBe('error');
    const audited = await db.audit_events
      .where('type')
      .equals('runtime.effect_failed')
      .toArray();
    expect(audited.some((e) => e.status === 'failure')).toBe(true);
  });

  it('fails when the llm_request handler is missing', async () => {
    const { store, ctx } = makeCtx(); // no ports
    await expect(
      executeEffect(
        { type: 'llm_request', id: 'l1', conversation_id: 'c1', prompt: 'hi' },
        ctx,
      ),
    ).rejects.toThrow(/llm_request/);
    expect(store.getState().runtime.status).toBe('error');
  });

  it('fails when a skill handler is missing', async () => {
    const { store, ctx } = makeCtx(); // no ports
    await expect(
      executeEffect(
        { type: 'skill_state_get', id: 's1', skill_id: 'web', key: 'k' },
        ctx,
      ),
    ).rejects.toThrow(/skill/);
    expect(store.getState().runtime.status).toBe('error');
  });

  it('fails when the storage handler is missing', async () => {
    const { store, ctx } = makeCtx(); // no storage port
    await expect(
      executeEffect(
        {
          type: 'storage_put',
          id: 'p1',
          conversation_id: 'c1',
          store: 'messages',
          key: 'm1',
          value: { role: 'assistant', content: 'hi' },
        },
        ctx,
      ),
    ).rejects.toThrow(/storage/);
    expect(store.getState().runtime.status).toBe('error');
  });

  describe('F2 subsystem proposal effects', () => {
    const EFFECTS: {
      effect: Effect;
      port: keyof EffectPorts;
      match: RegExp;
    }[] = [
      {
        effect: { type: 'workspace_file_op', id: 'w1', op: {} },
        port: 'workspace',
        match: /workspace/,
      },
      {
        effect: { type: 'workspace_search', id: 'w2', query: {} },
        port: 'workspace',
        match: /workspace/,
      },
      {
        effect: { type: 'sandbox_script_proposal', id: 's1', request: {} },
        port: 'sandboxScript',
        match: /sandbox/,
      },
      {
        effect: { type: 'web_search', id: 'q1', query: 'x' },
        port: 'web',
        match: /web/,
      },
      {
        effect: { type: 'web_page_read', id: 'q2', url: 'https://x/a' },
        port: 'web',
        match: /web/,
      },
      {
        effect: { type: 'extension_request', id: 'e1', request: {} },
        port: 'extension',
        match: /extension/,
      },
    ];

    for (const { effect, port, match } of EFFECTS) {
      it(`routes ${effect.type} to the ${port} port`, async () => {
        const handler = vi.fn();
        const { ctx } = makeCtx({ [port]: handler } as EffectPorts);
        await executeEffect(effect, ctx);
        expect(handler).toHaveBeenCalledOnce();
      });

      it(`fails closed when ${effect.type} has no handler`, async () => {
        await db.open();
        const { store, ctx } = makeCtx(); // no ports
        await expect(executeEffect(effect, ctx)).rejects.toThrow(match);
        expect(store.getState().runtime.status).toBe('error');
        const audited = await db.audit_events
          .where('type')
          .equals('runtime.effect_failed')
          .toArray();
        expect(audited.some((e) => e.status === 'failure')).toBe(true);
      });
    }

    it('propagates a handler failure (resolved as an error upstream)', async () => {
      const web = vi.fn(() => Promise.reject(new Error('boom')));
      const { ctx } = makeCtx({ web });
      await expect(
        executeEffect({ type: 'web_search', id: 'q9', query: 'x' }, ctx),
      ).rejects.toThrow(/boom/);
    });
  });
});
