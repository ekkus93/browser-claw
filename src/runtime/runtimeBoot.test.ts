import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';
import runtimeReducer from '../store/slices/runtimeSlice.ts';
import {
  loadRuntimePort,
  reportRuntimeBootFailure,
  RUNTIME_BOOT_FAILED_MESSAGE,
  type RuntimeBootDeps,
} from './runtimeBoot.ts';
import { BrowserClawDB } from '../db/db.ts';
import type { ClawRuntimePort } from './referenceRuntime.ts';

const fakePort = (tag: string): ClawRuntimePort => ({
  dispatch: () => [],
  snapshot: () => ({ tag }) as never,
});

function makeDeps(overrides: Partial<RuntimeBootDeps>): RuntimeBootDeps {
  return {
    config: { isDevFallbackAllowed: false },
    createWasm: () => Promise.resolve(fakePort('wasm')),
    createReference: () => fakePort('reference'),
    onLoaded: vi.fn(),
    onFallback: vi.fn(),
    onFailed: vi.fn(),
    ...overrides,
  };
}

describe('loadRuntimePort', () => {
  it('loads the WASM runtime when it is available', async () => {
    const deps = makeDeps({});
    const result = await loadRuntimePort(deps);
    expect(result.mode).toBe('wasm');
    expect(result.port).not.toBeNull();
    expect(deps.onLoaded).toHaveBeenCalledWith('wasm');
    expect(deps.onFallback).not.toHaveBeenCalled();
    expect(deps.onFailed).not.toHaveBeenCalled();
  });

  it('fails closed (no fallback) when WASM fails and the dev flag is off', async () => {
    const createReference = vi.fn(() => fakePort('reference'));
    const deps = makeDeps({
      config: { isDevFallbackAllowed: false },
      createWasm: () => Promise.reject(new Error('no WebAssembly')),
      createReference,
    });
    const result = await loadRuntimePort(deps);
    expect(result.port).toBeNull();
    expect(result.mode).toBeNull();
    expect(createReference).not.toHaveBeenCalled();
    expect(deps.onFailed).toHaveBeenCalledOnce();
    expect(deps.onFallback).not.toHaveBeenCalled();
    expect(deps.onLoaded).not.toHaveBeenCalled();
  });

  it('uses the reference runtime only when the dev flag is on', async () => {
    const deps = makeDeps({
      config: { isDevFallbackAllowed: true },
      createWasm: () => Promise.reject(new Error('no WebAssembly')),
    });
    const result = await loadRuntimePort(deps);
    expect(result.mode).toBe('reference');
    expect(result.port).not.toBeNull();
    expect(deps.onFallback).toHaveBeenCalledOnce();
    expect(deps.onFailed).not.toHaveBeenCalled();
    expect(deps.onLoaded).not.toHaveBeenCalled();
  });
});

describe('reportRuntimeBootFailure (A2.10)', () => {
  it('shows a blocking runtime error and audits an unexpected boot failure', async () => {
    const store = configureStore({ reducer: { runtime: runtimeReducer } });
    const db = new BrowserClawDB();
    await db.open();
    await db.audit_events.clear();

    reportRuntimeBootFailure(
      { dispatch: store.dispatch, db },
      new Error('indexedDB exploded'),
    );

    const state = store.getState().runtime;
    expect(state.status).toBe('error');
    expect(state.fatal).toBe(true);
    expect(state.message).toBe(RUNTIME_BOOT_FAILED_MESSAGE);

    // Best-effort durable audit landed.
    await vi.waitFor(async () => {
      const rows = await db.audit_events
        .where('type')
        .equals('runtime.boot_failed')
        .toArray();
      expect(rows[0]?.status).toBe('failure');
      expect(rows[0]?.source).toBe('runtime');
    });
    db.close();
  });
});
