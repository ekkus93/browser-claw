import { describe, expect, it } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';
import appReducer from './slices/appSlice.ts';
import runtimeReducer from './slices/runtimeSlice.ts';
import providersReducer from './slices/providersSlice.ts';
import modelsReducer from './slices/modelsSlice.ts';
import storageReducer from './slices/storageSlice.ts';
import { listenerMiddleware } from './listenerMiddleware.ts';
import { runtimeReady } from './slices/runtimeSlice.ts';

/** Build a fresh store per test so cases don't share mutable state. */
function makeStore() {
  return configureStore({
    reducer: {
      app: appReducer,
      runtime: runtimeReducer,
      providers: providersReducer,
      models: modelsReducer,
      storage: storageReducer,
    },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware().prepend(listenerMiddleware.middleware),
  });
}

describe('store', () => {
  it('composes the registered slices', () => {
    const store = makeStore();
    expect(Object.keys(store.getState()).sort()).toEqual([
      'app',
      'models',
      'providers',
      'runtime',
      'storage',
    ]);
  });

  it('routes dispatched actions to the right slice', () => {
    const store = makeStore();
    store.dispatch(runtimeReady());
    expect(store.getState().runtime.status).toBe('ready');
    expect(store.getState().app.hydrated).toBe(false);
  });
});
