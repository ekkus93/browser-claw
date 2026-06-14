import type { BrowserClawDB } from '../db/db.ts';
import type { CatalogModel } from './catalog.ts';
import { hfDownloadUrl } from './hfReference.ts';

/**
 * Cache for downloaded GGUF model bytes, used when wllama's own OPFS cache is
 * unavailable (e.g. Firefox). Persists the model in IndexedDB so it isn't
 * re-downloaded every session.
 */
export interface ModelBlobStore {
  get(modelId: string): Promise<Blob | undefined>;
  put(modelId: string, blob: Blob): Promise<void>;
  delete(modelId: string): Promise<void>;
}

export function createDexieModelBlobStore(db: BrowserClawDB): ModelBlobStore {
  return {
    async get(modelId) {
      return (await db.model_blobs.get(modelId))?.blob;
    },
    async put(modelId, blob) {
      await db.model_blobs.put({ modelId, blob, cachedAt: Date.now() });
    },
    async delete(modelId) {
      await db.model_blobs.delete(modelId);
    },
  };
}

/** Stream a GGUF from Hugging Face into an in-memory Blob (no OPFS). */
export async function fetchGguf(
  model: CatalogModel,
  fetchImpl: typeof fetch = fetch,
  onProgress?: (loaded: number, total: number) => void,
): Promise<Blob> {
  // Built via hfDownloadUrl so the bytes always come straight from HF — never
  // proxied through an app server (TODO 8.3).
  const url = hfDownloadUrl(model);
  const response = await fetchImpl(url);
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

export interface FetchOptions {
  fetchImpl?: typeof fetch;
  onProgress?: (loaded: number, total: number) => void;
}

/** Return the cached model blob, or download it once and cache it. */
export async function getOrFetchModelBlob(
  store: ModelBlobStore,
  model: CatalogModel,
  options: FetchOptions = {},
): Promise<Blob> {
  const cached = await store.get(model.id);
  if (cached) {
    options.onProgress?.(cached.size, cached.size);
    return cached;
  }
  const blob = await fetchGguf(
    model,
    options.fetchImpl ?? fetch,
    options.onProgress,
  );
  await store.put(model.id, blob);
  return blob;
}
