import Dexie, { type Table } from 'dexie';
import { backfillAuditDefaults, buildAuditRow } from '../audit/auditService.ts';
import { isSkillPermissions } from '../skills/skillTypes.ts';
import {
  SAMPLE_MEMORIES,
  isUnmodifiedSampleMemory,
} from '../memories/sampleMemories.ts';
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
  SkillOutputRow,
  SkillStateRow,
  SkillPermissionsRow,
  AuditEventRow,
  RuntimeSnapshotRow,
  ModelCatalogRow,
  ModelCacheIndexRow,
  ModelBlobRow,
  BackupHistoryRow,
  SearchProviderProfileRow,
} from './types.ts';
import type { WorkspaceFileMeta } from '../workspace/types.ts';

export const DB_NAME = 'browserclaw';
export const DB_VERSION = 8;

/** The old (pre-v5) key under which permissions lived inside skill_state. */
const LEGACY_PERMISSIONS_KEY = '__permissions__';

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
  search_provider_profiles!: Table<SearchProviderProfileRow, string>;
  encrypted_secrets!: Table<EncryptedSecretRow, string>;
  conversations!: Table<ConversationRow, string>;
  messages!: Table<MessageRow, string>;
  memories!: Table<MemoryRow, string>;
  todos!: Table<TodoRow, string>;
  rules!: Table<RuleRow, string>;
  schedules!: Table<ScheduleRow, string>;
  skills!: Table<SkillRow, string>;
  skill_files!: Table<SkillFileRow, [string, string]>;
  skill_outputs!: Table<SkillOutputRow, [string, string]>;
  skill_state!: Table<SkillStateRow, [string, string]>;
  skill_permissions!: Table<SkillPermissionsRow, string>;
  audit_events!: Table<AuditEventRow, string>;
  runtime_snapshots!: Table<RuntimeSnapshotRow, string>;
  model_catalog!: Table<ModelCatalogRow, string>;
  model_cache_index!: Table<ModelCacheIndexRow, string>;
  model_blobs!: Table<ModelBlobRow, string>;
  backup_history!: Table<BackupHistoryRow, string>;
  workspace_files!: Table<WorkspaceFileMeta, string>;

  constructor() {
    super(DB_NAME);

    // v1 — initial schema.
    this.version(1).stores({
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

    // v2 — cache downloaded model bytes for browsers without OPFS. Dexie keeps
    // every v1 table; only the delta is declared here. No data upgrade needed.
    this.version(2).stores({
      model_blobs: 'modelId, cachedAt',
    });

    // v3 — reconciled durable audit schema: index source/status for queries and
    // backfill them on existing rows (older events predate these fields).
    this.version(3)
      .stores({
        audit_events: 'id, type, risk, at, source, status',
      })
      .upgrade(async (tx) => {
        await tx
          .table<AuditEventRow, string>('audit_events')
          .toCollection()
          .modify((row) => {
            backfillAuditDefaults(row);
          });
      });

    // v4 — one-time cleanup: remove the old unconditionally-seeded sample
    // memories from real storage. Only untouched seeds are deleted; anything
    // the user edited is left alone. (replies1.md Q6 / TODO 5.2.)
    this.version(4).upgrade(async (tx) => {
      const table = tx.table<MemoryRow, string>('memories');
      for (const sample of SAMPLE_MEMORIES) {
        const row = await table.get(sample.id);
        if (row && isUnmodifiedSampleMemory(row)) {
          await table.delete(sample.id);
        }
      }
    });

    // v5 — move skill permissions into a PROTECTED store (hardening A1.2): they
    // must not live in the mutable `skill_state` table a skill can influence.
    // Copy each `__permissions__` row to `skill_permissions`, validate its
    // shape, then delete the old row. A malformed blob is NOT copied (fail
    // closed — the skill simply has no permissions until reinstalled) and the
    // failure is audited durably.
    this.version(5)
      .stores({
        skill_permissions: 'skillId',
      })
      .upgrade(async (tx) => {
        const stateTable = tx.table<SkillStateRow, [string, string]>(
          'skill_state',
        );
        const permTable = tx.table<SkillPermissionsRow, string>(
          'skill_permissions',
        );
        const auditTable = tx.table<AuditEventRow, string>('audit_events');
        // `key` is not a standalone index (the store is keyed on
        // [skillId+key]), so scan and filter rather than `.where('key')`.
        const legacy = await stateTable
          .filter((row) => row.key === LEGACY_PERMISSIONS_KEY)
          .toArray();
        for (const row of legacy) {
          if (isSkillPermissions(row.value)) {
            await permTable.put({ skillId: row.skillId, value: row.value });
          } else {
            await auditTable.add(
              buildAuditRow({
                type: 'skill.permissions_migration_failed',
                summary: `Dropped malformed permissions for skill ${row.skillId} during migration`,
                source: 'skill',
                risk: 'medium',
                status: 'failure',
                skillId: row.skillId,
              }),
            );
          }
          await stateTable.delete([row.skillId, LEGACY_PERMISSIONS_KEY]);
        }
      });

    // v6 — separate, writable store for skill-generated artifacts (hardening
    // A1.3) so installed package assets (`skill_files`) stay read-only. New
    // table only; no data to migrate.
    this.version(6).stores({
      skill_outputs: '[skillId+path], skillId',
    });

    // v7 — workspace filesystem metadata (Part B). File BYTES live in OPFS via
    // the ContentStore; this table holds metadata only, keyed by id with a
    // unique path and indexes for listing/sorting. New table; nothing to migrate.
    this.version(7).stores({
      workspace_files: 'id, &path, kind, updatedAt, *tags',
    });

    // v8 — search provider profiles (Part E2). Stores the Brave Search provider
    // config (kind, label, apiKeyMode). The API key lives in encrypted_secrets.
    // New table; nothing to migrate.
    this.version(8).stores({
      search_provider_profiles: 'id, kind',
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
