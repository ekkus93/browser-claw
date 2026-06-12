import { configureStore } from '@reduxjs/toolkit';
import bootstrapReducer from './bootstrapSlice.ts';

/**
 * Redux Toolkit is the UI/runtime control plane (transient session/run state).
 * Durable data lives in Dexie/IndexedDB; decrypted secrets live only in the
 * in-memory SecretVault and must never reach this store. The listener
 * middleware and domain slices are added in Phase 2.
 */
export const store = configureStore({
  reducer: {
    bootstrap: bootstrapReducer,
  },
});

export type AppStore = typeof store;
export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
