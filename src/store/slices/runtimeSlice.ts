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

/**
 * A non-fatal problem restoring the persisted session snapshot on boot:
 * `incompatible` = the snapshot was from an incompatible build and was
 * discarded; `restore_failed` = it could not be read. Either way the app starts
 * fresh, but the user is told rather than silently losing their session.
 */
export type SnapshotRestoreIssue = 'incompatible' | 'restore_failed';

export interface RuntimeState {
  status: RuntimeStatus;
  /** Set once a runtime is loaded; null while initializing or after a failure. */
  mode: RuntimeMode | null;
  message: string | null;
  /** A fatal boot failure: no runtime is available, so the app blocks. */
  fatal: boolean;
  /** A snapshot restore problem to surface until the user dismisses it. */
  snapshotIssue: SnapshotRestoreIssue | null;
}

const initialState: RuntimeState = {
  status: 'initializing',
  mode: null,
  message: null,
  fatal: false,
  snapshotIssue: null,
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
      state.snapshotIssue = null;
    },
    /**
     * Flag a non-fatal snapshot restore problem. Dispatched at boot before
     * `runtimeLoaded`, which deliberately does not clear it, so the warning
     * survives a successful (fresh) runtime load until the user dismisses it.
     */
    snapshotRestoreWarned(
      state,
      action: PayloadAction<SnapshotRestoreIssue>,
    ) {
      state.snapshotIssue = action.payload;
    },
    snapshotWarningDismissed(state) {
      state.snapshotIssue = null;
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
  snapshotRestoreWarned,
  snapshotWarningDismissed,
} = runtimeSlice.actions;
export default runtimeSlice.reducer;
