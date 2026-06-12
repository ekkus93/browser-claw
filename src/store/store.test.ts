import { describe, expect, it } from 'vitest';
import { store } from './store.ts';
import { markHydrated } from './bootstrapSlice.ts';

describe('store', () => {
  it('starts un-hydrated and can be marked hydrated', () => {
    expect(store.getState().bootstrap.hydrated).toBe(false);
    store.dispatch(markHydrated());
    expect(store.getState().bootstrap.hydrated).toBe(true);
  });
});
