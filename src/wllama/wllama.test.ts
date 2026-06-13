import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';
import modelsReducer from '../store/slices/modelsSlice.ts';
import {
  createModelManager,
  InsufficientStorageError,
} from './modelManager.ts';
import { isWllamaSupported, type WllamaEngine } from './engine.ts';
import { createWllamaProvider } from '../providers/wllamaProvider.ts';
import { MODEL_CATALOG } from './catalog.ts';
import { db } from '../db/db.ts';
import { queryAuditEvents } from '../audit/auditService.ts';

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
  afterEach(async () => {
    await db.audit_events.clear();
  });

  it('downloads with progress and marks the model ready', async () => {
    const s = store();
    await createModelManager(db, s.dispatch, fakeEngine()).download(model);
    expect(s.getState().models.downloads[model.id]).toEqual({
      status: 'ready',
      progress: 100,
    });
  });

  it('blocks a download that would exceed the storage quota', async () => {
    // Fail closed: a model far larger than the remaining quota must never start
    // downloading — it's refused up front, marked error, and audited.
    const s = store();
    const downloadSpy = vi.fn(() => Promise.resolve());
    const manager = createModelManager(
      db,
      s.dispatch,
      fakeEngine({ download: downloadSpy }),
      () => Promise.resolve({ usedBytes: 0, quotaBytes: 1024 }),
    );

    await expect(manager.download(model)).rejects.toBeInstanceOf(
      InsufficientStorageError,
    );
    expect(downloadSpy).not.toHaveBeenCalled();
    expect(s.getState().models.downloads[model.id]?.status).toBe('error');

    const events = await queryAuditEvents(db, { source: 'model' });
    const blocked = events.find((e) => e.type === 'model.download_blocked');
    expect(blocked?.status).toBe('failure');
    expect(blocked?.modelId).toBe(model.id);
  });

  it('allows a download when the quota is sufficient', async () => {
    const s = store();
    const manager = createModelManager(db, s.dispatch, fakeEngine(), () =>
      Promise.resolve({ usedBytes: 0, quotaBytes: 10 * 1024 * 1024 * 1024 }),
    );

    await manager.download(model);
    expect(s.getState().models.downloads[model.id]).toEqual({
      status: 'ready',
      progress: 100,
    });
  });

  it('marks error and rethrows on download failure', async () => {
    const s = store();
    const manager = createModelManager(
      db,
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
    const manager = createModelManager(db, s.dispatch, fakeEngine());
    await manager.load(model);
    expect(s.getState().models.activeModelId).toBe(model.id);
    await manager.download(model);
    await manager.remove(model);
    expect(s.getState().models.downloads[model.id]).toBeUndefined();
  });

  it('appends a durable audit event for a successful download', async () => {
    const s = store();
    await createModelManager(db, s.dispatch, fakeEngine()).download(model);

    const events = await queryAuditEvents(db, { source: 'model' });
    const event = events.find((e) => e.type === 'model.download_succeeded');
    expect(event).toBeDefined();
    expect(event?.status).toBe('success');
    expect(event?.modelId).toBe(model.id);
    // The audit summary must never leak download URLs or credentials.
    expect(JSON.stringify(event)).not.toContain('huggingface');
  });

  it('audits a failed download as a failure', async () => {
    const s = store();
    const manager = createModelManager(
      db,
      s.dispatch,
      fakeEngine({
        download: () => Promise.reject(new Error('quota exceeded')),
      }),
    );
    await expect(manager.download(model)).rejects.toThrow('quota exceeded');

    const events = await queryAuditEvents(db, { source: 'model' });
    const event = events.find((e) => e.type === 'model.download_failed');
    expect(event?.status).toBe('failure');
    expect(event?.modelId).toBe(model.id);
  });

  it('audits load and delete operations', async () => {
    const s = store();
    const manager = createModelManager(db, s.dispatch, fakeEngine());
    await manager.load(model);
    await manager.remove(model);

    const types = (await queryAuditEvents(db, { source: 'model' })).map(
      (e) => e.type,
    );
    expect(types).toContain('model.loaded');
    expect(types).toContain('model.deleted');
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
