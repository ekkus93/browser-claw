import { SecretVault } from './secretVault.ts';
import {
  createDexieVaultStore,
  createReduxVaultObserver,
} from './vaultWiring.ts';
import { db } from '../db/db.ts';
import { store } from '../store/store.ts';

/**
 * The app-wide SecretVault singleton — the ONLY place decrypted API keys live.
 *
 * Backed by Dexie for ciphertext persistence and bridged to Redux for lock
 * state + secret METADATA (never plaintext). Provider calls read keys from here
 * at call time via `resolveApiKey`. Starts locked; an unlock/setup UI lands in a
 * later pass (TODO 2.3 secrets screen).
 */
export const secretVault = new SecretVault({
  store: createDexieVaultStore(db),
  observer: createReduxVaultObserver(store.dispatch),
});
