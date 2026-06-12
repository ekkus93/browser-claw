import type { BrowserClawDB } from '../db/db.ts';
import { DB_VERSION } from '../db/db.ts';
import { APP_VERSION } from '../lib/appMeta.ts';
import type { AppDispatch } from '../store/store.ts';
import { recordAudit } from '../audit/auditSink.ts';

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

/**
 * Serialize to JSONL: the first line is the manifest, then one line per record
 * (`{"collection": name, "row": {...}}`). This streams well for large
 * collections, where a single JSON array would have to be held in memory.
 */
export function serializeBackup(backup: ClawBackup): string {
  const lines: string[] = [JSON.stringify({ manifest: backup.manifest })];
  for (const [name, rows] of Object.entries(backup.collections)) {
    for (const row of rows) {
      lines.push(JSON.stringify({ collection: name, row }));
    }
  }
  return `${lines.join('\n')}\n`;
}

interface BackupLine {
  manifest?: BackupManifest;
  collection?: string;
  row?: unknown;
  collections?: Record<string, unknown[]>;
}

/**
 * Parse a backup file back into a ClawBackup. Accepts the JSONL format and,
 * for backward compatibility, a single JSON document. Throws if no manifest is
 * present.
 */
export function parseBackup(text: string): ClawBackup {
  const trimmed = text.trim();

  // Legacy single-document JSON format.
  try {
    const whole = JSON.parse(trimmed) as BackupLine;
    if (whole.manifest && whole.collections) {
      return { manifest: whole.manifest, collections: whole.collections };
    }
  } catch {
    // Not a single JSON document — fall through to JSONL parsing.
  }

  let manifest: BackupManifest | undefined;
  const collections: Record<string, unknown[]> = {};
  for (const line of trimmed.split('\n')) {
    const value = line.trim();
    if (value.length === 0) continue;
    const parsed = JSON.parse(value) as BackupLine;
    if (parsed.manifest) {
      manifest = parsed.manifest;
    } else if (typeof parsed.collection === 'string') {
      (collections[parsed.collection] ??= []).push(parsed.row);
    }
  }
  if (!manifest) {
    throw new Error('Backup is missing its manifest.');
  }
  return { manifest, collections };
}

export type BackupSummary = Record<string, number>;

export interface ValidationResult {
  valid: boolean;
  error?: string;
  summary?: BackupSummary;
  backup?: ClawBackup;
}

/** Collections an import is allowed to write (the export set + ciphertext). */
const ALLOWED_COLLECTIONS = new Set<string>([
  ...COLLECTIONS,
  'encrypted_secrets',
]);

/** Primary-key fields every row in a collection must carry. */
const KEY_FIELDS: Record<string, string[]> = {
  app_settings: ['key'],
  skill_files: ['skillId', 'path'],
  skill_state: ['skillId', 'key'],
};

function keyFieldsFor(name: string): string[] {
  return KEY_FIELDS[name] ?? ['id'];
}

export interface BackupLimits {
  maxRowsPerCollection: number;
  maxTotalRows: number;
  /** Serialized size of a single row. */
  maxRowBytes: number;
  /** Serialized size of all collections combined. */
  maxTotalBytes: number;
}

export const DEFAULT_BACKUP_LIMITS: BackupLimits = {
  maxRowsPerCollection: 200_000,
  maxTotalRows: 1_000_000,
  maxRowBytes: 2_000_000,
  maxTotalBytes: 200_000_000,
};

// Field names (normalized) that hold a raw plaintext secret in our schema only
// by mistake. `apiKeyMode` (an enum) and `encryptedSecretId` (a reference) are
// deliberately NOT here — they are legitimate, secret-free fields.
const PLAINTEXT_SECRET_FIELDS = new Set([
  'apikey',
  'accesstoken',
  'refreshtoken',
  'clientsecret',
  'secretkey',
  'privatekey',
  'password',
  'passwd',
  'plaintext',
]);

// Value shapes that look like live credentials regardless of field name.
const SECRET_VALUE_PATTERNS = [
  /sk-ant-[A-Za-z0-9-]{16,}/, // Anthropic
  /sk-[A-Za-z0-9-]{16,}/, // OpenAI-style
  /xox[baprs]-[A-Za-z0-9-]{10,}/, // Slack
  /AKIA[0-9A-Z]{16}/, // AWS access key id
  /ghp_[A-Za-z0-9]{20,}/, // GitHub PAT
  /ya29\.[A-Za-z0-9._-]{20,}/, // Google OAuth
  /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/, // JWT
];

function normalizeFieldName(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * True if `value` (a row or any nested value) appears to embed a raw decrypted
 * secret — either a known plaintext-secret field holding a non-empty string, or
 * any string whose shape matches a live credential. Our own export never writes
 * plaintext (secrets live in `encrypted_secrets` as ciphertext only), so a hit
 * means a foreign or tampered backup and we refuse it.
 */
export function containsLikelyRawSecret(value: unknown, depth = 0): boolean {
  if (depth > 6 || value === null || typeof value !== 'object') {
    return typeof value === 'string'
      ? SECRET_VALUE_PATTERNS.some((re) => re.test(value))
      : false;
  }
  if (Array.isArray(value)) {
    return value.some((item) => containsLikelyRawSecret(item, depth + 1));
  }
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (
      PLAINTEXT_SECRET_FIELDS.has(normalizeFieldName(key)) &&
      typeof val === 'string' &&
      val.trim().length > 0
    ) {
      return true;
    }
    if (containsLikelyRawSecret(val, depth + 1)) return true;
  }
  return false;
}

function isPlainRow(row: unknown): row is Record<string, unknown> {
  return typeof row === 'object' && row !== null && !Array.isArray(row);
}

export function validateBackup(
  data: unknown,
  limits: Partial<BackupLimits> = {},
): ValidationResult {
  const lim = { ...DEFAULT_BACKUP_LIMITS, ...limits };
  if (typeof data !== 'object' || data === null) {
    return { valid: false, error: 'Not a valid backup file.' };
  }
  const candidate = data as Partial<ClawBackup>;
  if (candidate.manifest?.format !== BACKUP_FORMAT) {
    return { valid: false, error: 'This is not a .clawbackup file.' };
  }

  // Schema-version compatibility: refuse a backup written by a newer schema we
  // don't understand. Older versions are accepted (Dexie migrates the DB).
  const schemaVersion = candidate.manifest.schemaVersion;
  if (typeof schemaVersion !== 'number' || !Number.isFinite(schemaVersion)) {
    return { valid: false, error: 'Backup manifest has no schema version.' };
  }
  if (schemaVersion > DB_VERSION) {
    return {
      valid: false,
      error: `Backup schema v${schemaVersion} is newer than this app (v${DB_VERSION}); upgrade BrowserClaw to import it.`,
    };
  }

  if (
    typeof candidate.collections !== 'object' ||
    candidate.collections === null ||
    Array.isArray(candidate.collections)
  ) {
    return { valid: false, error: 'Backup is missing its collections.' };
  }

  const summary: BackupSummary = {};
  let totalRows = 0;
  let totalBytes = 0;

  for (const [name, rows] of Object.entries(candidate.collections)) {
    if (!ALLOWED_COLLECTIONS.has(name)) {
      return { valid: false, error: `Unknown backup collection: ${name}.` };
    }
    if (!Array.isArray(rows)) {
      return {
        valid: false,
        error: `Collection ${name} is not a list of records.`,
      };
    }
    if (rows.length > lim.maxRowsPerCollection) {
      return {
        valid: false,
        error: `Collection ${name} has ${rows.length} records, over the ${lim.maxRowsPerCollection} limit.`,
      };
    }

    const required = keyFieldsFor(name);
    for (const row of rows) {
      if (!isPlainRow(row)) {
        return { valid: false, error: `Malformed record in ${name}.` };
      }
      for (const field of required) {
        if (typeof row[field] !== 'string' || row[field] === '') {
          return {
            valid: false,
            error: `Record in ${name} is missing its key field "${field}".`,
          };
        }
      }
      const serialized = JSON.stringify(row);
      if (serialized.length > lim.maxRowBytes) {
        return {
          valid: false,
          error: `A record in ${name} exceeds the ${lim.maxRowBytes}-byte size limit.`,
        };
      }
      if (containsLikelyRawSecret(row)) {
        return {
          valid: false,
          error: `Record in ${name} looks like it contains a raw decrypted secret; refusing to import.`,
        };
      }
      totalBytes += serialized.length;
      if (totalBytes > lim.maxTotalBytes) {
        return {
          valid: false,
          error: `Backup exceeds the ${lim.maxTotalBytes}-byte total size limit.`,
        };
      }
    }

    totalRows += rows.length;
    if (totalRows > lim.maxTotalRows) {
      return {
        valid: false,
        error: `Backup exceeds the ${lim.maxTotalRows}-record total limit.`,
      };
    }
    summary[name] = rows.length;
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

const BACKUP_FILENAME = 'browserclaw-backup.clawbackup';

export interface BackupExportDeps {
  db: BrowserClawDB;
  dispatch: AppDispatch;
  /**
   * Perform the actual file download. MUST throw if the browser can't produce
   * the file — that throw is how we learn the export didn't really happen.
   */
  download: (filename: string, json: string) => void;
  includeSecrets?: boolean;
  now?: () => number;
}

export interface BackupExportResult {
  ok: boolean;
  sizeBytes?: number;
  error?: string;
}

/**
 * Export a backup honestly: build + serialize, attempt the download, and only
 * record history + a success audit AFTER the download actually succeeds. If the
 * download throws (e.g. no `createObjectURL`), audit a failure and record
 * NOTHING — the user must never see a "saved" backup that was never written.
 * (Hardening TODO 6.3.)
 */
export async function runBackupExport(
  deps: BackupExportDeps,
): Promise<BackupExportResult> {
  const now = deps.now ?? Date.now;
  const backup = await exportBackup(deps.db, {
    ...(deps.includeSecrets !== undefined
      ? { includeSecrets: deps.includeSecrets }
      : {}),
    ...(deps.now ? { now: deps.now } : {}),
  });
  const json = serializeBackup(backup);
  const sizeBytes = new Blob([json]).size;
  const plaintext = !backup.manifest.includesSecrets;

  try {
    deps.download(BACKUP_FILENAME, json);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    void recordAudit(deps.db, deps.dispatch, {
      type: 'backup.export_failed',
      summary: `Backup export failed: ${message}`,
      source: 'backup',
      risk: 'low',
      status: 'failure',
      at: now(),
    });
    return { ok: false, error: message };
  }

  // Download succeeded — now (and only now) it's a real backup.
  await recordBackupHistory(deps.db, backup, sizeBytes);
  void recordAudit(deps.db, deps.dispatch, {
    type: 'backup.exported',
    summary: `Backup exported (${sizeBytes} bytes, ${
      plaintext ? 'plaintext' : 'includes encrypted secrets'
    })`,
    source: 'backup',
    risk: plaintext ? 'low' : 'medium',
    status: 'success',
    at: now(),
  });
  return { ok: true, sizeBytes };
}
