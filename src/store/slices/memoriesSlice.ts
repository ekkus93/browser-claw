import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import {
  DEFAULT_MEMORY_FILTERS,
  type SensitivityFilter,
} from '../../memories/filterMemories.ts';

/**
 * Memory-manager UI state. Memory records are durable (Dexie); this slice owns
 * the transient search, filter, and selection state. Every filter field here is
 * applied to the real record set by the Memories screen — no decorative
 * controls.
 */
export interface MemoriesState {
  searchQuery: string;
  sensitivityFilter: SensitivityFilter;
  /** `'all'` or an exact `source` value. */
  sourceFilter: string;
  /** `'all'` or an exact `createdBy` value. */
  createdByFilter: string;
  /** `'all'` or an exact tag. */
  tagFilter: string;
  pinnedOnly: boolean;
  selectedMemoryId: string | null;
}

const initialState: MemoriesState = {
  searchQuery: DEFAULT_MEMORY_FILTERS.query,
  sensitivityFilter: DEFAULT_MEMORY_FILTERS.sensitivity,
  sourceFilter: DEFAULT_MEMORY_FILTERS.source,
  createdByFilter: DEFAULT_MEMORY_FILTERS.createdBy,
  tagFilter: DEFAULT_MEMORY_FILTERS.tag,
  pinnedOnly: DEFAULT_MEMORY_FILTERS.pinnedOnly,
  selectedMemoryId: null,
};

const memoriesSlice = createSlice({
  name: 'memories',
  initialState,
  reducers: {
    searchQuerySet(state, action: PayloadAction<string>) {
      state.searchQuery = action.payload;
    },
    sensitivityFilterSet(state, action: PayloadAction<SensitivityFilter>) {
      state.sensitivityFilter = action.payload;
    },
    sourceFilterSet(state, action: PayloadAction<string>) {
      state.sourceFilter = action.payload;
    },
    createdByFilterSet(state, action: PayloadAction<string>) {
      state.createdByFilter = action.payload;
    },
    tagFilterSet(state, action: PayloadAction<string>) {
      state.tagFilter = action.payload;
    },
    pinnedOnlySet(state, action: PayloadAction<boolean>) {
      state.pinnedOnly = action.payload;
    },
    filtersCleared(state) {
      state.searchQuery = DEFAULT_MEMORY_FILTERS.query;
      state.sensitivityFilter = DEFAULT_MEMORY_FILTERS.sensitivity;
      state.sourceFilter = DEFAULT_MEMORY_FILTERS.source;
      state.createdByFilter = DEFAULT_MEMORY_FILTERS.createdBy;
      state.tagFilter = DEFAULT_MEMORY_FILTERS.tag;
      state.pinnedOnly = DEFAULT_MEMORY_FILTERS.pinnedOnly;
    },
    selectedMemorySet(state, action: PayloadAction<string | null>) {
      state.selectedMemoryId = action.payload;
    },
  },
});

export const {
  searchQuerySet,
  sensitivityFilterSet,
  sourceFilterSet,
  createdByFilterSet,
  tagFilterSet,
  pinnedOnlySet,
  filtersCleared,
  selectedMemorySet,
} = memoriesSlice.actions;
export default memoriesSlice.reducer;
