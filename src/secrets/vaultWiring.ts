import type { Ciphertext } from './crypto.ts';
import type { VaultStore, VaultObserver, SecretRecord } from './secretVault.ts';
import type { BrowserClawDB } from '../db/db.ts';
import type { AppDispatch } from '../store/store.ts';
import {
  vaultLockedSet,
  secretMetadataUpserted,
  secretMetadataRemoved,
} from '../store/slices/secretsSlice.ts';
import { auditAppended } from '../store/slices/auditSlice.ts';
import { recordAudit } from '../audit/auditSink.ts';

/** Volatile store — keeps nothing across reloads. Useful for session-only use. */
export class InMemoryVaultStore implements VaultStore {
  #salt: string | null = null;
  #verifier: Ciphertext | null = null;
  readonly #ciphertexts = new Map<
    string,
    { label: string; value: Ciphertext }
  >();

  getSalt(): Promise<string | null> {
    return Promise.resolve(this.#salt);
  }
  setSalt(salt: string): Promise<void> {
    this.#salt = salt;
    return Promise.resolve();
  }
  getVerifier(): Promise<Ciphertext | null> {
    return Promise.resolve(this.#verifier);
  }
  setVerifier(verifier: Ciphertext): Promise<void> {
    this.#verifier = verifier;
    return Promise.resolve();
  }
  getCiphertext(id: string): Promise<Ciphertext | null> {
    return Promise.resolve(this.#ciphertexts.get(id)?.value ?? null);
  }
  putCiphertext(id: string, label: string, value: Ciphertext): Promise<void> {
    this.#ciphertexts.set(id, { label, value });
    return Promise.resolve();
  }
  deleteCiphertext(id: string): Promise<void> {
    this.#ciphertexts.delete(id);
    return Promise.resolve();
  }
  listEncryptedMeta(): Promise<SecretRecord[]> {
    return Promise.resolve(
      [...this.#ciphertexts.entries()].map(([id, { label }]) => ({
        id,
        label,
        storageMode: 'encrypted' as const,
      })),
    );
  }
}

const SALT_KEY = 'vaultSalt';
const VERIFIER_KEY = 'vaultVerifier';

/** Durable store backed by Dexie. Persists ciphertext + IV only. */
export function createDexieVaultStore(db: BrowserClawDB): VaultStore {
  return {
    async getSalt() {
      const row = await db.app_settings.get(SALT_KEY);
      return typeof row?.value === 'string' ? row.value : null;
    },
    async setSalt(salt) {
      await db.app_settings.put({ key: SALT_KEY, value: salt });
    },
    async getVerifier() {
      const row = await db.app_settings.get(VERIFIER_KEY);
      return (row?.value as Ciphertext | undefined) ?? null;
    },
    async setVerifier(verifier) {
      await db.app_settings.put({ key: VERIFIER_KEY, value: verifier });
    },
    async getCiphertext(id) {
      const row = await db.encrypted_secrets.get(id);
      return row ? { ciphertext: row.ciphertext, iv: row.iv } : null;
    },
    async putCiphertext(id, label, value) {
      await db.encrypted_secrets.put({
        id,
        label,
        storageMode: 'encrypted',
        ciphertext: value.ciphertext,
        iv: value.iv,
      });
    },
    async deleteCiphertext(id) {
      await db.encrypted_secrets.delete(id);
    },
    async listEncryptedMeta() {
      const rows = await db.encrypted_secrets.toArray();
      return rows.map((row) => ({
        id: row.id,
        label: row.label,
        storageMode: 'encrypted' as const,
      }));
    },
  };
}

/**
 * Bridges the vault to Redux. Forwards lock state, secret METADATA, and audit
 * events only — plaintext never reaches this adapter. When a `db` is provided,
 * vault audit events (unlock/lock/unlock_failed/deleted) are persisted durably
 * via recordAudit (which also updates the live tail); without it they go to the
 * live tail only (used by unit tests that don't need durability).
 */
export function createReduxVaultObserver(
  dispatch: AppDispatch,
  db?: BrowserClawDB,
): VaultObserver {
  return {
    lockStateChanged(locked) {
      dispatch(vaultLockedSet(locked));
    },
    secretUpserted(record) {
      dispatch(secretMetadataUpserted(record));
    },
    secretRemoved(id) {
      dispatch(secretMetadataRemoved(id));
    },
    audit(event) {
      if (db) {
        void recordAudit(db, dispatch, {
          type: event.type,
          summary: event.summary,
          source: 'user',
          risk: event.risk,
          status: event.status ?? 'success',
        });
        return;
      }
      dispatch(
        auditAppended({
          id: crypto.randomUUID(),
          type: event.type,
          summary: event.summary,
          risk: event.risk,
          at: Date.now(),
        }),
      );
    },
  };
}
