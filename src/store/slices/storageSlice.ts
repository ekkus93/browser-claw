import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

/**
 * Local storage usage surfaced to the UI (the top-bar storage pill, the storage
 * screen). Populated by the storage quota service (Phase 3); a quota of 0 means
 * "not yet measured".
 */
export interface StorageState {
  usedBytes: number;
  quotaBytes: number;
  persisted: boolean;
}

const initialState: StorageState = {
  usedBytes: 0,
  quotaBytes: 0,
  persisted: false,
};

const storageSlice = createSlice({
  name: 'storage',
  initialState,
  reducers: {
    storageEstimateSet(
      state,
      action: PayloadAction<{ usedBytes: number; quotaBytes: number }>,
    ) {
      state.usedBytes = action.payload.usedBytes;
      state.quotaBytes = action.payload.quotaBytes;
    },
    storagePersistedSet(state, action: PayloadAction<boolean>) {
      state.persisted = action.payload;
    },
  },
});

export const { storageEstimateSet, storagePersistedSet } = storageSlice.actions;
export default storageSlice.reducer;
