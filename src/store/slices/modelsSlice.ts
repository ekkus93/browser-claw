import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

/**
 * Active model selection and live download progress (e.g. wllama GGUF pulls).
 * The model catalog and cache metadata are durable (Dexie, Phase 3); this slice
 * owns transient selection and in-flight download state.
 */
export type ModelDownloadStatus = 'queued' | 'downloading' | 'ready' | 'error';

export interface ModelDownload {
  status: ModelDownloadStatus;
  /** 0–100. */
  progress: number;
}

export interface ModelsState {
  activeModelId: string | null;
  activeModelLabel: string | null;
  downloads: Record<string, ModelDownload>;
}

const initialState: ModelsState = {
  activeModelId: null,
  activeModelLabel: null,
  downloads: {},
};

const modelsSlice = createSlice({
  name: 'models',
  initialState,
  reducers: {
    activeModelSet(
      state,
      action: PayloadAction<{ id: string; label: string } | null>,
    ) {
      state.activeModelId = action.payload?.id ?? null;
      state.activeModelLabel = action.payload?.label ?? null;
    },
    modelDownloadUpdated(
      state,
      action: PayloadAction<{ modelId: string } & ModelDownload>,
    ) {
      const { modelId, status, progress } = action.payload;
      state.downloads[modelId] = { status, progress };
    },
    modelDownloadRemoved(state, action: PayloadAction<string>) {
      delete state.downloads[action.payload];
    },
  },
});

export const { activeModelSet, modelDownloadUpdated, modelDownloadRemoved } =
  modelsSlice.actions;
export default modelsSlice.reducer;
