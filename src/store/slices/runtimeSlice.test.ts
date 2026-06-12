import { describe, expect, it } from 'vitest';
import runtimeReducer, {
  runtimeReady,
  runtimeBusy,
  runtimeErrored,
  runtimeReset,
} from './runtimeSlice.ts';

describe('runtimeSlice', () => {
  it('starts initializing', () => {
    const state = runtimeReducer(undefined, { type: '@@INIT' });
    expect(state).toEqual({ status: 'initializing', message: null });
  });

  it('transitions through lifecycle actions', () => {
    let state = runtimeReducer(undefined, runtimeReady());
    expect(state.status).toBe('ready');

    state = runtimeReducer(state, runtimeBusy('Loading model'));
    expect(state).toEqual({ status: 'busy', message: 'Loading model' });

    state = runtimeReducer(state, runtimeErrored('WASM trap'));
    expect(state).toEqual({ status: 'error', message: 'WASM trap' });

    state = runtimeReducer(state, runtimeReset());
    expect(state).toEqual({ status: 'initializing', message: null });
  });
});
