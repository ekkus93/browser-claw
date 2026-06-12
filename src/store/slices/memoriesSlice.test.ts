import { describe, expect, it } from 'vitest';
import memoriesReducer, {
  searchQuerySet,
  sensitivityFilterSet,
  sourceFilterSet,
  createdByFilterSet,
  tagFilterSet,
  pinnedOnlySet,
  filtersCleared,
  selectedMemorySet,
} from './memoriesSlice.ts';

describe('memoriesSlice', () => {
  it('starts empty', () => {
    const state = memoriesReducer(undefined, { type: '@@INIT' });
    expect(state).toEqual({
      searchQuery: '',
      sensitivityFilter: 'all',
      sourceFilter: 'all',
      createdByFilter: 'all',
      tagFilter: 'all',
      pinnedOnly: false,
      selectedMemoryId: null,
    });
  });

  it('updates search, filters, and selection', () => {
    let state = memoriesReducer(undefined, searchQuerySet('api keys'));
    expect(state.searchQuery).toBe('api keys');
    state = memoriesReducer(state, sensitivityFilterSet('sensitive'));
    expect(state.sensitivityFilter).toBe('sensitive');
    state = memoriesReducer(state, sourceFilterSet('Conversation: Arch'));
    expect(state.sourceFilter).toBe('Conversation: Arch');
    state = memoriesReducer(state, createdByFilterSet('user'));
    expect(state.createdByFilter).toBe('user');
    state = memoriesReducer(state, tagFilterSet('rust'));
    expect(state.tagFilter).toBe('rust');
    state = memoriesReducer(state, pinnedOnlySet(true));
    expect(state.pinnedOnly).toBe(true);
    state = memoriesReducer(state, selectedMemorySet('mem-3'));
    expect(state.selectedMemoryId).toBe('mem-3');
  });

  it('filtersCleared resets every filter but keeps the selection', () => {
    let state = memoriesReducer(undefined, searchQuerySet('x'));
    state = memoriesReducer(state, sensitivityFilterSet('sensitive'));
    state = memoriesReducer(state, sourceFilterSet('s'));
    state = memoriesReducer(state, createdByFilterSet('user'));
    state = memoriesReducer(state, tagFilterSet('rust'));
    state = memoriesReducer(state, pinnedOnlySet(true));
    state = memoriesReducer(state, selectedMemorySet('mem-3'));

    state = memoriesReducer(state, filtersCleared());

    expect(state.searchQuery).toBe('');
    expect(state.sensitivityFilter).toBe('all');
    expect(state.sourceFilter).toBe('all');
    expect(state.createdByFilter).toBe('all');
    expect(state.tagFilter).toBe('all');
    expect(state.pinnedOnly).toBe(false);
    // Clearing filters must not change which memory is open.
    expect(state.selectedMemoryId).toBe('mem-3');
  });
});
