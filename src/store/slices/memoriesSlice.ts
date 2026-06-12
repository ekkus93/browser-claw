import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

/**
 * Memory-manager UI state. Memory records are durable (Dexie, Phase 3 /
 * functionality in Phase 11); this slice owns the transient search, filter,
 * and selection state.
 */
export interface MemoriesState {
  searchQuery: string;
  filterTags: string[];
  selectedMemoryId: string | null;
}

const initialState: MemoriesState = {
  searchQuery: '',
  filterTags: [],
  selectedMemoryId: null,
};

const memoriesSlice = createSlice({
  name: 'memories',
  initialState,
  reducers: {
    searchQuerySet(state, action: PayloadAction<string>) {
      state.searchQuery = action.payload;
    },
    filterTagsSet(state, action: PayloadAction<string[]>) {
      state.filterTags = action.payload;
    },
    selectedMemorySet(state, action: PayloadAction<string | null>) {
      state.selectedMemoryId = action.payload;
    },
  },
});

export const { searchQuerySet, filterTagsSet, selectedMemorySet } =
  memoriesSlice.actions;
export default memoriesSlice.reducer;
