import type { MemoryRow } from '../db/types.ts';

/**
 * Pure memory filtering. The Memories screen must never show a filter control
 * that does nothing — every value here is applied to the real Dexie-backed
 * record set, so the visible list always reflects the selected filters.
 */

export type SensitivityFilter = 'all' | 'normal' | 'sensitive';

export interface MemoryFilters {
  /** Free-text search over title, body, and tags. */
  query: string;
  sensitivity: SensitivityFilter;
  /** `'all'` or an exact `source` value. */
  source: string;
  /** `'all'` or an exact `createdBy` value. */
  createdBy: string;
  /** `'all'` or an exact tag. */
  tag: string;
  pinnedOnly: boolean;
}

export const DEFAULT_MEMORY_FILTERS: MemoryFilters = {
  query: '',
  sensitivity: 'all',
  source: 'all',
  createdBy: 'all',
  tag: 'all',
  pinnedOnly: false,
};

export function filterMemories(
  memories: readonly MemoryRow[],
  filters: MemoryFilters,
): MemoryRow[] {
  const query = filters.query.trim().toLowerCase();
  return memories.filter((memory) => {
    if (query) {
      const matches =
        memory.title.toLowerCase().includes(query) ||
        memory.text.toLowerCase().includes(query) ||
        memory.tags.some((tag) => tag.toLowerCase().includes(query));
      if (!matches) return false;
    }
    if (
      filters.sensitivity !== 'all' &&
      memory.sensitivity !== filters.sensitivity
    ) {
      return false;
    }
    if (filters.source !== 'all' && memory.source !== filters.source) {
      return false;
    }
    if (filters.createdBy !== 'all' && memory.createdBy !== filters.createdBy) {
      return false;
    }
    if (filters.tag !== 'all' && !memory.tags.includes(filters.tag)) {
      return false;
    }
    if (filters.pinnedOnly && !memory.pinned) {
      return false;
    }
    return true;
  });
}

export interface MemoryFacets {
  sources: string[];
  creators: string[];
  tags: string[];
}

/**
 * Distinct, sorted filter options derived from the actual record set, so the
 * dropdowns only ever offer values that exist in the user's data.
 */
export function deriveMemoryFacets(
  memories: readonly MemoryRow[],
): MemoryFacets {
  const sources = new Set<string>();
  const creators = new Set<string>();
  const tags = new Set<string>();
  for (const memory of memories) {
    sources.add(memory.source);
    creators.add(memory.createdBy);
    for (const tag of memory.tags) tags.add(tag);
  }
  return {
    sources: [...sources].sort(),
    creators: [...creators].sort(),
    tags: [...tags].sort(),
  };
}
