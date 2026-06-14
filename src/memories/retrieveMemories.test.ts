import { describe, expect, it } from 'vitest';
import type { MemoryRow } from '../db/types.ts';
import {
  selectMemoriesForContext,
  formatMemoryContext,
} from './retrieveMemories.ts';

function memory(overrides: Partial<MemoryRow>): MemoryRow {
  return {
    id: overrides.id ?? 'm',
    title: overrides.title ?? '',
    text: overrides.text ?? '',
    tags: overrides.tags ?? [],
    source: overrides.source ?? 'user',
    createdBy: overrides.createdBy ?? 'user',
    createdAt: overrides.createdAt ?? 0,
    pinned: overrides.pinned ?? false,
    sensitivity: overrides.sensitivity ?? 'normal',
    ...overrides,
  };
}

describe('selectMemoriesForContext', () => {
  it('returns memories whose keywords overlap the query, most relevant first', () => {
    const rust = memory({
      id: 'rust',
      title: 'Rust ownership',
      text: 'the borrow checker enforces ownership',
    });
    const cooking = memory({
      id: 'cooking',
      title: 'Pasta',
      text: 'boil water and add salt',
    });
    const result = selectMemoriesForContext(
      [cooking, rust],
      'explain rust ownership please',
    );
    expect(result.map((m) => m.id)).toEqual(['rust']);
  });

  it('never surfaces sensitive memories even on a direct keyword match', () => {
    const secret = memory({
      id: 'secret',
      title: 'API token note',
      text: 'rotate the staging token monthly',
      sensitivity: 'sensitive',
    });
    const result = selectMemoriesForContext([secret], 'rotate the token');
    expect(result).toHaveLength(0);
  });

  it('includes pinned memories even with no keyword overlap, ranked first', () => {
    const pinned = memory({
      id: 'pinned',
      title: 'Always remember',
      text: 'the user prefers metric units',
      pinned: true,
    });
    const match = memory({
      id: 'match',
      title: 'Widgets',
      text: 'widgets ship on tuesday',
    });
    const result = selectMemoriesForContext(
      [match, pinned],
      'when do widgets ship',
    );
    expect(result.map((m) => m.id)).toEqual(['pinned', 'match']);
  });

  it('caps the result at the requested limit', () => {
    const memories = Array.from({ length: 10 }, (_, i) =>
      memory({ id: `m${i}`, title: 'note', text: 'shared keyword here' }),
    );
    const result = selectMemoriesForContext(memories, 'shared keyword', {
      limit: 3,
    });
    expect(result).toHaveLength(3);
  });

  it('returns nothing when no memory is relevant and none are pinned', () => {
    const unrelated = memory({ id: 'x', title: 'cats', text: 'meow' });
    expect(selectMemoriesForContext([unrelated], 'database indexing')).toEqual(
      [],
    );
  });
});

describe('formatMemoryContext', () => {
  it('renders a titled, bulleted context block', () => {
    const block = formatMemoryContext([
      memory({ title: 'Rust', text: 'ownership' }),
    ]);
    expect(block).toContain('Relevant saved memories');
    expect(block).toContain('- Rust: ownership');
  });
});
