import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

/**
 * Mirror of the deterministic Rust/WASM runtime's lifecycle, as surfaced to the
 * UI. The runtime itself owns the authoritative state machine (Phase 5); this
 * slice only reflects status for display and gating.
 */
export type RuntimeStatus = 'initializing' | 'ready' | 'busy' | 'error';

export interface RuntimeState {
  status: RuntimeStatus;
  message: string | null;
}

const initialState: RuntimeState = {
  status: 'initializing',
  message: null,
};

const runtimeSlice = createSlice({
  name: 'runtime',
  initialState,
  reducers: {
    runtimeReady(state) {
      state.status = 'ready';
      state.message = null;
    },
    runtimeBusy(state, action: PayloadAction<string | undefined>) {
      state.status = 'busy';
      state.message = action.payload ?? null;
    },
    runtimeErrored(state, action: PayloadAction<string>) {
      state.status = 'error';
      state.message = action.payload;
    },
    runtimeReset(state) {
      state.status = 'initializing';
      state.message = null;
    },
  },
});

export const { runtimeReady, runtimeBusy, runtimeErrored, runtimeReset } =
  runtimeSlice.actions;
export default runtimeSlice.reducer;
