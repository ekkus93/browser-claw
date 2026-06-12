import { describe, expect, it } from 'vitest';
import memoriesReducer, {
  searchQuerySet,
  filterTagsSet,
  selectedMemorySet,
} from './memoriesSlice.ts';

describe('memoriesSlice', () => {
  it('starts empty', () => {
    const state = memoriesReducer(undefined, { type: '@@INIT' });
    expect(state).toEqual({
      searchQuery: '',
      filterTags: [],
      selectedMemoryId: null,
    });
  });

  it('updates search, filters, and selection', () => {
    let state = memoriesReducer(undefined, searchQuerySet('api keys'));
    expect(state.searchQuery).toBe('api keys');
    state = memoriesReducer(state, filterTagsSet(['work', 'pinned']));
    expect(state.filterTags).toEqual(['work', 'pinned']);
    state = memoriesReducer(state, selectedMemorySet('mem-3'));
    expect(state.selectedMemoryId).toBe('mem-3');
  });
});
