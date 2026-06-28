import { describe, expect, it, vi } from 'vitest';
import {
  checkSearchStatus,
  type SearchStatusState,
} from './searchStatusChecker.ts';
import type { SearchProvider } from '../webresearch/types.ts';

function makeTransport(response: unknown, rejects = false) {
  return {
    send: vi.fn(() =>
      rejects
        ? Promise.reject(new Error('extension not available'))
        : Promise.resolve(response),
    ),
  };
}

function makeSearchProvider(
  results: { title: string; url: string }[],
  fails = false,
): SearchProvider {
  return {
    search: vi.fn(() =>
      fails
        ? Promise.reject(new Error('search failed'))
        : Promise.resolve(results.map((r, i) => ({ ...r, rank: i + 1 }))),
    ),
  };
}

const STATUS_RESPONSE = {
  ok: true,
  requestId: 'r1',
  webSearchAvailable: true,
  pageReadingAvailable: true,
};

// ---------------------------------------------------------------------------
// G3 — search status checker
// ---------------------------------------------------------------------------

describe('G3 — checkSearchStatus', () => {
  it('G3: no_provider when neither transport nor searchProvider configured', async () => {
    const result = await checkSearchStatus({});
    expect(result.status).toBe('no_provider');
  });

  it('G3: key_locked when keyAvailable is false', async () => {
    const result = await checkSearchStatus({
      searchProvider: makeSearchProvider([{ title: 'A', url: 'https://x' }]),
      keyAvailable: false,
    });
    expect(result.status).toBe('key_locked');
  });

  it('G3: key_locked message can be customised', async () => {
    const result = await checkSearchStatus({
      searchProvider: makeSearchProvider([]),
      keyAvailable: false,
      keyUnavailableMessage: 'Custom locked message',
    });
    expect(result.status).toBe('key_locked');
    if (result.status === 'key_locked') {
      expect(result.message).toBe('Custom locked message');
    }
  });

  it('G3: extension_unavailable when extension not reachable', async () => {
    const result = await checkSearchStatus({
      transport: makeTransport(null, true),
      searchProvider: makeSearchProvider([{ title: 'A', url: 'https://x' }]),
    });
    expect(result.status).toBe('extension_unavailable');
  });

  it('G3: extension_unavailable when get_status returns webSearchAvailable: false', async () => {
    const result = await checkSearchStatus({
      transport: makeTransport({
        ok: true,
        requestId: 'r1',
        webSearchAvailable: false,
        pageReadingAvailable: true,
      }),
      searchProvider: makeSearchProvider([{ title: 'A', url: 'https://x' }]),
    });
    expect(result.status).toBe('extension_unavailable');
  });

  it('G3: provider_unavailable when probe search fails', async () => {
    const result = await checkSearchStatus({
      transport: makeTransport(STATUS_RESPONSE),
      searchProvider: makeSearchProvider([], true),
    });
    expect(result.status).toBe('provider_unavailable');
  });

  it('G3: connected when probe search succeeds', async () => {
    const result = await checkSearchStatus({
      transport: makeTransport(STATUS_RESPONSE),
      searchProvider: makeSearchProvider([{ title: 'A', url: 'https://x' }]),
    });
    expect(result.status).toBe('connected');
    if (result.status === 'connected') {
      expect(result.resultCount).toBe(1);
    }
  });

  it('G3: connected without extension check when only searchProvider provided', async () => {
    const result = await checkSearchStatus({
      searchProvider: makeSearchProvider([
        { title: 'A', url: 'https://a' },
        { title: 'B', url: 'https://b' },
      ]),
    });
    const state = result as SearchStatusState;
    expect(state.status).toBe('connected');
    if (state.status === 'connected') {
      expect(state.resultCount).toBe(2);
    }
  });

  it('G3: status false when extension missing (key_locked takes precedence)', async () => {
    const result = await checkSearchStatus({
      transport: makeTransport(null, true),
      searchProvider: makeSearchProvider([]),
      keyAvailable: false,
    });
    expect(result.status).toBe('key_locked');
  });
});
