import { describe, expect, it } from 'vitest';
import modelsReducer, {
  activeModelSet,
  modelDownloadUpdated,
  modelDownloadRemoved,
} from './modelsSlice.ts';

describe('modelsSlice', () => {
  it('starts with no active model and no downloads', () => {
    const state = modelsReducer(undefined, { type: '@@INIT' });
    expect(state).toEqual({
      activeModelId: null,
      activeModelLabel: null,
      downloads: {},
    });
  });

  it('sets the active model', () => {
    const state = modelsReducer(
      undefined,
      activeModelSet({ id: 'smollm2', label: 'SmolLM2' }),
    );
    expect(state.activeModelId).toBe('smollm2');
    expect(state.activeModelLabel).toBe('SmolLM2');
  });

  it('tracks and removes download progress', () => {
    let state = modelsReducer(
      undefined,
      modelDownloadUpdated({
        modelId: 'smollm2',
        status: 'downloading',
        progress: 40,
      }),
    );
    expect(state.downloads.smollm2).toEqual({
      status: 'downloading',
      progress: 40,
    });

    state = modelsReducer(state, modelDownloadRemoved('smollm2'));
    expect(state.downloads.smollm2).toBeUndefined();
  });
});
