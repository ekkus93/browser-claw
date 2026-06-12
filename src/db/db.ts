import Dexie from 'dexie';

/**
 * Durable local storage (IndexedDB) via Dexie.
 *
 * Phase 3 defines the full schema — app_settings, provider_profiles,
 * encrypted_secrets, conversations, messages, memories, todos, rules,
 * schedules, skills, skill_files, skill_state, audit_events,
 * runtime_snapshots, model_catalog, model_cache_index, backup_history —
 * plus migrations. This is the bootstrap instance with an empty schema.
 *
 * Note: `encrypted_secrets` stores ciphertext only. Decrypted secrets never
 * touch Dexie — they live solely in the in-memory SecretVault.
 */
export class BrowserClawDB extends Dexie {
  constructor() {
    super('browserclaw');
    this.version(1).stores({});
  }
}

export const db = new BrowserClawDB();
