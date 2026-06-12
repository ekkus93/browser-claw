import { describe, expect, it } from 'vitest';
import storageReducer, {
  storageEstimateSet,
  storagePersistedSet,
} from './storageSlice.ts';

describe('storageSlice', () => {
  it('starts unmeasured and not persisted', () => {
    const state = storageReducer(undefined, { type: '@@INIT' });
    expect(state).toEqual({ usedBytes: 0, quotaBytes: 0, persisted: false });
  });

  it('records a storage estimate', () => {
    const state = storageReducer(
      undefined,
      storageEstimateSet({ usedBytes: 1024, quotaBytes: 4096 }),
    );
    expect(state.usedBytes).toBe(1024);
    expect(state.quotaBytes).toBe(4096);
  });

  it('records persistent-storage status', () => {
    const state = storageReducer(undefined, storagePersistedSet(true));
    expect(state.persisted).toBe(true);
  });
});
