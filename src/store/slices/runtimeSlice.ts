import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

/**
 * Mirror of the deterministic Rust/WASM runtime's lifecycle, as surfaced to the
 * UI. The runtime itself owns the authoritative state machine (Phase 5); this
 * slice only reflects status for display and gating.
 */
export type RuntimeStatus = 'initializing' | 'ready' | 'busy' | 'error';

/**
 * Which runtime actually backs the app — the real WASM one, or (only when a dev
 * override is enabled) the TS reference fallback.
 */
export type RuntimeMode = 'wasm' | 'reference';

export interface RuntimeState {
  status: RuntimeStatus;
  /** Set once a runtime is loaded; null while initializing or after a failure. */
  mode: RuntimeMode | null;
  message: string | null;
  /** A fatal boot failure: no runtime is available, so the app blocks. */
  fatal: boolean;
}

const initialState: RuntimeState = {
  status: 'initializing',
  mode: null,
  message: null,
  fatal: false,
};

const runtimeSlice = createSlice({
  name: 'runtime',
  initialState,
  reducers: {
    /** A runtime loaded successfully; records which one (wasm vs reference). */
    runtimeLoaded(state, action: PayloadAction<{ mode: RuntimeMode }>) {
      state.status = 'ready';
      state.mode = action.payload.mode;
      state.message = null;
      state.fatal = false;
    },
    runtimeReady(state) {
      state.status = 'ready';
      state.message = null;
      state.fatal = false;
    },
    runtimeBusy(state, action: PayloadAction<string | undefined>) {
      state.status = 'busy';
      state.message = action.payload ?? null;
    },
    runtimeErrored(state, action: PayloadAction<string>) {
      state.status = 'error';
      state.message = action.payload;
    },
    /** Fatal: the runtime could not start, so chat is blocked app-wide. */
    runtimeFailed(state, action: PayloadAction<string>) {
      state.status = 'error';
      state.mode = null;
      state.message = action.payload;
      state.fatal = true;
    },
    runtimeReset(state) {
      state.status = 'initializing';
      state.mode = null;
      state.message = null;
      state.fatal = false;
    },
  },
});

export const {
  runtimeLoaded,
  runtimeReady,
  runtimeBusy,
  runtimeErrored,
  runtimeFailed,
  runtimeReset,
} = runtimeSlice.actions;
export default runtimeSlice.reducer;
