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
import {
  createReferenceRuntime,
  SNAPSHOT_SCHEMA_VERSION,
} from './referenceRuntime.ts';
import type { EffectContext } from './effectExecutor.ts';

const db = new BrowserClawDB();

afterAll(() => {
  db.close();
});

function makeContext() {
  const store = configureStore({
    reducer: { audit: auditReducer, approvals: approvalsReducer },
  });
  // A no-op llm_request handler: these tests exercise the host loop and
  // snapshots, not the provider call. The handler must be present, though —
  // a missing one is now fatal (TODO 1.2), so leaving it out would (correctly)
  // throw instead of silently skipping the effect.
  const ctx: EffectContext = {
    dispatch: store.dispatch,
    db,
    now: () => 1,
    ports: { llmRequest: () => undefined },
  };
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
    // the audit_append effect ran; llm_request went to the no-op stub handler
    expect(store.getState().audit.recent).toHaveLength(1);
    expect(store.getState().audit.recent[0]?.type).toBe('llm_request_sent');
  });

  it('records effect emitted/resolved lifecycle audits only when verbose is on', async () => {
    await db.open();
    await db.audit_events.clear();
    const { store, ctx } = makeContext();
    const host = new RuntimeHost(createReferenceRuntime(), ctx, {
      auditEffects: () => true,
    });

    // A user message emits an audit_append (terminal, excluded) + an llm_request.
    await host.submit({
      type: 'submit_user_message',
      conversation_id: 'c1',
      text: 'hi',
    });
    const emitted = store
      .getState()
      .audit.recent.filter((e) => e.type === 'runtime.effect_emitted');
    // The llm_request is audited as emitted; the audit_append is NOT (terminal).
    expect(emitted).toHaveLength(1);

    // Resolving that effect with a failure records a failed lifecycle event.
    await host.submit({
      type: 'resolve_effect',
      id: 'eff-2',
      result: { ok: false, error: { kind: 'auth' } },
    });
    expect(
      store
        .getState()
        .audit.recent.some((e) => e.type === 'runtime.effect_failed'),
    ).toBe(true);
  });

  it('records no lifecycle audits when verbose is off (default)', async () => {
    await db.open();
    await db.audit_events.clear();
    const { store, ctx } = makeContext();
    const host = createRuntimeHost(ctx); // no auditEffects predicate

    await host.submit({
      type: 'submit_user_message',
      conversation_id: 'c1',
      text: 'hi',
    });
    expect(
      store
        .getState()
        .audit.recent.some((e) => e.type.startsWith('runtime.effect_')),
    ).toBe(false);
  });

  it('flushes a snapshot when a fatal effect error halts the turn', async () => {
    await db.open();
    await db.runtime_snapshots.clear();
    // ctx has an llm_request stub but NO storage port.
    const { ctx } = makeContext();
    const host = new RuntimeHost(createReferenceRuntime(), ctx, {
      // Long delay so the normal debounced save does NOT fire during the test —
      // any snapshot that appears must come from the error flush.
      snapshot: { delayMs: 10000 },
    });
    await host.submit({
      type: 'submit_user_message',
      conversation_id: 'c1',
      text: 'hi',
    });
    await db.runtime_snapshots.clear();

    // Resolving the llm_request makes the runtime emit a storage_put, which has
    // no handler -> failEffect throws. The host must persist state first.
    await expect(
      host.submit({
        type: 'resolve_effect',
        id: 'eff-2',
        result: { ok: true, text: 'hi' },
      }),
    ).rejects.toThrow();

    const load = await loadLatestSnapshot(db);
    expect(load.status).toBe('ok');
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
    const load = await loadLatestSnapshot(db);
    expect(load.status).toBe('ok');
    expect(load.status === 'ok' && load.snapshot.message_count).toBe(1);
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

    const load = await loadLatestSnapshot(db);
    expect(load.status).toBe('ok');
    if (load.status !== 'ok') return;
    expect(load.snapshot.message_count).toBe(1);

    // A host restored from the snapshot continues from the same state.
    const restored = createRuntimeHost(makeContext().ctx, load.snapshot);
    await restored.saveSnapshot();
    const again = await loadLatestSnapshot(db);
    expect(again.status === 'ok' && again.snapshot.message_count).toBe(1);
    expect(again.status === 'ok' && again.snapshot.next_effect_id).toBe(
      load.snapshot.next_effect_id,
    );
  });

  it('discards an incompatible snapshot instead of restoring it', async () => {
    await db.open();
    // A snapshot stamped with a different schema version must never be restored
    // — it would silently corrupt runtime state. It is dropped and reported.
    await db.runtime_snapshots.put({
      id: 'latest',
      createdAt: 1,
      version: SNAPSHOT_SCHEMA_VERSION + 1,
      snapshot: { next_effect_id: 9, message_count: 9, pending: {} },
    });

    const load = await loadLatestSnapshot(db);
    expect(load).toEqual({
      status: 'incompatible',
      foundVersion: SNAPSHOT_SCHEMA_VERSION + 1,
    });
    // The bad snapshot is removed so it cannot fail the same way on every boot.
    expect(await db.runtime_snapshots.get('latest')).toBeUndefined();
  });

  it('treats a pre-versioning snapshot as incompatible', async () => {
    await db.open();
    // Rows written before snapshot versioning have no version field; they
    // cannot be proven compatible, so they are discarded rather than trusted.
    await db.runtime_snapshots.put({
      id: 'latest',
      createdAt: 1,
      snapshot: { next_effect_id: 3, message_count: 3, pending: {} },
    });

    const load = await loadLatestSnapshot(db);
    expect(load).toEqual({ status: 'incompatible', foundVersion: undefined });
    expect(await db.runtime_snapshots.get('latest')).toBeUndefined();
  });
});
