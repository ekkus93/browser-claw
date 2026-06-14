import type { AppDispatch } from '../store/store.ts';
import type { BrowserClawDB } from '../db/db.ts';
import { recordAudit } from '../audit/auditSink.ts';
import {
  storageEstimateSet,
  storagePersistedSet,
} from '../store/slices/storageSlice.ts';

/**
 * Storage services for the local-first persistence layer: read the browser's
 * storage estimate, request/inspect persistent storage, and assess health.
 * The StorageManager is injectable so these are unit-testable without a real
 * browser; in production it defaults to `navigator.storage`.
 */

export interface StorageUsage {
  usedBytes: number;
  quotaBytes: number;
}

export type StorageHealthLevel = 'ok' | 'warning' | 'critical';

export interface StorageHealth {
  level: StorageHealthLevel;
  usedRatio: number;
  persisted: boolean;
  recommendations: string[];
}

function defaultManager(): StorageManager | undefined {
  return typeof navigator !== 'undefined' ? navigator.storage : undefined;
}

export async function estimateStorage(
  manager: StorageManager | undefined = defaultManager(),
): Promise<StorageUsage> {
  if (!manager || !manager.estimate) {
    return { usedBytes: 0, quotaBytes: 0 };
  }
  const estimate = await manager.estimate();
  return {
    usedBytes: estimate.usage ?? 0,
    quotaBytes: estimate.quota ?? 0,
  };
}

export async function isStoragePersisted(
  manager: StorageManager | undefined = defaultManager(),
): Promise<boolean> {
  if (!manager || !manager.persisted) return false;
  return manager.persisted();
}

export async function requestPersistentStorage(
  manager: StorageManager | undefined = defaultManager(),
): Promise<boolean> {
  if (!manager || !manager.persist) return false;
  return manager.persist();
}

export function assessStorageHealth(
  usage: StorageUsage,
  persisted: boolean,
): StorageHealth {
  const usedRatio =
    usage.quotaBytes > 0 ? usage.usedBytes / usage.quotaBytes : 0;
  const recommendations: string[] = [];
  let level: StorageHealthLevel = 'ok';

  if (usedRatio >= 0.9) {
    level = 'critical';
    recommendations.push(
      'Storage is nearly full — export a backup or clear the model cache.',
    );
  } else if (usedRatio >= 0.75) {
    level = 'warning';
    recommendations.push(
      'Storage is getting full — consider clearing unused model caches.',
    );
  }

  if (!persisted) {
    recommendations.push(
      'Enable persistent storage so the browser does not evict your data.',
    );
    if (level === 'ok') level = 'warning';
  }

  return { level, usedRatio, persisted, recommendations };
}

/**
 * Request persistent storage, audit the outcome, and refresh the storage slice.
 * The grant itself is durable in the browser (navigator.storage.persisted()
 * remains authoritative across reloads), so we don't mirror it into a settings
 * row; the audit event is the durable RECORD of the request and its result.
 * Returns whether persistence was granted.
 */
export async function requestStoragePersistence(
  db: BrowserClawDB,
  dispatch: AppDispatch,
  manager: StorageManager | undefined = defaultManager(),
): Promise<boolean> {
  const granted = await requestPersistentStorage(manager);
  void recordAudit(db, dispatch, {
    type: 'storage.persist_requested',
    summary: granted
      ? 'Persistent storage granted'
      : 'Persistent storage request denied',
    source: 'storage',
    risk: 'info',
    status: granted ? 'success' : 'failure',
  });
  await refreshStorageInfo(dispatch, manager);
  return granted;
}

/**
 * Refresh the storage slice from the live browser estimate and persistence
 * status, returning a health assessment for the storage screen.
 */
export async function refreshStorageInfo(
  dispatch: AppDispatch,
  manager: StorageManager | undefined = defaultManager(),
): Promise<StorageHealth> {
  const usage = await estimateStorage(manager);
  const persisted = await isStoragePersisted(manager);
  dispatch(storageEstimateSet(usage));
  dispatch(storagePersistedSet(persisted));
  return assessStorageHealth(usage, persisted);
}
