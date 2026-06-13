import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  AlertTriangle,
  Check,
  Database,
  HardDrive,
  ShieldCheck,
} from 'lucide-react';
import { db } from '../db/db.ts';
import { useAppDispatch, useAppSelector } from '../store/hooks.ts';
import {
  refreshStorageInfo,
  requestPersistentStorage,
  assessStorageHealth,
} from '../services/storageService.ts';
import {
  parseBackup,
  validateBackup,
  importBackup,
  runBackupExport,
  type ValidationResult,
} from '../backup/backupService.ts';
import { recordAudit } from '../audit/auditSink.ts';
import { Button } from '../components/ui/Button.tsx';
import { Badge } from '../components/ui/Badge.tsx';
import { Dialog } from '../components/ui/Dialog.tsx';
import { useToast } from '../components/ui/toastContext.ts';

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const power = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024)),
  );
  const value = bytes / 1024 ** power;
  return `${value.toFixed(power === 0 ? 0 : 1)} ${units[power]}`;
}

function StatCard({
  icon,
  label,
  value,
  sub,
  action,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-card border border-border bg-surface p-4">
      <div className="flex items-center gap-2 text-muted">
        {icon}
        <span className="text-sm font-medium">{label}</span>
      </div>
      <p className="text-xl font-bold text-text">{value}</p>
      {sub != null && <p className="text-xs text-muted-subtle">{sub}</p>}
      {action != null && <div className="mt-2">{action}</div>}
    </div>
  );
}

/** One honest health line: a green check when healthy, an amber warning when not. */
function HealthRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2 text-muted">
      {ok ? (
        <Check className="size-4 text-success" aria-hidden="true" />
      ) : (
        <AlertTriangle className="size-4 text-warning" aria-hidden="true" />
      )}
      {label}
    </li>
  );
}

const BACKUP_INCLUDES = [
  'Conversations',
  'Tasks',
  'Memories',
  'Skills',
  'Optional encrypted secrets',
  'Model references, not model files',
];

export default function StorageScreen() {
  const dispatch = useAppDispatch();
  const { toast } = useToast();
  const storage = useAppSelector((state) => state.storage);

  useEffect(() => {
    void refreshStorageInfo(dispatch);
  }, [dispatch]);

  const backups = useLiveQuery(
    () => db.backup_history.reverse().sortBy('createdAt'),
    [],
  );

  // Real size of the IndexedDB model-blob cache (the no-OPFS fallback), summed
  // from the stored blobs — not a hardcoded figure. (OPFS-cached models aren't
  // measurable here; this reflects what the blob store actually holds.)
  const modelCache = useLiveQuery(async () => {
    const rows = await db.model_blobs.toArray();
    return {
      bytes: rows.reduce((sum, row) => sum + (row.blob?.size ?? 0), 0),
      count: rows.length,
    };
  }, []);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<ValidationResult | null>(null);

  const health = assessStorageHealth(
    { usedBytes: storage.usedBytes, quotaBytes: storage.quotaBytes },
    storage.persisted,
  );
  const quotaPct =
    storage.quotaBytes > 0
      ? Math.round((storage.usedBytes / storage.quotaBytes) * 100)
      : 0;

  async function handleExport() {
    const result = await runBackupExport({
      db,
      dispatch,
      download: (filename, json) => {
        // Throw (don't silently skip) so runBackupExport records a failure and
        // never logs a "saved" backup the user never actually downloaded.
        if (typeof URL.createObjectURL !== 'function') {
          throw new Error('Downloads are not supported in this browser.');
        }
        const url = URL.createObjectURL(
          new Blob([json], { type: 'application/json' }),
        );
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        anchor.click();
        URL.revokeObjectURL(url);
      },
    });
    if (result.ok) {
      toast({ tone: 'success', title: 'Backup exported' });
    } else {
      toast({
        tone: 'danger',
        title: 'Export failed',
        description: result.error ?? 'The backup could not be downloaded.',
      });
    }
  }

  async function handleFile(file: File) {
    try {
      const result = validateBackup(parseBackup(await file.text()));
      if (!result.valid) {
        toast({
          tone: 'danger',
          title: 'Import failed',
          description: result.error ?? 'Invalid backup file.',
        });
        return;
      }
      setPreview(result);
    } catch {
      toast({
        tone: 'danger',
        title: 'Import failed',
        description: 'Unreadable file.',
      });
    }
  }

  async function confirmRestore() {
    const backup = preview?.backup;
    setPreview(null);
    if (!backup) return;
    try {
      await importBackup(db, backup);
      void recordAudit(db, dispatch, {
        type: 'backup.imported',
        summary: `Backup restored (schema v${backup.manifest.schemaVersion})`,
        source: 'backup',
        risk: 'low',
        status: 'success',
      });
      toast({ tone: 'success', title: 'Backup restored' });
    } catch (error) {
      // A failed import rolls back (importBackup is transactional). Surface it
      // and audit the failure — never leave the user thinking it succeeded.
      const message = error instanceof Error ? error.message : String(error);
      void recordAudit(db, dispatch, {
        type: 'backup.import_failed',
        summary: `Backup restore failed: ${message}`,
        source: 'backup',
        risk: 'low',
        status: 'failure',
      });
      toast({
        tone: 'danger',
        title: 'Restore failed',
        description: 'The backup could not be restored.',
      });
    }
  }

  return (
    <div className="overflow-y-auto">
      <div className="grid gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <main className="flex flex-col gap-6">
          <header>
            <h1 className="text-xl font-bold text-text">Storage / Backup</h1>
            <p className="text-sm text-muted">
              Manage local data, backups, and storage.
            </p>
          </header>

          <section>
            <h2 className="mb-3 text-sm font-semibold text-text">
              Storage Overview
            </h2>
            <div className="grid gap-4 sm:grid-cols-3">
              <StatCard
                icon={<Database className="size-4" />}
                label="IndexedDB"
                value={formatBytes(storage.usedBytes)}
                sub={`${quotaPct}% of quota`}
              />
              <StatCard
                icon={<HardDrive className="size-4" />}
                label="Model Cache"
                value={formatBytes(modelCache?.bytes ?? 0)}
                sub={`${modelCache?.count ?? 0} model${
                  (modelCache?.count ?? 0) === 1 ? '' : 's'
                } cached`}
              />
              <StatCard
                icon={<ShieldCheck className="size-4" />}
                label="Persistent storage"
                value={storage.persisted ? 'Granted' : 'Not granted'}
                action={
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      void requestPersistentStorage().then(() =>
                        refreshStorageInfo(dispatch),
                      );
                    }}
                  >
                    Request
                  </Button>
                }
              />
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold text-text">
              Backup &amp; Restore
            </h2>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  void handleExport();
                }}
              >
                Export Backup
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
              >
                Import Backup
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".clawbackup,.json,application/json"
                className="hidden"
                aria-label="Import backup file"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void handleFile(file);
                  event.target.value = '';
                }}
              />
            </div>

            <p className="mt-2 text-xs text-warning">
              Exported backups are unencrypted plaintext JSON (any included
              secrets stay encrypted). Store the file somewhere safe.
            </p>

            <h3 className="mb-2 mt-4 text-sm font-medium text-text">
              What&apos;s included in backups
            </h3>
            <ul className="flex list-inside list-disc flex-col gap-1 text-sm text-muted">
              {BACKUP_INCLUDES.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="mb-2 text-sm font-semibold text-text">
              Future Integrations
            </h2>
            <p className="text-sm text-muted">
              Encrypted Google Drive sync coming later — only encrypted backups
              will ever leave the browser.
            </p>
          </section>
        </main>

        <aside className="flex flex-col gap-4">
          <div className="rounded-card border border-border bg-surface p-4">
            <h2 className="mb-3 text-sm font-semibold text-text">
              Recent Backups
            </h2>
            {backups && backups.length > 0 ? (
              <ul className="flex flex-col gap-2 text-sm">
                {backups.map((backup) => (
                  <li
                    key={backup.id}
                    className="flex items-center justify-between"
                  >
                    <span className="text-muted">
                      {formatBytes(backup.sizeBytes)}
                    </span>
                    <Badge tone="success">Saved</Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">No backups yet.</p>
            )}
          </div>

          <div className="rounded-card border border-border bg-surface p-4">
            <h2 className="mb-3 text-sm font-semibold text-text">
              Local Data Health
            </h2>
            {storage.quotaBytes > 0 ? (
              <ul className="flex flex-col gap-2 text-sm">
                <HealthRow
                  ok={health.level === 'ok'}
                  label={
                    health.level === 'ok'
                      ? `Quota healthy (${quotaPct}% used)`
                      : health.level === 'warning'
                        ? `Quota getting tight (${quotaPct}% used)`
                        : `Quota critical (${quotaPct}% used)`
                  }
                />
                <HealthRow
                  ok={storage.persisted}
                  label={
                    storage.persisted
                      ? 'Persistent storage granted'
                      : 'Persistent storage not granted'
                  }
                />
              </ul>
            ) : (
              <p className="flex items-center gap-2 text-sm text-warning">
                <AlertTriangle
                  className="size-4 shrink-0 text-warning"
                  aria-hidden="true"
                />
                Storage estimate unavailable in this browser.
              </p>
            )}
          </div>

          <div className="rounded-card border border-border bg-surface p-4">
            <h2 className="mb-2 text-sm font-semibold text-text">
              Storage Recommendations
            </h2>
            {health.recommendations.length > 0 ? (
              <ul className="flex list-inside list-disc flex-col gap-1 text-sm text-muted">
                {health.recommendations.map((rec) => (
                  <li key={rec}>{rec}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">Usage normal.</p>
            )}
          </div>
        </aside>
      </div>

      <Dialog
        open={preview !== null}
        onClose={() => setPreview(null)}
        title="Restore backup?"
        description="Records are merged into your local database by id."
        footer={
          <>
            <Button variant="ghost" onClick={() => setPreview(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                void confirmRestore();
              }}
            >
              Restore
            </Button>
          </>
        }
      >
        <ul className="flex flex-col gap-1 text-sm text-muted">
          {Object.entries(preview?.summary ?? {})
            .filter(([, count]) => count > 0)
            .map(([name, count]) => (
              <li key={name} className="flex justify-between">
                <span>{name}</span>
                <span className="tabular-nums text-text">{count}</span>
              </li>
            ))}
        </ul>
        <p className="mt-3 text-xs text-muted-subtle">
          {(preview?.summary?.encrypted_secrets ?? 0) > 0
            ? 'This backup includes encrypted secrets (ciphertext only).'
            : 'This backup contains no secrets.'}
        </p>
      </Dialog>
    </div>
  );
}
