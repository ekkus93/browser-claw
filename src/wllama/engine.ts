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
    },
  ): Promise<unknown>;
  createChatCompletion(opts: {
    messages: { role: string; content: string }[];
    max_tokens?: number;
  }): Promise<{ choices?: { message?: { content?: string } }[] }>;
  exit(): Promise<void>;
}

interface WllamaModule {
  Wllama: new (config: {
    default: string;
    'single-thread/wllama.wasm'?: string;
    'multi-thread/wllama.wasm'?: string;
  }) => WllamaInstance;
}

const CDN = 'https://cdn.jsdelivr.net/npm/@wllama/wllama@3.4.1/esm';

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
    instance = new mod.Wllama({
      default: `${CDN}/single-thread/wllama.wasm`,
      'single-thread/wllama.wasm': `${CDN}/single-thread/wllama.wasm`,
      'multi-thread/wllama.wasm': `${CDN}/multi-thread/wllama.wasm`,
    });
    return instance;
  }

  return {
    async download(model, onProgress) {
      const wllama = await getInstance();
      await wllama.loadModelFromHF(
        { repo: model.repo, file: model.file },
        { progressCallback: ({ loaded: l, total }) => onProgress(l, total) },
      );
      loaded = model.id;
    },
    async load(model) {
      const wllama = await getInstance();
      await wllama.loadModelFromHF({ repo: model.repo, file: model.file });
      loaded = model.id;
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
