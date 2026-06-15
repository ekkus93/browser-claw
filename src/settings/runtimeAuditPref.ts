import type { BrowserClawDB } from '../db/db.ts';
import { getSetting, setSetting } from './appSettings.ts';

/**
 * "Verbose runtime audit" preference: when on, the RuntimeHost records a
 * lifecycle audit (runtime.effect_emitted / runtime.effect_resolved) for each
 * non-terminal effect. Default OFF so the audit log isn't flooded with one or
 * more events per effect — it's an opt-in diagnostic.
 *
 * The flag is mirrored in a synchronous in-memory cache because the host's
 * per-effect path can't await an IndexedDB read; the cache is the single source
 * the host reads, kept in sync by load-on-boot and write-through on change.
 */
export const VERBOSE_RUNTIME_AUDIT_KEY = 'verboseRuntimeAudit';

let cache = false;

/** Synchronous read of the current setting (used by the runtime host loop). */
export function isEffectAuditEnabled(): boolean {
  return cache;
}

/** Load the persisted value into the cache (call at boot). Returns it too. */
export async function loadEffectAuditPref(db: BrowserClawDB): Promise<boolean> {
  cache = (await getSetting<boolean>(db, VERBOSE_RUNTIME_AUDIT_KEY)) === true;
  return cache;
}

/** Persist the setting AND update the cache so the host sees it immediately. */
export async function setEffectAuditEnabled(
  db: BrowserClawDB,
  value: boolean,
): Promise<void> {
  cache = value;
  await setSetting(db, VERBOSE_RUNTIME_AUDIT_KEY, value);
}
