import type { BrowserClawDB } from '../db/db.ts';
import { DB_VERSION } from '../db/db.ts';
import { APP_VERSION } from '../lib/appMeta.ts';

/**
 * `.clawbackup` export/import over Dexie. The backup contains durable user data
 * (conversations, memories, skills + state, audit, settings, model references),
 * NOT model files. Encrypted secrets are optional and, when included, remain
 * ciphertext — plaintext never leaves the SecretVault.
 */

const BACKUP_FORMAT = 'clawbackup';

// Collections included in a backup (model_cache_index is references only).
const COLLECTIONS = [
  'app_settings',
  'provider_profiles',
  'conversations',
  'messages',
  'memories',
  'todos',
  'rules',
  'schedules',
  'skills',
  'skill_files',
  'skill_state',
  'audit_events',
  'model_catalog',
  'model_cache_index',
] as const;

export interface BackupManifest {
  format: typeof BACKUP_FORMAT;
  schemaVersion: number;
  appVersion: string;
  createdAt: number;
  includesSecrets: boolean;
}

export interface ClawBackup {
  manifest: BackupManifest;
  collections: Record<string, unknown[]>;
}

export interface BackupOptions {
  includeSecrets?: boolean;
  now?: () => number;
}

export async function exportBackup(
  db: BrowserClawDB,
  options: BackupOptions = {},
): Promise<ClawBackup> {
  const collections: Record<string, unknown[]> = {};
  for (const name of COLLECTIONS) {
    collections[name] = await db.table(name).toArray();
  }
  if (options.includeSecrets) {
    collections.encrypted_secrets = await db.encrypted_secrets.toArray();
  }
  return {
    manifest: {
      format: BACKUP_FORMAT,
      schemaVersion: DB_VERSION,
      appVersion: APP_VERSION,
      createdAt: (options.now ?? Date.now)(),
      includesSecrets: options.includeSecrets ?? false,
    },
    collections,
  };
}

export function serializeBackup(backup: ClawBackup): string {
  return JSON.stringify(backup, null, 2);
}

export type BackupSummary = Record<string, number>;

export interface ValidationResult {
  valid: boolean;
  error?: string;
  summary?: BackupSummary;
  backup?: ClawBackup;
}

export function validateBackup(data: unknown): ValidationResult {
  if (typeof data !== 'object' || data === null) {
    return { valid: false, error: 'Not a valid backup file.' };
  }
  const candidate = data as Partial<ClawBackup>;
  if (candidate.manifest?.format !== BACKUP_FORMAT) {
    return { valid: false, error: 'This is not a .clawbackup file.' };
  }
  if (
    typeof candidate.collections !== 'object' ||
    candidate.collections === null
  ) {
    return { valid: false, error: 'Backup is missing its collections.' };
  }
  const summary: BackupSummary = {};
  for (const [name, rows] of Object.entries(candidate.collections)) {
    summary[name] = Array.isArray(rows) ? rows.length : 0;
  }
  return { valid: true, summary, backup: candidate as ClawBackup };
}

export type RestoreStrategy = 'merge' | 'replace';

export async function importBackup(
  db: BrowserClawDB,
  backup: ClawBackup,
  strategy: RestoreStrategy = 'merge',
): Promise<void> {
  for (const [name, rows] of Object.entries(backup.collections)) {
    if (!Array.isArray(rows)) continue;
    const table = db.table(name);
    if (strategy === 'replace') await table.clear();
    await table.bulkPut(rows);
  }
}

export async function recordBackupHistory(
  db: BrowserClawDB,
  backup: ClawBackup,
  sizeBytes: number,
): Promise<void> {
  await db.backup_history.put({
    id: crypto.randomUUID(),
    createdAt: backup.manifest.createdAt,
    sizeBytes,
    manifestVersion: `v${backup.manifest.schemaVersion}`,
  });
}
