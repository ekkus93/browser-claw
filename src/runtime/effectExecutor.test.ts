import 'fake-indexeddb/auto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';
import auditReducer from '../store/slices/auditSlice.ts';
import approvalsReducer from '../store/slices/approvalsSlice.ts';
import { BrowserClawDB } from '../db/db.ts';
import {
  executeEffect,
  type EffectContext,
  type EffectPorts,
} from './effectExecutor.ts';

const db = new BrowserClawDB();

afterAll(() => {
  db.close();
});

function makeCtx(ports?: EffectPorts) {
  const store = configureStore({
    reducer: { audit: auditReducer, approvals: approvalsReducer },
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
      id: 'a1',
      risk: 'low',
      at: 1234,
    });
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
});
