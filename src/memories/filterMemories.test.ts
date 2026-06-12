import { describe, expect, it } from 'vitest';
import type { MemoryRow } from '../db/types.ts';
import {
  filterMemories,
  deriveMemoryFacets,
  DEFAULT_MEMORY_FILTERS,
  type MemoryFilters,
} from './filterMemories.ts';

function memory(over: Partial<MemoryRow>): MemoryRow {
  return {
    id: 'id',
    title: 'Title',
    text: 'Body',
    tags: [],
    source: 'chat',
    createdBy: 'user',
    createdAt: 1,
    pinned: false,
    sensitivity: 'normal',
    ...over,
  };
}

const ROWS: MemoryRow[] = [
  memory({
    id: 'a',
    title: 'Rust ownership',
    text: 'borrow checker',
    tags: ['rust'],
    source: 'Conversation: Learning',
    createdBy: 'user',
    sensitivity: 'normal',
    pinned: true,
  }),
  memory({
    id: 'b',
    title: 'WASM memory',
    text: 'linear memory',
    tags: ['wasm', 'memory'],
    source: 'Conversation: Architecture',
    createdBy: 'assistant',
    sensitivity: 'sensitive',
    pinned: false,
  }),
  memory({
    id: 'c',
    title: 'Tokio tasks',
    text: 'async runtime',
    tags: ['rust', 'async'],
    source: 'Conversation: Architecture',
    createdBy: 'assistant',
    sensitivity: 'normal',
    pinned: false,
  }),
];

function withFilters(over: Partial<MemoryFilters>): MemoryFilters {
  return { ...DEFAULT_MEMORY_FILTERS, ...over };
}

function ids(rows: MemoryRow[]): string[] {
  return rows.map((r) => r.id);
}

describe('filterMemories', () => {
  it('returns everything with the default (empty) filters', () => {
    expect(ids(filterMemories(ROWS, DEFAULT_MEMORY_FILTERS))).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('search matches title, body, or tag (case-insensitive)', () => {
    expect(
      ids(filterMemories(ROWS, withFilters({ query: 'OWNERSHIP' }))),
    ).toEqual(['a']);
    expect(ids(filterMemories(ROWS, withFilters({ query: 'linear' })))).toEqual(
      ['b'],
    );
    expect(ids(filterMemories(ROWS, withFilters({ query: 'async' })))).toEqual([
      'c',
    ]);
  });

  it('filters by sensitivity', () => {
    expect(
      ids(filterMemories(ROWS, withFilters({ sensitivity: 'sensitive' }))),
    ).toEqual(['b']);
    expect(
      ids(filterMemories(ROWS, withFilters({ sensitivity: 'normal' }))),
    ).toEqual(['a', 'c']);
  });

  it('filters by source', () => {
    expect(
      ids(
        filterMemories(
          ROWS,
          withFilters({ source: 'Conversation: Architecture' }),
        ),
      ),
    ).toEqual(['b', 'c']);
  });

  it('filters by created-by', () => {
    expect(
      ids(filterMemories(ROWS, withFilters({ createdBy: 'user' }))),
    ).toEqual(['a']);
    expect(
      ids(filterMemories(ROWS, withFilters({ createdBy: 'assistant' }))),
    ).toEqual(['b', 'c']);
  });

  it('filters by tag', () => {
    expect(ids(filterMemories(ROWS, withFilters({ tag: 'rust' })))).toEqual([
      'a',
      'c',
    ]);
    expect(ids(filterMemories(ROWS, withFilters({ tag: 'wasm' })))).toEqual([
      'b',
    ]);
  });

  it('filters by pinned only', () => {
    expect(
      ids(filterMemories(ROWS, withFilters({ pinnedOnly: true }))),
    ).toEqual(['a']);
  });

  it('combines filters (AND semantics)', () => {
    expect(
      ids(
        filterMemories(
          ROWS,
          withFilters({ createdBy: 'assistant', tag: 'rust' }),
        ),
      ),
    ).toEqual(['c']);
    // Conflicting filters yield nothing rather than silently ignoring one.
    expect(
      ids(
        filterMemories(
          ROWS,
          withFilters({ sensitivity: 'sensitive', tag: 'async' }),
        ),
      ),
    ).toEqual([]);
  });
});

describe('deriveMemoryFacets', () => {
  it('returns distinct, sorted sources, creators, and tags', () => {
    const facets = deriveMemoryFacets(ROWS);
    expect(facets.sources).toEqual([
      'Conversation: Architecture',
      'Conversation: Learning',
    ]);
    expect(facets.creators).toEqual(['assistant', 'user']);
    expect(facets.tags).toEqual(['async', 'memory', 'rust', 'wasm']);
  });

  it('is empty for an empty record set', () => {
    expect(deriveMemoryFacets([])).toEqual({
      sources: [],
      creators: [],
      tags: [],
    });
  });
});
