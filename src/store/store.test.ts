import { describe, expect, it } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';
import appReducer from './slices/appSlice.ts';
import runtimeReducer from './slices/runtimeSlice.ts';
import { listenerMiddleware } from './listenerMiddleware.ts';
import { runtimeReady } from './slices/runtimeSlice.ts';

/** Build a fresh store per test so cases don't share mutable state. */
function makeStore() {
  return configureStore({
    reducer: { app: appReducer, runtime: runtimeReducer },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware().prepend(listenerMiddleware.middleware),
  });
}

describe('store', () => {
  it('composes the app and runtime slices', () => {
    const store = makeStore();
    expect(store.getState()).toEqual({
      app: {
        hydrated: false,
        onboardingComplete: false,
        activeWorkspaceId: null,
      },
      runtime: { status: 'initializing', message: null },
    });
  });

  it('routes dispatched actions to the right slice', () => {
    const store = makeStore();
    store.dispatch(runtimeReady());
    expect(store.getState().runtime.status).toBe('ready');
    expect(store.getState().app.hydrated).toBe(false);
  });
});
