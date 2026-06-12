import 'fake-indexeddb/auto';
import { afterAll, describe, expect, it } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';
import auditReducer from '../store/slices/auditSlice.ts';
import approvalsReducer from '../store/slices/approvalsSlice.ts';
import { BrowserClawDB } from '../db/db.ts';
import {
  RuntimeHost,
  createRuntimeHost,
  loadLatestSnapshot,
} from './runtimeHost.ts';
import { createReferenceRuntime } from './referenceRuntime.ts';
import type { EffectContext } from './effectExecutor.ts';

const db = new BrowserClawDB();

afterAll(() => {
  db.close();
});

function makeContext() {
  const store = configureStore({
    reducer: { audit: auditReducer, approvals: approvalsReducer },
  });
  const ctx: EffectContext = { dispatch: store.dispatch, db, now: () => 1 };
  return { store, ctx };
}

describe('RuntimeHost', () => {
  it('runs the effects produced by a submitted command', async () => {
    const { store, ctx } = makeContext();
    const host = createRuntimeHost(ctx);
    await host.submit({
      type: 'submit_user_message',
      conversation_id: 'c1',
      text: 'hi',
    });
    // the audit_append effect was executed (llm_request has no port -> no-op)
    expect(store.getState().audit.recent).toHaveLength(1);
    expect(store.getState().audit.recent[0]?.type).toBe('llm_request_sent');
  });

  it('schedules a snapshot save after a submit when enabled', async () => {
    await db.open();
    const { ctx } = makeContext();
    const host = new RuntimeHost(createReferenceRuntime(), ctx, {
      snapshot: { delayMs: 0 },
    });
    await host.submit({
      type: 'submit_user_message',
      conversation_id: 'c1',
      text: 'hi',
    });
    await host.flushSnapshot();
    const snapshot = await loadLatestSnapshot(db);
    expect(snapshot?.message_count).toBe(1);
  });

  it('persists and restores a snapshot deterministically', async () => {
    await db.open();
    const { ctx } = makeContext();
    const host = createRuntimeHost(ctx);
    await host.submit({
      type: 'submit_user_message',
      conversation_id: 'c1',
      text: 'hi',
    });
    await host.saveSnapshot();

    const snapshot = await loadLatestSnapshot(db);
    expect(snapshot?.message_count).toBe(1);

    // A host restored from the snapshot continues from the same state.
    const restored = createRuntimeHost(makeContext().ctx, snapshot);
    await restored.saveSnapshot();
    const again = await loadLatestSnapshot(db);
    expect(again?.message_count).toBe(1);
    expect(again?.next_effect_id).toBe(snapshot?.next_effect_id);
  });
});
