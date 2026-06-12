import { describe, expect, it } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';
import modelsReducer from '../store/slices/modelsSlice.ts';
import { createModelManager } from './modelManager.ts';
import { isWllamaSupported, type WllamaEngine } from './engine.ts';
import { createWllamaProvider } from '../providers/wllamaProvider.ts';
import { MODEL_CATALOG } from './catalog.ts';

function fakeEngine(overrides: Partial<WllamaEngine> = {}): WllamaEngine {
  return {
    download: (_model, onProgress) => {
      onProgress(50, 100);
      onProgress(100, 100);
      return Promise.resolve();
    },
    load: () => Promise.resolve(),
    unload: () => Promise.resolve(),
    deleteCache: () => Promise.resolve(),
    complete: () => Promise.resolve('local reply'),
    loadedModelId: () => null,
    ...overrides,
  };
}

const model = MODEL_CATALOG[0]!;

function store() {
  return configureStore({ reducer: { models: modelsReducer } });
}

describe('modelManager', () => {
  it('downloads with progress and marks the model ready', async () => {
    const s = store();
    await createModelManager(s.dispatch, fakeEngine()).download(model);
    expect(s.getState().models.downloads[model.id]).toEqual({
      status: 'ready',
      progress: 100,
    });
  });

  it('marks error and rethrows on download failure', async () => {
    const s = store();
    const manager = createModelManager(
      s.dispatch,
      fakeEngine({
        download: () => Promise.reject(new Error('quota exceeded')),
      }),
    );
    await expect(manager.download(model)).rejects.toThrow('quota exceeded');
    expect(s.getState().models.downloads[model.id]?.status).toBe('error');
  });

  it('load sets the active model; remove clears the download entry', async () => {
    const s = store();
    const manager = createModelManager(s.dispatch, fakeEngine());
    await manager.load(model);
    expect(s.getState().models.activeModelId).toBe(model.id);
    await manager.download(model);
    await manager.remove(model);
    expect(s.getState().models.downloads[model.id]).toBeUndefined();
  });
});

describe('wllamaProvider', () => {
  it('completes via the engine and reports health from loaded state', async () => {
    const provider = createWllamaProvider(
      fakeEngine({ loadedModelId: () => 'x' }),
    );
    const result = await provider.complete({
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(result.text).toBe('local reply');
    expect(await provider.checkHealth()).toBe('connected');
  });

  it('reports unconfigured when no model is loaded', async () => {
    const provider = createWllamaProvider(fakeEngine());
    expect(await provider.checkHealth()).toBe('unconfigured');
  });
});

describe('isWllamaSupported', () => {
  it('returns a boolean', () => {
    expect(typeof isWllamaSupported()).toBe('boolean');
  });
});
