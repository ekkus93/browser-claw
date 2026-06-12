import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Pin, Trash2, Search, Pencil } from 'lucide-react';
import { db } from '../db/db.ts';
import type { MemoryRow } from '../db/types.ts';
import { useAppDispatch, useAppSelector } from '../store/hooks.ts';
import {
  searchQuerySet,
  selectedMemorySet,
} from '../store/slices/memoriesSlice.ts';
import { Input } from '../components/ui/Input.tsx';
import { Select } from '../components/ui/Select.tsx';
import { Badge } from '../components/ui/Badge.tsx';
import { Button } from '../components/ui/Button.tsx';
import { EmptyState } from '../components/ui/EmptyState.tsx';
import { cn } from '../lib/cn.ts';

const SAMPLE_MEMORIES: MemoryRow[] = [
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
  },
];

export default function MemoriesScreen() {
  const dispatch = useAppDispatch();
  const searchQuery = useAppSelector((state) => state.memories.searchQuery);
  const selectedMemoryId = useAppSelector(
    (state) => state.memories.selectedMemoryId,
  );
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftText, setDraftText] = useState('');

  useEffect(() => {
    void (async () => {
      if ((await db.memories.count()) === 0) {
        await db.memories.bulkPut(SAMPLE_MEMORIES);
      }
    })();
  }, []);

  const memories =
    useLiveQuery(() => db.memories.orderBy('createdAt').toArray(), []) ?? [];

  const query = searchQuery.trim().toLowerCase();
  const filtered = query
    ? memories.filter(
        (memory) =>
          memory.title.toLowerCase().includes(query) ||
          memory.text.toLowerCase().includes(query) ||
          memory.tags.some((tag) => tag.includes(query)),
      )
    : memories;

  const selected =
    filtered.find((memory) => memory.id === selectedMemoryId) ?? filtered[0];

  function togglePin(memory: MemoryRow) {
    void db.memories.update(memory.id, { pinned: !memory.pinned });
  }

  function remove(id: string) {
    void db.memories.delete(id);
    if (selectedMemoryId === id) dispatch(selectedMemorySet(null));
  }

  function saveEdit(id: string, title: string, text: string) {
    void db.memories.update(id, { title, text });
    setEditing(false);
  }

  const pinnedCount = memories.filter((m) => m.pinned).length;

  return (
    <div className="overflow-y-auto">
      <div className="grid gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <main className="flex min-w-0 flex-col gap-4">
          <header>
            <h1 className="text-xl font-bold text-text">Memories</h1>
            <p className="text-sm text-muted">
              Search, view, and manage knowledge memories.
            </p>
          </header>

          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-56 flex-1">
              <Input
                label="Search"
                placeholder="Search memories…"
                value={searchQuery}
                onChange={(event) =>
                  dispatch(searchQuerySet(event.target.value))
                }
              />
            </div>
            <Select label="Sensitivity" defaultValue="all">
              <option value="all">All</option>
              <option value="normal">Normal</option>
              <option value="sensitive">Sensitive</option>
            </Select>
          </div>

          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
            <div className="flex flex-col gap-2">
              {filtered.length === 0 ? (
                <EmptyState
                  icon={<Search className="size-5" />}
                  title="No memories found"
                  description="Try a different search."
                />
              ) : (
                filtered.map((memory) => (
                  <button
                    key={memory.id}
                    type="button"
                    onClick={() => dispatch(selectedMemorySet(memory.id))}
                    className={cn(
                      'rounded-button border px-3 py-2 text-left',
                      memory.id === selected?.id
                        ? 'border-primary bg-primary-subtle'
                        : 'border-border hover:bg-surface-subtle',
                    )}
                  >
                    <div className="flex items-center gap-1.5">
                      {memory.pinned && (
                        <Pin
                          className="size-3.5 text-primary"
                          aria-label="Pinned"
                        />
                      )}
                      <span className="truncate text-sm font-medium text-text">
                        {memory.title}
                      </span>
                    </div>
                    <span className="text-xs text-muted-subtle">
                      tags: {memory.tags.join(', ')}
                    </span>
                  </button>
                ))
              )}
            </div>

            {selected && (
              <div className="rounded-card border border-border bg-surface p-4">
                {editing ? (
                  <div className="flex flex-col gap-3">
                    <Input
                      label="Title"
                      value={draftTitle}
                      onChange={(event) => setDraftTitle(event.target.value)}
                    />
                    <label className="flex flex-col gap-1.5 text-sm font-medium text-text">
                      Body
                      <textarea
                        value={draftText}
                        onChange={(event) => setDraftText(event.target.value)}
                        rows={4}
                        className="rounded-button border border-border bg-surface p-2 text-sm font-normal text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                      />
                    </label>
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditing(false)}
                      >
                        Cancel
                      </Button>
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() =>
                          saveEdit(selected.id, draftTitle, draftText)
                        }
                      >
                        Save
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-start justify-between gap-2">
                      <h2 className="text-md font-semibold text-text">
                        {selected.title}
                      </h2>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          leadingIcon={<Pencil className="size-4" />}
                          onClick={() => {
                            setDraftTitle(selected.title);
                            setDraftText(selected.text);
                            setEditing(true);
                          }}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          leadingIcon={<Pin className="size-4" />}
                          onClick={() => togglePin(selected)}
                        >
                          {selected.pinned ? 'Unpin' : 'Pin'}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          leadingIcon={<Trash2 className="size-4" />}
                          onClick={() => remove(selected.id)}
                        >
                          Delete
                        </Button>
                      </div>
                    </div>
                    <p className="mt-2 text-sm text-muted">{selected.text}</p>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {selected.tags.map((tag) => (
                        <Badge key={tag} tone="primary">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                    <dl className="mt-4 flex flex-col gap-1.5 text-sm">
                      <Row label="Source" value={selected.source} />
                      <Row label="Created by" value={selected.createdBy} />
                      <Row label="Sensitivity" value={selected.sensitivity} />
                    </dl>
                  </>
                )}
              </div>
            )}
          </div>
        </main>

        <aside className="flex flex-col gap-4">
          <div className="rounded-card border border-border bg-surface p-4">
            <h2 className="mb-3 text-sm font-semibold text-text">
              Memory stats
            </h2>
            <dl className="flex flex-col gap-1.5 text-sm">
              <Row label="Total memories" value={String(memories.length)} />
              <Row label="Pinned" value={String(pinnedCount)} />
            </dl>
          </div>

          <div className="rounded-card border border-border bg-surface p-4">
            <h2 className="mb-3 text-sm font-semibold text-text">
              Recently used
            </h2>
            <ul className="flex flex-col gap-1 text-sm text-muted">
              {memories
                .filter((m) => m.lastUsedAt != null)
                .map((m) => (
                  <li key={m.id} className="truncate">
                    {m.title}
                  </li>
                ))}
            </ul>
          </div>

          <div className="rounded-card border border-border bg-surface p-4">
            <h2 className="mb-3 text-sm font-semibold text-text">
              Retrieval history
            </h2>
            <ul className="flex flex-col gap-1.5 text-sm">
              {[...memories]
                .filter((m) => m.lastUsedAt != null)
                .sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0))
                .map((m) => (
                  <li
                    key={m.id}
                    className="flex items-center justify-between gap-2"
                  >
                    <span className="truncate text-muted">{m.title}</span>
                    <span className="tabular-nums text-muted-subtle">
                      #{m.lastUsedAt}
                    </span>
                  </li>
                ))}
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-muted-subtle">{label}</dt>
      <dd className="truncate font-medium text-text">{value}</dd>
    </div>
  );
}
