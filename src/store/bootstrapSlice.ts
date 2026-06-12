import { createSlice } from '@reduxjs/toolkit';

/**
 * Minimal bootstrap slice so the store has a valid reducer from Phase 0.
 * The real domain slices (app, runtime, chat, approvals, providers, models,
 * skills, memories, storage, audit, secrets-metadata) land in Phase 2.
 */
interface BootstrapState {
  hydrated: boolean;
}

const initialState: BootstrapState = { hydrated: false };

const bootstrapSlice = createSlice({
  name: 'bootstrap',
  initialState,
  reducers: {
    markHydrated(state) {
      state.hydrated = true;
    },
  },
});

export const { markHydrated } = bootstrapSlice.actions;
export default bootstrapSlice.reducer;
