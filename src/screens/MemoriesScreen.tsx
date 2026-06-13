import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Pin, Trash2, Search, Pencil } from 'lucide-react';
import { db } from '../db/db.ts';
import type { MemoryRow } from '../db/types.ts';
import { useAppDispatch, useAppSelector } from '../store/hooks.ts';
import {
  searchQuerySet,
  sensitivityFilterSet,
  sourceFilterSet,
  createdByFilterSet,
  tagFilterSet,
  pinnedOnlySet,
  filtersCleared,
  selectedMemorySet,
} from '../store/slices/memoriesSlice.ts';
import {
  filterMemories,
  deriveMemoryFacets,
  type SensitivityFilter,
} from '../memories/filterMemories.ts';
import { Input } from '../components/ui/Input.tsx';
import { Select } from '../components/ui/Select.tsx';
import { Badge } from '../components/ui/Badge.tsx';
import { Button } from '../components/ui/Button.tsx';
import { EmptyState } from '../components/ui/EmptyState.tsx';
import { cn } from '../lib/cn.ts';
import { appConfig } from '../config/appConfig.ts';
import { SAMPLE_MEMORIES } from '../memories/sampleMemories.ts';

export default function MemoriesScreen() {
  const dispatch = useAppDispatch();
  const searchQuery = useAppSelector((state) => state.memories.searchQuery);
  const sensitivityFilter = useAppSelector(
    (state) => state.memories.sensitivityFilter,
  );
  const sourceFilter = useAppSelector((state) => state.memories.sourceFilter);
  const createdByFilter = useAppSelector(
    (state) => state.memories.createdByFilter,
  );
  const tagFilter = useAppSelector((state) => state.memories.tagFilter);
  const pinnedOnly = useAppSelector((state) => state.memories.pinnedOnly);
  const selectedMemoryId = useAppSelector(
    (state) => state.memories.selectedMemoryId,
  );
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftText, setDraftText] = useState('');

  useEffect(() => {
    // Seed sample memories ONLY in demo mode; a normal build starts empty.
    if (!appConfig.isDemoMode) return;
    void (async () => {
      if ((await db.memories.count()) === 0) {
        await db.memories.bulkPut(SAMPLE_MEMORIES);
      }
    })();
  }, []);

  const memories =
    useLiveQuery(() => db.memories.orderBy('createdAt').toArray(), []) ?? [];

  const facets = deriveMemoryFacets(memories);
  const filtered = filterMemories(memories, {
    query: searchQuery,
    sensitivity: sensitivityFilter,
    source: sourceFilter,
    createdBy: createdByFilter,
    tag: tagFilter,
    pinnedOnly,
  });
  const filtersActive =
    searchQuery.trim() !== '' ||
    sensitivityFilter !== 'all' ||
    sourceFilter !== 'all' ||
    createdByFilter !== 'all' ||
    tagFilter !== 'all' ||
    pinnedOnly;

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
  // Memories that have actually been retrieved into a chat (drives the two
  // sidebar lists). Kept honest: when nothing has been used yet the lists show
  // an explicit empty message instead of a blank, ambiguous box.
  const usedMemories = memories.filter((m) => m.lastUsedAt != null);
  const recentlyRetrieved = [...usedMemories].sort(
    (a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0),
  );

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

          <div className="flex flex-col gap-3">
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
              <Select
                label="Sensitivity"
                value={sensitivityFilter}
                onChange={(event) =>
                  dispatch(
                    sensitivityFilterSet(
                      event.target.value as SensitivityFilter,
                    ),
                  )
                }
              >
                <option value="all">All</option>
                <option value="normal">Normal</option>
                <option value="sensitive">Sensitive</option>
              </Select>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <Select
                label="Source"
                value={sourceFilter}
                onChange={(event) =>
                  dispatch(sourceFilterSet(event.target.value))
                }
              >
                <option value="all">All sources</option>
                {facets.sources.map((source) => (
                  <option key={source} value={source}>
                    {source}
                  </option>
                ))}
              </Select>
              <Select
                label="Created by"
                value={createdByFilter}
                onChange={(event) =>
                  dispatch(createdByFilterSet(event.target.value))
                }
              >
                <option value="all">Anyone</option>
                {facets.creators.map((creator) => (
                  <option key={creator} value={creator}>
                    {creator}
                  </option>
                ))}
              </Select>
              <Select
                label="Tag"
                value={tagFilter}
                onChange={(event) => dispatch(tagFilterSet(event.target.value))}
              >
                <option value="all">All tags</option>
                {facets.tags.map((tag) => (
                  <option key={tag} value={tag}>
                    {tag}
                  </option>
                ))}
              </Select>
              <label className="flex h-9 items-center gap-2 text-sm font-medium text-text">
                <input
                  type="checkbox"
                  checked={pinnedOnly}
                  onChange={(event) =>
                    dispatch(pinnedOnlySet(event.target.checked))
                  }
                  className="size-4 rounded border-border text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                />
                Pinned only
              </label>
              {filtersActive && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => dispatch(filtersCleared())}
                >
                  Clear filters
                </Button>
              )}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
            <div className="flex flex-col gap-2">
              {filtered.length === 0 ? (
                <EmptyState
                  icon={<Search className="size-5" />}
                  title="No memories found"
                  description={
                    filtersActive
                      ? 'No memories match the current filters.'
                      : 'No memories yet.'
                  }
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
                      <div className="flex items-center gap-2">
                        <h2 className="text-md font-semibold text-text">
                          {selected.title}
                        </h2>
                        {selected.demo && <Badge tone="warning">Demo</Badge>}
                      </div>
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
              {usedMemories.length === 0 ? (
                <li className="text-muted-subtle">No memories used yet.</li>
              ) : (
                usedMemories.map((m) => (
                  <li key={m.id} className="truncate">
                    {m.title}
                  </li>
                ))
              )}
            </ul>
          </div>

          <div className="rounded-card border border-border bg-surface p-4">
            <h2 className="mb-3 text-sm font-semibold text-text">
              Retrieval history
            </h2>
            <ul className="flex flex-col gap-1.5 text-sm">
              {recentlyRetrieved.length === 0 ? (
                <li className="text-muted-subtle">No retrievals yet.</li>
              ) : (
                recentlyRetrieved.map((m) => (
                  <li
                    key={m.id}
                    className="flex items-center justify-between gap-2"
                  >
                    <span className="truncate text-muted">{m.title}</span>
                    <span className="tabular-nums text-muted-subtle">
                      #{m.lastUsedAt}
                    </span>
                  </li>
                ))
              )}
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
