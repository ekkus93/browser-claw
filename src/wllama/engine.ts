import type { ChatMessage } from '../providers/types.ts';
import type { CatalogModel } from './catalog.ts';
import { db } from '../db/db.ts';
import {
  createDexieModelBlobStore,
  fetchGguf,
  getOrFetchModelBlob,
  type ModelBlobStore,
} from './modelCache.ts';
import { getWllamaCdnConsent } from '../settings/appSettings.ts';

/**
 * Thrown when the wllama runtime WASM would be fetched from the CDN without
 * explicit user consent. The app fails closed: browser-local models never
 * silently pull remote code from a CDN. The message points the user at the
 * Settings toggle that grants consent (TODO Phase 8.1).
 */
export class WllamaCdnConsentError extends Error {
  constructor() {
    super(
      'wllama runtime not authorized: enable "Load runtime from CDN" for ' +
        'browser-local models in Settings before downloading or running a model.',
    );
    this.name = 'WllamaCdnConsentError';
  }
}

/**
 * Engine that runs browser-local GGUF models via wllama (which manages its own
 * Web Worker + WASM). The interface is injectable so the model manager and
 * provider are testable without loading the real WASM.
 */
export interface WllamaEngine {
  download(
    model: CatalogModel,
    onProgress: (loaded: number, total: number) => void,
  ): Promise<void>;
  load(model: CatalogModel): Promise<void>;
  unload(): Promise<void>;
  deleteCache(modelId?: string): Promise<void>;
  complete(messages: ChatMessage[]): Promise<string>;
  loadedModelId(): string | null;
}

/** Whether the browser can run wllama (WebAssembly + workers). */
export function isWllamaSupported(): boolean {
  return typeof WebAssembly === 'object' && typeof Worker !== 'undefined';
}

// Minimal view of the wllama module — decouples our typecheck from wllama's
// full type surface (the real call shapes are verified in a browser).
interface WllamaInstance {
  loadModelFromHF(
    hf: { repo: string; file?: string },
    params?: {
      progressCallback?: (opts: { loaded: number; total: number }) => void;
      useCache?: boolean;
    },
  ): Promise<unknown>;
  loadModel(blobs: Blob[]): Promise<unknown>;
  createChatCompletion(opts: {
    messages: { role: string; content: string }[];
    max_tokens?: number;
  }): Promise<{ choices?: { message?: { content?: string } }[] }>;
  exit(): Promise<void>;
}

interface WllamaModule {
  Wllama: new (config: { default: string }) => WllamaInstance;
}

// wllama v3 ships a single wasm at esm/wasm/wllama.wasm; serve it from the CDN
// so we don't have to wire the binary through Vite. (Vendoring is a future step.)
const WASM_URL =
  'https://cdn.jsdelivr.net/npm/@wllama/wllama@3.4.1/esm/wasm/wllama.wasm';

export interface WllamaEngineOptions {
  /** Where to cache model blobs when OPFS is unavailable. */
  blobStore?: ModelBlobStore;
  /**
   * Gate the CDN WASM fetch on explicit user consent. Checked once, lazily,
   * immediately before the runtime would be fetched from the CDN. When it
   * resolves false the engine throws {@link WllamaCdnConsentError} instead of
   * silently downloading — so the app fails closed. Omit it (e.g. in unit
   * tests that mock the module) to skip the gate entirely.
   */
  requireCdnConsent?: () => Promise<boolean>;
}

/**
 * Real engine backed by @wllama/wllama, loaded lazily (so it never enters the
 * main bundle or tests). WASM assets are fetched from the CDN, which avoids
 * Vite asset wiring; vendoring them is a future hardening step. Needs
 * real-browser verification.
 */
export function createWllamaEngine(
  options: WllamaEngineOptions = {},
): WllamaEngine {
  let instance: WllamaInstance | null = null;
  let loaded: string | null = null;
  // Coalesces concurrent loads of the same model. A second load would open a
  // second OPFS sync-access handle on the same file ("another open Access
  // Handle") — which happens under React StrictMode's double-effect or a
  // download/load race. Identical in-flight requests share one promise.
  let inFlight: { id: string; promise: Promise<void> } | null = null;

  async function getInstance(): Promise<WllamaInstance> {
    if (instance) return instance;
    // Fail closed: never fetch the runtime from the CDN unless the user has
    // explicitly consented. This check runs before the dynamic import below, so
    // a denied gate means no remote code is fetched at all.
    if (options.requireCdnConsent && !(await options.requireCdnConsent())) {
      throw new WllamaCdnConsentError();
    }
    // Import the built ESM (not the package's untyped .ts source, which would
    // be type-checked under our strict config). Typed via WllamaModule above.
    const mod =
      (await import('@wllama/wllama/esm/index.js')) as unknown as WllamaModule;
    instance = new mod.Wllama({ default: WASM_URL });
    return instance;
  }

  // Public entry: coalesces concurrent requests for the same model (see
  // `inFlight`) so we never open two OPFS handles on the same file.
  function loadFromHF(
    model: CatalogModel,
    onProgress?: (loaded: number, total: number) => void,
  ): Promise<void> {
    if (inFlight && inFlight.id === model.id) return inFlight.promise;
    const promise = runLoad(model, onProgress).finally(() => {
      if (inFlight?.promise === promise) inFlight = null;
    });
    inFlight = { id: model.id, promise };
    return promise;
  }

  // Load from HF, caching the model in OPFS. Some browsers (notably Firefox in
  // automation) reject OPFS sync-access writes with "No modification allowed";
  // fall back to our IndexedDB blob cache so browser-local models still run.
  async function runLoad(
    model: CatalogModel,
    onProgress?: (loaded: number, total: number) => void,
  ): Promise<void> {
    const wllama = await getInstance();
    const progress = onProgress
      ? {
          progressCallback: (opts: { loaded: number; total: number }) =>
            onProgress(opts.loaded, opts.total),
        }
      : {};
    const hf = { repo: model.repo, file: model.file };
    try {
      await wllama.loadModelFromHF(hf, { ...progress, useCache: true });
    } catch (error) {
      if (
        error instanceof Error &&
        /modification allowed/i.test(error.message)
      ) {
        // OPFS is unavailable (e.g. Firefox): load from our own IndexedDB blob
        // cache, downloading once if needed. No OPFS involved.
        const blob = options.blobStore
          ? await getOrFetchModelBlob(options.blobStore, model, {
              ...(onProgress ? { onProgress } : {}),
            })
          : await fetchGguf(model, fetch, onProgress);
        await wllama.loadModel([blob]);
      } else {
        throw error;
      }
    }
    loaded = model.id;
  }

  return {
    download(model, onProgress) {
      return loadFromHF(model, onProgress);
    },
    load(model) {
      return loadFromHF(model);
    },
    async unload() {
      if (instance) await instance.exit();
      instance = null;
      loaded = null;
    },
    async deleteCache(modelId) {
      if (modelId) await options.blobStore?.delete(modelId);
      await this.unload();
    },
    async complete(messages) {
      const wllama = await getInstance();
      const response = await wllama.createChatCompletion({
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        max_tokens: 256,
      });
      return response.choices?.[0]?.message?.content ?? '';
    },
    loadedModelId() {
      return loaded;
    },
  };
}

let singleton: WllamaEngine | null = null;

/** Shared engine instance used by the app (one model loaded at a time). */
export function getWllamaEngine(): WllamaEngine {
  singleton ??= createWllamaEngine({
    blobStore: createDexieModelBlobStore(db),
    requireCdnConsent: () => getWllamaCdnConsent(db),
  });
  return singleton;
}
