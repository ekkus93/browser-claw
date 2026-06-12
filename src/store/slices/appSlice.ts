import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

/**
 * App-level UI/session orchestration state. Durable data lives in Dexie; this
 * slice holds transient flags the UI reacts to during a session.
 */
export interface AppState {
  /** Durable stores have been loaded from IndexedDB into the session. */
  hydrated: boolean;
  /** First-run setup has been finished (gates the /onboarding route). */
  onboardingComplete: boolean;
  activeWorkspaceId: string | null;
}

const initialState: AppState = {
  hydrated: false,
  onboardingComplete: false,
  activeWorkspaceId: null,
};

const appSlice = createSlice({
  name: 'app',
  initialState,
  reducers: {
    hydrated(state) {
      state.hydrated = true;
    },
    onboardingCompleted(state) {
      state.onboardingComplete = true;
    },
    activeWorkspaceSet(state, action: PayloadAction<string | null>) {
      state.activeWorkspaceId = action.payload;
    },
  },
});

export const { hydrated, onboardingCompleted, activeWorkspaceSet } =
  appSlice.actions;
export default appSlice.reducer;
