import { describe, expect, it } from 'vitest';
import runtimeReducer, {
  runtimeLoaded,
  runtimeReady,
  runtimeBusy,
  runtimeErrored,
  runtimeFailed,
  runtimeReset,
  snapshotRestoreWarned,
  snapshotWarningDismissed,
} from './runtimeSlice.ts';

describe('runtimeSlice', () => {
  it('starts initializing with no mode and not fatal', () => {
    const state = runtimeReducer(undefined, { type: '@@INIT' });
    expect(state).toEqual({
      status: 'initializing',
      mode: null,
      message: null,
      fatal: false,
      snapshotIssue: null,
    });
  });

  it('records which runtime loaded', () => {
    const wasm = runtimeReducer(undefined, runtimeLoaded({ mode: 'wasm' }));
    expect(wasm).toEqual({
      status: 'ready',
      mode: 'wasm',
      message: null,
      fatal: false,
      snapshotIssue: null,
    });

    const ref = runtimeReducer(undefined, runtimeLoaded({ mode: 'reference' }));
    expect(ref.mode).toBe('reference');
    expect(ref.status).toBe('ready');
  });

  it('transitions through lifecycle actions', () => {
    let state = runtimeReducer(undefined, runtimeReady());
    expect(state.status).toBe('ready');

    state = runtimeReducer(state, runtimeBusy('Loading model'));
    expect(state.status).toBe('busy');
    expect(state.message).toBe('Loading model');

    state = runtimeReducer(state, runtimeErrored('WASM trap'));
    expect(state.status).toBe('error');
    expect(state.message).toBe('WASM trap');

    state = runtimeReducer(state, runtimeReset());
    expect(state).toEqual({
      status: 'initializing',
      mode: null,
      message: null,
      fatal: false,
      snapshotIssue: null,
    });
  });

  it('marks a boot failure fatal and clears the mode', () => {
    const loaded = runtimeReducer(undefined, runtimeLoaded({ mode: 'wasm' }));
    const failed = runtimeReducer(loaded, runtimeFailed('WASM failed to load'));
    expect(failed).toEqual({
      status: 'error',
      mode: null,
      message: 'WASM failed to load',
      fatal: true,
      snapshotIssue: null,
    });
  });

  it('flags a snapshot restore issue and survives a later runtime load', () => {
    // The boot sequence warns BEFORE the (fresh) runtime loads, so a successful
    // load must not wipe the warning — the user still needs to see it.
    let state = runtimeReducer(undefined, snapshotRestoreWarned('incompatible'));
    expect(state.snapshotIssue).toBe('incompatible');
    state = runtimeReducer(state, runtimeLoaded({ mode: 'wasm' }));
    expect(state.snapshotIssue).toBe('incompatible');
  });

  it('clears the snapshot issue on dismiss and on reset', () => {
    let state = runtimeReducer(
      undefined,
      snapshotRestoreWarned('restore_failed'),
    );
    expect(state.snapshotIssue).toBe('restore_failed');
    state = runtimeReducer(state, snapshotWarningDismissed());
    expect(state.snapshotIssue).toBeNull();

    const reset = runtimeReducer(
      runtimeReducer(undefined, snapshotRestoreWarned('incompatible')),
      runtimeReset(),
    );
    expect(reset.snapshotIssue).toBeNull();
  });
});
