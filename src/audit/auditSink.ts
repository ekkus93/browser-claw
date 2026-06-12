import type { BrowserClawDB } from '../db/db.ts';
import type { AppDispatch } from '../store/store.ts';
import type { AuditEventRow } from '../db/types.ts';
import { auditAppended } from '../store/slices/auditSlice.ts';
import { buildAuditRow, type AppendAuditInput } from './auditService.ts';

/**
 * Record one audit event everywhere it belongs: durably in IndexedDB (the
 * source of truth, survives reload) and on the in-memory Redux tail (the live
 * inspector feed). The Redux dispatch happens synchronously so callers that
 * only need the live feed don't have to await; the returned promise resolves
 * once the durable write lands. Details are redacted by `buildAuditRow`.
 */
export function recordAudit(
  db: BrowserClawDB,
  dispatch: AppDispatch,
  input: AppendAuditInput,
): Promise<AuditEventRow> {
  const row = buildAuditRow(input);
  dispatch(
    auditAppended({
      id: row.id,
      type: row.type,
      summary: row.summary,
      risk: row.risk,
      at: row.at,
    }),
  );
  return db.audit_events.put(row).then(() => row);
}
