import type { BrowserClawDB } from '../db/db.ts';
import type {
  AuditEventRow,
  AuditRiskLevel,
  AuditSource,
  AuditStatus,
} from '../db/types.ts';

/**
 * Durable audit log backed by IndexedDB. Every meaningful action appends an
 * event here so the log survives reloads and reflects what actually happened.
 *
 * Security: decrypted secrets must never be recorded. `details` is redacted
 * before writing (keys that look like credentials are stripped), and callers
 * should pass correlation ids — not payloads — for sensitive operations. See
 * HARDENING_NOTES.md.
 */

export interface AppendAuditInput {
  type: string;
  summary: string;
  source: AuditSource;
  risk?: AuditRiskLevel;
  status?: AuditStatus;
  /** Epoch ms; defaults to now. */
  at?: number;
  conversationId?: string;
  providerId?: string;
  skillId?: string;
  toolName?: string;
  modelId?: string;
  effectId?: string;
  runId?: string;
  details?: unknown;
  demo?: boolean;
}

export interface AuditQuery {
  type?: string;
  risk?: AuditRiskLevel;
  source?: AuditSource;
  status?: AuditStatus;
  /** Most recent first; caps the number of rows returned. */
  limit?: number;
}

const SECRET_KEY_PATTERN =
  /(api[-_]?key|token|authorization|secret|password|bearer|credential)/i;
const REDACTED = '[redacted]';

/**
 * Deep-copy `details`, replacing any value whose key looks like a credential
 * with a redaction marker. Defends the audit log against accidental secret
 * capture even when a caller passes a richer object than intended.
 */
export function redactDetails(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map((item) => redactDetails(item, depth + 1));
  }
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SECRET_KEY_PATTERN.test(key)
      ? REDACTED
      : redactDetails(val, depth + 1);
  }
  return out;
}

function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Backfill the v3 audit fields on a pre-v3 row in place. Older events predate
 * `source`/`status`, so they default to a system-sourced success. Used by the
 * Dexie v3 upgrade (see db.ts) and unit-tested directly.
 */
export function backfillAuditDefaults(row: {
  source?: AuditSource;
  status?: AuditStatus;
}): void {
  row.source ??= 'system';
  row.status ??= 'success';
}

/** Build a durable row from append input, applying defaults and redaction. */
export function buildAuditRow(input: AppendAuditInput): AuditEventRow {
  const at = input.at ?? Date.now();
  const row: AuditEventRow = {
    id: generateId(),
    type: input.type,
    summary: input.summary,
    risk: input.risk ?? 'info',
    source: input.source,
    status: input.status ?? 'success',
    at,
    timestamp: new Date(at).toISOString(),
  };
  // Only attach optional fields when provided (exactOptionalPropertyTypes).
  if (input.conversationId !== undefined)
    row.conversationId = input.conversationId;
  if (input.providerId !== undefined) row.providerId = input.providerId;
  if (input.skillId !== undefined) row.skillId = input.skillId;
  if (input.toolName !== undefined) row.toolName = input.toolName;
  if (input.modelId !== undefined) row.modelId = input.modelId;
  if (input.effectId !== undefined) row.effectId = input.effectId;
  if (input.runId !== undefined) row.runId = input.runId;
  if (input.demo !== undefined) row.demo = input.demo;
  if (input.details !== undefined) row.details = redactDetails(input.details);
  return row;
}

/** Append one durable audit event and return the stored row. */
export async function appendAuditEvent(
  db: BrowserClawDB,
  input: AppendAuditInput,
): Promise<AuditEventRow> {
  const row = buildAuditRow(input);
  await db.audit_events.put(row);
  return row;
}

/** Query durable audit events, most recent first. */
export async function queryAuditEvents(
  db: BrowserClawDB,
  query: AuditQuery = {},
): Promise<AuditEventRow[]> {
  let rows = await db.audit_events.orderBy('at').reverse().toArray();
  if (query.type !== undefined) rows = rows.filter((r) => r.type === query.type);
  if (query.risk !== undefined) rows = rows.filter((r) => r.risk === query.risk);
  if (query.source !== undefined)
    rows = rows.filter((r) => r.source === query.source);
  if (query.status !== undefined)
    rows = rows.filter((r) => r.status === query.status);
  if (query.limit !== undefined) rows = rows.slice(0, query.limit);
  return rows;
}

export async function getAuditEvent(
  db: BrowserClawDB,
  id: string,
): Promise<AuditEventRow | undefined> {
  return db.audit_events.get(id);
}

const CSV_COLUMNS = [
  'at',
  'timestamp',
  'type',
  'source',
  'status',
  'risk',
  'summary',
] as const;

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Serialize events to CSV (core columns only; never includes `details`). */
export function auditEventsToCsv(events: AuditEventRow[]): string {
  const header = CSV_COLUMNS.join(',');
  const lines = events.map((event) =>
    CSV_COLUMNS.map((col) => {
      const cell = event[col];
      return csvEscape(cell === undefined ? '' : String(cell));
    }).join(','),
  );
  return [header, ...lines].join('\n');
}

/** Export durable audit events as CSV text (most recent first). */
export async function exportAuditCsv(db: BrowserClawDB): Promise<string> {
  return auditEventsToCsv(await queryAuditEvents(db));
}
