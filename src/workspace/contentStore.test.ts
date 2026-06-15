import { describe, expect, it } from 'vitest';
import {
  MemoryContentStore,
  UnavailableContentStore,
  WorkspaceContentMissingError,
  WorkspaceUnavailableError,
  createContentStore,
  isOpfsAvailable,
  type ContentStore,
} from './contentStore.ts';

const bytes = (s: string) => new TextEncoder().encode(s);

describe('MemoryContentStore', () => {
  it('round-trips bytes by id', async () => {
    const store = new MemoryContentStore();
    expect(await store.has('a')).toBe(false);
    await store.write('a', bytes('hello'));
    expect(await store.has('a')).toBe(true);
    expect(new TextDecoder().decode(await store.read('a'))).toBe('hello');
    await store.delete('a');
    expect(await store.has('a')).toBe(false);
  });

  it('rejects reading missing content', async () => {
    const store = new MemoryContentStore();
    await expect(store.read('missing')).rejects.toBeInstanceOf(
      WorkspaceContentMissingError,
    );
  });
});

describe('UnavailableContentStore', () => {
  it('fails every operation visibly (no silent fallback)', async () => {
    const store: ContentStore = new UnavailableContentStore();
    await expect(store.read('x')).rejects.toBeInstanceOf(
      WorkspaceUnavailableError,
    );
    await expect(store.write('x', bytes('y'))).rejects.toBeInstanceOf(
      WorkspaceUnavailableError,
    );
    await expect(store.has('x')).rejects.toBeInstanceOf(
      WorkspaceUnavailableError,
    );
  });
});

describe('createContentStore / isOpfsAvailable', () => {
  it('returns the unavailable store when OPFS is missing (jsdom)', () => {
    // jsdom provides no navigator.storage.getDirectory.
    expect(isOpfsAvailable()).toBe(false);
    expect(createContentStore()).toBeInstanceOf(UnavailableContentStore);
  });
});
