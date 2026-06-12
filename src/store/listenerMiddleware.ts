import { createListenerMiddleware, addListener } from '@reduxjs/toolkit';
import type { RootState, AppDispatch } from './store.ts';

/**
 * Listener middleware is the side-effect seam for the control plane: it
 * reacts to dispatched actions to drive effects (persist to Dexie, talk to the
 * runtime, emit audit events) without putting that logic in components or
 * reducers. Concrete listeners are registered as later phases need them.
 *
 * Decrypted secrets must never flow through actions handled here — they live
 * only in the in-memory SecretVault.
 */
export const listenerMiddleware = createListenerMiddleware();

export const startAppListening = listenerMiddleware.startListening.withTypes<
  RootState,
  AppDispatch
>();

export const addAppListener = addListener.withTypes<RootState, AppDispatch>();
