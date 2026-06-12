import { configureStore } from '@reduxjs/toolkit';
import appReducer from './slices/appSlice.ts';
import runtimeReducer from './slices/runtimeSlice.ts';
import providersReducer from './slices/providersSlice.ts';
import modelsReducer from './slices/modelsSlice.ts';
import storageReducer from './slices/storageSlice.ts';
import { listenerMiddleware } from './listenerMiddleware.ts';

/**
 * Redux Toolkit is the UI/runtime control plane (transient session/run state).
 * Durable data lives in Dexie/IndexedDB; decrypted secrets live only in the
 * in-memory SecretVault and must never be stored here. Domain slices are added
 * across Phase 2; the listener middleware drives side effects.
 */
export const store = configureStore({
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

export type AppStore = typeof store;
export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
