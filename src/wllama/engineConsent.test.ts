import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Track how the (mocked) wllama runtime is constructed/used so we can prove the
// CDN fetch never happens when consent is denied.
const ctorCalls = vi.hoisted(() => ({ count: 0 }));
const loadFromHFCalls = vi.hoisted(() => ({ count: 0 }));
// When true, the (mocked) runtime fails to construct — simulating an
// unreachable/blocked CDN or a bad asset.
const failCtor = vi.hoisted(() => ({ on: false }));

vi.mock('@wllama/wllama/esm/index.js', () => {
  class Wllama {
    constructor() {
      if (failCtor.on) throw new Error('runtime fetch failed');
      ctorCalls.count += 1;
    }
    loadModelFromHF() {
      loadFromHFCalls.count += 1;
      return Promise.resolve();
    }
    loadModel() {
      return Promise.resolve();
    }
    createChatCompletion() {
      return Promise.resolve({ choices: [{ message: { content: 'ok' } }] });
    }
    exit() {
      return Promise.resolve();
    }
  }
  return { Wllama };
});

// Stub the SHA-256 runtime verification (its own fetch is unit-tested in
// runtimeIntegrity.test.ts). This keeps the consent/load wiring tests off the
// network — getInstance would otherwise fetch the real CDN wasm (A2.7).
vi.mock('./runtimeIntegrity.ts', () => ({
  fetchVerifiedRuntimeUrl: () => Promise.resolve('blob:mock-runtime'),
}));

import {
  createWllamaEngine,
  getWllamaEngine,
  WllamaCdnConsentError,
} from './engine.ts';
import type { ModelBlobStore } from './modelCache.ts';
import { MODEL_CATALOG } from './catalog.ts';
import { db } from '../db/db.ts';
import { setWllamaCdnConsent } from '../settings/appSettings.ts';
import { queryAuditEvents } from '../audit/auditService.ts';

const model = MODEL_CATALOG[0]!;

describe('wllama engine CDN consent gate', () => {
  beforeEach(() => {
    ctorCalls.count = 0;
    loadFromHFCalls.count = 0;
    failCtor.on = false;
  });

  it('fails closed: throws and never constructs the runtime when consent is denied', async () => {
    const onRuntimeLoad = vi.fn();
    const engine = createWllamaEngine({
      requireCdnConsent: () => Promise.resolve(false),
      onRuntimeLoad,
    });

    await expect(engine.download(model, () => {})).rejects.toBeInstanceOf(
      WllamaCdnConsentError,
    );
    // The CDN-backed runtime must never be instantiated (i.e. fetched) when
    // consent is denied — that's the whole point of failing closed.
    expect(ctorCalls.count).toBe(0);
    // A policy block is not a load attempt, so no runtime-load event fires.
    expect(onRuntimeLoad).not.toHaveBeenCalled();
  });

  it('loads the runtime once the user has granted consent and reports success', async () => {
    const onRuntimeLoad = vi.fn();
    const engine = createWllamaEngine({
      requireCdnConsent: () => Promise.resolve(true),
      onRuntimeLoad,
    });

    await engine.load(model);
    expect(ctorCalls.count).toBe(1);
    expect(loadFromHFCalls.count).toBe(1);
    expect(onRuntimeLoad).toHaveBeenCalledExactlyOnceWith(true);
  });

  it('reports a runtime-load failure when the runtime cannot be constructed', async () => {
    failCtor.on = true;
    const onRuntimeLoad = vi.fn();
    const engine = createWllamaEngine({
      requireCdnConsent: () => Promise.resolve(true),
      onRuntimeLoad,
    });

    await expect(engine.load(model)).rejects.toThrow('runtime fetch failed');
    expect(onRuntimeLoad).toHaveBeenCalledExactlyOnceWith(false);
  });

  it('the shared engine audits a successful runtime load to the durable log', async () => {
    // Integration of the real getWllamaEngine wiring: granting consent and
    // loading must leave a durable runtime-source audit event behind.
    await db.audit_events.clear();
    await setWllamaCdnConsent(db, true);

    await getWllamaEngine().load(model);

    const events = await queryAuditEvents(db, { source: 'runtime' });
    expect(events.some((e) => e.type === 'runtime.wllama_load_succeeded')).toBe(
      true,
    );
  });
});

describe('wllama engine cache deletion', () => {
  it('deleteCache removes the cached model data from the blob store', async () => {
    // Deleting a model must actually evict its cached bytes — not just update
    // UI state — so freed quota is real and a re-download is clean.
    const cache = new Map<string, Blob>();
    const store: ModelBlobStore = {
      get: (id) => Promise.resolve(cache.get(id)),
      put: (id, blob) => {
        cache.set(id, blob);
        return Promise.resolve();
      },
      delete: (id) => {
        cache.delete(id);
        return Promise.resolve();
      },
    };
    await store.put(model.id, new Blob([new Uint8Array([1, 2, 3])]));
    expect(cache.size).toBe(1);

    const engine = createWllamaEngine({ blobStore: store });
    await engine.deleteCache(model.id);

    expect(cache.size).toBe(0);
    expect(await store.get(model.id)).toBeUndefined();
  });
});
