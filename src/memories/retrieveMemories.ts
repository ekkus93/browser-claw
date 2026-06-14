import type { MemoryRow } from '../db/types.ts';

/**
 * Pure selection of which saved memories to surface into an LLM prompt for a
 * turn. Kept separate from the runner so the ranking is unit-testable and has
 * no IndexedDB or Date dependency.
 *
 * Security: memories marked `sensitivity: 'sensitive'` are NEVER surfaced — they
 * must not silently leak into a provider request. Decrypted secrets never live
 * in a memory row in the first place (SecretVault only), so the remaining rows
 * are safe to include as model context.
 */

export interface MemoryRetrievalOptions {
  /** Max memories to surface into the prompt. */
  limit?: number;
}

const DEFAULT_LIMIT = 5;

/** Lowercased word tokens (length >= 3), deduped — a cheap keyword bag. */
function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length >= 3),
  );
}

/** Count of query tokens that appear in the memory's title/text/tags. */
function relevanceScore(memory: MemoryRow, queryTokens: Set<string>): number {
  if (queryTokens.size === 0) return 0;
  const haystack = tokenize(
    `${memory.title} ${memory.text} ${memory.tags.join(' ')}`,
  );
  let score = 0;
  for (const token of queryTokens) {
    if (haystack.has(token)) score += 1;
  }
  return score;
}

/**
 * Choose memories to inject for a turn. Pinned memories are always candidates
 * (the user marked them keep-handy); the rest qualify only if they share a
 * keyword with the user's latest message. The result is pinned-first, then by
 * descending keyword overlap, then newest-first, capped at `limit`.
 */
export function selectMemoriesForContext(
  memories: readonly MemoryRow[],
  queryText: string,
  options: MemoryRetrievalOptions = {},
): MemoryRow[] {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const queryTokens = tokenize(queryText);
  return memories
    .filter((memory) => memory.sensitivity !== 'sensitive')
    .map((memory) => ({ memory, score: relevanceScore(memory, queryTokens) }))
    .filter((entry) => entry.score > 0 || entry.memory.pinned)
    .sort((a, b) => {
      if (a.memory.pinned !== b.memory.pinned) return a.memory.pinned ? -1 : 1;
      if (b.score !== a.score) return b.score - a.score;
      return b.memory.createdAt - a.memory.createdAt;
    })
    .slice(0, limit)
    .map((entry) => entry.memory);
}

/** Render the chosen memories as a single system-message context block. */
export function formatMemoryContext(memories: readonly MemoryRow[]): string {
  const lines = memories.map((memory) => `- ${memory.title}: ${memory.text}`);
  return `Relevant saved memories (use if helpful):\n${lines.join('\n')}`;
}
