import Dexie, { type Table } from 'dexie';
import type {
  AppSettingRow,
  ProviderProfileRow,
  EncryptedSecretRow,
  ConversationRow,
  MessageRow,
  MemoryRow,
  TodoRow,
  RuleRow,
  ScheduleRow,
  SkillRow,
  SkillFileRow,
  SkillStateRow,
  AuditEventRow,
  RuntimeSnapshotRow,
  ModelCatalogRow,
  ModelCacheIndexRow,
  BackupHistoryRow,
} from './types.ts';

export const DB_NAME = 'browserclaw';
export const DB_VERSION = 1;

/**
 * Durable local storage (IndexedDB) via Dexie — the source of truth for
 * persistent data. Transient state lives in Redux; decrypted secrets live only
 * in the in-memory SecretVault. `encrypted_secrets` stores ciphertext only.
 *
 * Only string/number/date fields are indexed (IndexedDB can't key on booleans);
 * boolean flags like `enabled`/`pinned` are filtered in memory.
 *
 * Migrations: each schema change bumps DB_VERSION with a new `this.version(n)
 * .stores({...}).upgrade(...)` block below, keeping older versions intact so
 * Dexie can migrate existing databases forward.
 */
export class BrowserClawDB extends Dexie {
  app_settings!: Table<AppSettingRow, string>;
  provider_profiles!: Table<ProviderProfileRow, string>;
  encrypted_secrets!: Table<EncryptedSecretRow, string>;
  conversations!: Table<ConversationRow, string>;
  messages!: Table<MessageRow, string>;
  memories!: Table<MemoryRow, string>;
  todos!: Table<TodoRow, string>;
  rules!: Table<RuleRow, string>;
  schedules!: Table<ScheduleRow, string>;
  skills!: Table<SkillRow, string>;
  skill_files!: Table<SkillFileRow, [string, string]>;
  skill_state!: Table<SkillStateRow, [string, string]>;
  audit_events!: Table<AuditEventRow, string>;
  runtime_snapshots!: Table<RuntimeSnapshotRow, string>;
  model_catalog!: Table<ModelCatalogRow, string>;
  model_cache_index!: Table<ModelCacheIndexRow, string>;
  backup_history!: Table<BackupHistoryRow, string>;

  constructor() {
    super(DB_NAME);
    this.version(DB_VERSION).stores({
      app_settings: 'key',
      provider_profiles: 'id, kind',
      encrypted_secrets: 'id',
      conversations: 'id, updatedAt, createdAt',
      messages: 'id, conversationId, [conversationId+createdAt], createdAt',
      memories: 'id, *tags, source, createdAt',
      todos: 'id, status, createdAt',
      rules: 'id',
      schedules: 'id, nextRunAt',
      skills: 'id, source',
      skill_files: '[skillId+path], skillId',
      skill_state: '[skillId+key], skillId',
      audit_events: 'id, type, risk, at',
      runtime_snapshots: 'id, createdAt',
      model_catalog: 'id, provider',
      model_cache_index: 'id, modelId',
      backup_history: 'id, createdAt',
    });

    // First-run seed (only fires when the database is created).
    this.on('populate', (tx) => {
      void tx
        .table<AppSettingRow, string>('app_settings')
        .add({ key: 'schemaVersion', value: DB_VERSION });
    });
  }
}

export const db = new BrowserClawDB();
