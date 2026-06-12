// @vitest-environment node
// Node's Blob/Response round-trip through fake-indexeddb and undici; jsdom's
// Blob does not.
import 'fake-indexeddb/auto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { BrowserClawDB } from '../db/db.ts';
import {
  createDexieModelBlobStore,
  getOrFetchModelBlob,
  type ModelBlobStore,
} from './modelCache.ts';
import { MODEL_CATALOG } from './catalog.ts';

const db = new BrowserClawDB();

afterAll(() => {
  db.close();
});

const model = MODEL_CATALOG[0]!;

describe('Dexie model blob store', () => {
  it('round-trips and deletes a cached blob', async () => {
    await db.open();
    const store = createDexieModelBlobStore(db);
    expect(await store.get('m')).toBeUndefined();
    await store.put('m', new Blob([new Uint8Array([1, 2, 3])]));
    expect((await store.get('m'))?.size).toBe(3);
    await store.delete('m');
    expect(await store.get('m')).toBeUndefined();
  });
});

describe('getOrFetchModelBlob', () => {
  it('downloads once on a miss, then serves from cache without re-fetching', async () => {
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
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        new Response(new Blob([new Uint8Array(8)]), {
          headers: { 'content-length': '8' },
        }),
      ),
    ) as unknown as typeof fetch;

    const first = await getOrFetchModelBlob(store, model, { fetchImpl });
    expect(first.size).toBe(8);
    const second = await getOrFetchModelBlob(store, model, { fetchImpl });
    expect(second.size).toBe(8);
    // second call is served from cache — only one network fetch total
    expect(
      (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(1);
  });
});
