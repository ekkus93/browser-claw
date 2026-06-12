import type { ChatMessage } from '../providers/types.ts';
import type { CatalogModel } from './catalog.ts';

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
  deleteCache(): Promise<void>;
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

/** Stream a GGUF from Hugging Face into an in-memory Blob (no OPFS). */
async function fetchGguf(
  model: CatalogModel,
  onProgress?: (loaded: number, total: number) => void,
): Promise<Blob> {
  const url = `https://huggingface.co/${model.repo}/resolve/main/${model.file}`;
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Model download failed (${response.status})`);
  }
  const total = Number(response.headers.get('content-length') ?? 0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onProgress?.(loaded, total);
  }
  return new Blob(chunks as BlobPart[]);
}

/**
 * Real engine backed by @wllama/wllama, loaded lazily (so it never enters the
 * main bundle or tests). WASM assets are fetched from the CDN, which avoids
 * Vite asset wiring; vendoring them is a future hardening step. Needs
 * real-browser verification.
 */
export function createWllamaEngine(): WllamaEngine {
  let instance: WllamaInstance | null = null;
  let loaded: string | null = null;

  async function getInstance(): Promise<WllamaInstance> {
    if (instance) return instance;
    // Import the built ESM (not the package's untyped .ts source, which would
    // be type-checked under our strict config). Typed via WllamaModule above.
    const mod =
      (await import('@wllama/wllama/esm/index.js')) as unknown as WllamaModule;
    instance = new mod.Wllama({ default: WASM_URL });
    return instance;
  }

  // Load from HF, caching the model in OPFS. Some browsers (notably Firefox in
  // automation) reject OPFS sync-access writes with "No modification allowed";
  // fall back to an in-memory (uncached) load so browser-local models still run.
  async function loadFromHF(
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
        // OPFS is unavailable (e.g. Firefox automation): fetch the GGUF into
        // memory ourselves and load it directly, bypassing the cache.
        const blob = await fetchGguf(model, onProgress);
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
    async deleteCache() {
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
  singleton ??= createWllamaEngine();
  return singleton;
}
