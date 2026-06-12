import { describe, expect, it, vi } from 'vitest';
import {
  estimateStorage,
  isStoragePersisted,
  requestPersistentStorage,
  assessStorageHealth,
  refreshStorageInfo,
} from './storageService.ts';
import {
  storageEstimateSet,
  storagePersistedSet,
} from '../store/slices/storageSlice.ts';

function fakeManager(
  overrides: Partial<{
    estimate: () => Promise<StorageEstimate>;
    persisted: () => Promise<boolean>;
    persist: () => Promise<boolean>;
  }> = {},
): StorageManager {
  return {
    estimate:
      overrides.estimate ??
      (() => Promise.resolve({ usage: 100, quota: 1000 })),
    persisted: overrides.persisted ?? (() => Promise.resolve(true)),
    persist: overrides.persist ?? (() => Promise.resolve(true)),
  } as unknown as StorageManager;
}

describe('estimateStorage', () => {
  it('maps usage/quota to used/total bytes', async () => {
    const usage = await estimateStorage(fakeManager());
    expect(usage).toEqual({ usedBytes: 100, quotaBytes: 1000 });
  });

  it('returns zeros when the API is unavailable', async () => {
    expect(await estimateStorage(undefined)).toEqual({
      usedBytes: 0,
      quotaBytes: 0,
    });
  });
});

describe('persistence helpers', () => {
  it('reads and requests persistence', async () => {
    expect(await isStoragePersisted(fakeManager())).toBe(true);
    expect(await requestPersistentStorage(fakeManager())).toBe(true);
  });

  it('degrades gracefully without the API', async () => {
    expect(await isStoragePersisted(undefined)).toBe(false);
    expect(await requestPersistentStorage(undefined)).toBe(false);
  });
});

describe('assessStorageHealth', () => {
  it('is ok with low usage and persistence', () => {
    const health = assessStorageHealth(
      { usedBytes: 100, quotaBytes: 1000 },
      true,
    );
    expect(health.level).toBe('ok');
    expect(health.recommendations).toHaveLength(0);
  });

  it('warns above 75% usage', () => {
    const health = assessStorageHealth(
      { usedBytes: 800, quotaBytes: 1000 },
      true,
    );
    expect(health.level).toBe('warning');
  });

  it('is critical above 90% usage', () => {
    const health = assessStorageHealth(
      { usedBytes: 950, quotaBytes: 1000 },
      true,
    );
    expect(health.level).toBe('critical');
  });

  it('warns and recommends enabling persistence when not persisted', () => {
    const health = assessStorageHealth(
      { usedBytes: 10, quotaBytes: 1000 },
      false,
    );
    expect(health.level).toBe('warning');
    expect(health.recommendations.join(' ')).toMatch(/persistent storage/i);
  });
});

describe('refreshStorageInfo', () => {
  it('dispatches the estimate and persistence status', async () => {
    const dispatch = vi.fn();
    const health = await refreshStorageInfo(
      dispatch as never,
      fakeManager({
        estimate: () => Promise.resolve({ usage: 250, quota: 1000 }),
        persisted: () => Promise.resolve(false),
      }),
    );

    expect(dispatch).toHaveBeenCalledWith(
      storageEstimateSet({ usedBytes: 250, quotaBytes: 1000 }),
    );
    expect(dispatch).toHaveBeenCalledWith(storagePersistedSet(false));
    expect(health.persisted).toBe(false);
  });
});
