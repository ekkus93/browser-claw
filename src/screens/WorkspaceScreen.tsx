import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { FileText, FolderTree } from 'lucide-react';
import { db } from '../db/db.ts';
import {
  createContentStore,
  isOpfsAvailable,
} from '../workspace/contentStore.ts';
import { WorkspaceFs } from '../workspace/workspaceFs.ts';
import { Badge } from '../components/ui/Badge.tsx';
import { Button } from '../components/ui/Button.tsx';
import { Input } from '../components/ui/Input.tsx';
import { cn } from '../lib/cn.ts';

/**
 * Workspace screen (Part B7): browse the app-private workspace filesystem —
 * metadata from `workspace_files`, file bytes from the ContentStore (OPFS).
 * Reads are shown; create/upload/download are marked as future work (disabled),
 * and an honest banner shows when OPFS-backed storage is unavailable.
 */
export default function WorkspaceScreen() {
  const fs = useMemo(
    () => new WorkspaceFs({ db, content: createContentStore() }),
    [],
  );
  const opfs = isOpfsAvailable();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const files =
    useLiveQuery(() => db.workspace_files.orderBy('path').toArray(), []) ?? [];
  const visible = files.filter(
    (f) =>
      f.kind === 'file' &&
      f.path.toLowerCase().includes(query.trim().toLowerCase()),
  );

  async function open(path: string): Promise<void> {
    setSelected(path);
    setPreview(null);
    setPreviewError(null);
    try {
      setPreview(await fs.readText(path));
    } catch (error) {
      setPreviewError(
        error instanceof Error ? error.message : 'Could not read the file.',
      );
    }
  }

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FolderTree className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold text-text">Workspace</h2>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" disabled title="Coming soon">
            New file
          </Button>
          <Button size="sm" variant="secondary" disabled title="Coming soon">
            Upload
          </Button>
          <Button size="sm" variant="secondary" disabled title="Coming soon">
            Download
          </Button>
        </div>
      </header>

      {!opfs && (
        <div
          role="status"
          className="rounded-card border border-warning bg-warning-subtle p-3 text-sm text-text"
        >
          Workspace file storage (OPFS) isn&apos;t available in this browser, so
          file contents can&apos;t be read or written here. File metadata still
          lists below.
        </div>
      )}

      <Input
        label="Filter by path"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="/workspace/…"
      />

      <div className="grid min-h-0 flex-1 grid-cols-[320px_1fr] gap-4">
        <div className="min-h-0 overflow-auto rounded-card border border-border bg-surface">
          {visible.length === 0 ? (
            <p className="p-4 text-sm text-muted">
              {files.length === 0
                ? 'The workspace is empty. Agent runs and research bundles will create files here.'
                : 'No files match this filter.'}
            </p>
          ) : (
            <ul>
              {visible.map((f) => (
                <li key={f.id}>
                  <button
                    type="button"
                    onClick={() => void open(f.path)}
                    className={cn(
                      'flex w-full items-center gap-2 border-b border-border px-3 py-2 text-left text-sm hover:bg-surface-subtle',
                      selected === f.path && 'bg-primary-subtle text-primary',
                    )}
                  >
                    <FileText className="h-4 w-4 shrink-0 text-muted" />
                    <span className="truncate">{f.path}</span>
                    <Badge tone="neutral">{f.sizeBytes}B</Badge>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="min-h-0 overflow-auto rounded-card border border-border bg-surface p-4">
          {selected === null ? (
            <p className="text-sm text-muted">
              Select a file to preview its contents.
            </p>
          ) : previewError !== null ? (
            <p className="text-sm text-danger">{previewError}</p>
          ) : (
            <pre className="whitespace-pre-wrap break-words text-sm text-text">
              {preview}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
