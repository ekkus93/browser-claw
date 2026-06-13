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
  });

  it('routes tool_call_proposal into the approval queue', async () => {
    const { store, ctx } = makeCtx();
    await executeEffect(
      {
        type: 'tool_call_proposal',
        id: 't1',
        name: 'writeFile',
        args: { path: '/x' },
        risk: 'high',
      },
      ctx,
    );
    expect(store.getState().approvals.queue[0]).toMatchObject({
      id: 't1',
      kind: 'tool_call',
      risk: 'high',
      status: 'pending',
    });
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

  it('records (never silently drops) a storage effect with no handler', async () => {
    await db.open();
    await db.audit_events.clear();
    const { ctx } = makeCtx(); // no storage port
    // It must not throw (the chat flow persists messages via the llm handler),
    // but the dropped effect must be audited, not silently swallowed.
    await executeEffect(
      {
        type: 'storage_put',
        id: 'p1',
        conversation_id: 'c1',
        store: 'messages',
        key: 'm1',
        value: { role: 'assistant', content: 'hi' },
      },
      ctx,
    );
    const dropped = await db.audit_events
      .where('type')
      .equals('runtime.effect_dropped')
      .toArray();
    expect(dropped).toHaveLength(1);
    expect(dropped[0]?.status).toBe('failure');
  });
});
