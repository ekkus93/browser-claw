import type { MemoryRow } from '../db/types.ts';

/**
 * Demo memories, seeded into the store ONLY in demo mode and tagged `demo:true`
 * so they're distinguishable from real user/agent memories. In a normal build
 * the memory store starts empty. See HARDENING_NOTES.md (no fake seeded data
 * outside demo mode).
 */
export const SAMPLE_MEMORIES: MemoryRow[] = [
  {
    id: 'mem-1',
    title: 'Rust/WASM architecture overview',
    text: 'BrowserClaw runs a deterministic Rust core compiled to WASM that emits effects for the host to execute.',
    tags: ['rust', 'wasm'],
    source: 'Conversation: Architecture',
    createdBy: 'assistant',
    createdAt: 1,
    lastUsedAt: 5,
    pinned: true,
    sensitivity: 'normal',
    demo: true,
  },
  {
    id: 'mem-2',
    title: 'WebAssembly memory model',
    text: 'WASM linear memory is a contiguous, resizable ArrayBuffer shared with JS.',
    tags: ['wasm', 'memory'],
    source: 'Conversation: Architecture',
    createdBy: 'assistant',
    createdAt: 2,
    lastUsedAt: 4,
    pinned: false,
    sensitivity: 'normal',
    demo: true,
  },
  {
    id: 'mem-3',
    title: 'Rust ownership basics',
    text: 'Each value has a single owner; borrows are checked at compile time.',
    tags: ['rust'],
    source: 'Conversation: Learning Rust',
    createdBy: 'user',
    createdAt: 3,
    pinned: false,
    sensitivity: 'normal',
    demo: true,
  },
];

/**
 * Identity of each seeded sample, used by the one-time cleanup migration to
 * recognize untouched seed rows. Per the cleanup decision (replies1.md Q6) a
 * row counts as an untouched sample only when its id, title, createdBy, and
 * source all still match — if the user edited any of these, we leave it.
 */
const SAMPLE_FINGERPRINTS = new Map(
  SAMPLE_MEMORIES.map((m) => [
    m.id,
    { title: m.title, createdBy: m.createdBy, source: m.source },
  ]),
);

export function isUnmodifiedSampleMemory(row: {
  id: string;
  title: string;
  createdBy: string;
  source: string;
}): boolean {
  const fingerprint = SAMPLE_FINGERPRINTS.get(row.id);
  return (
    fingerprint !== undefined &&
    row.title === fingerprint.title &&
    row.createdBy === fingerprint.createdBy &&
    row.source === fingerprint.source
  );
}
