import { describe, expect, it } from 'vitest';
import runtimeReducer, {
  runtimeLoaded,
  runtimeReady,
  runtimeBusy,
  runtimeErrored,
  runtimeFailed,
  runtimeReset,
} from './runtimeSlice.ts';

describe('runtimeSlice', () => {
  it('starts initializing with no mode and not fatal', () => {
    const state = runtimeReducer(undefined, { type: '@@INIT' });
    expect(state).toEqual({
      status: 'initializing',
      mode: null,
      message: null,
      fatal: false,
    });
  });

  it('records which runtime loaded', () => {
    const wasm = runtimeReducer(undefined, runtimeLoaded({ mode: 'wasm' }));
    expect(wasm).toEqual({
      status: 'ready',
      mode: 'wasm',
      message: null,
      fatal: false,
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
    });
  });
});
