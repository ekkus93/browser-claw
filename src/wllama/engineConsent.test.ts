import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Track how the (mocked) wllama runtime is constructed/used so we can prove the
// CDN fetch never happens when consent is denied.
const ctorCalls = vi.hoisted(() => ({ count: 0 }));
const loadFromHFCalls = vi.hoisted(() => ({ count: 0 }));

vi.mock('@wllama/wllama/esm/index.js', () => {
  class Wllama {
    constructor() {
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

import { createWllamaEngine, WllamaCdnConsentError } from './engine.ts';
import { MODEL_CATALOG } from './catalog.ts';

const model = MODEL_CATALOG[0]!;

describe('wllama engine CDN consent gate', () => {
  beforeEach(() => {
    ctorCalls.count = 0;
    loadFromHFCalls.count = 0;
  });

  it('fails closed: throws and never constructs the runtime when consent is denied', async () => {
    const engine = createWllamaEngine({
      requireCdnConsent: () => Promise.resolve(false),
    });

    await expect(engine.download(model, () => {})).rejects.toBeInstanceOf(
      WllamaCdnConsentError,
    );
    // The CDN-backed runtime must never be instantiated (i.e. fetched) when
    // consent is denied — that's the whole point of failing closed.
    expect(ctorCalls.count).toBe(0);
  });

  it('loads the runtime once the user has granted consent', async () => {
    const engine = createWllamaEngine({
      requireCdnConsent: () => Promise.resolve(true),
    });

    await engine.load(model);
    expect(ctorCalls.count).toBe(1);
    expect(loadFromHFCalls.count).toBe(1);
  });
});
