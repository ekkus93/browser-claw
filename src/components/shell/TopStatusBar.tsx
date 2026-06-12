import { Settings as SettingsIcon, Database } from 'lucide-react';
import { BrandMark } from './BrandMark.tsx';

export interface TopStatusBarProps {
  providerLabel?: string | null;
  modelLabel?: string | null;
  /** Bytes used / total for the storage pill; total 0 means "not measured". */
  storageUsedBytes?: number;
  storageTotalBytes?: number;
  onSelectModel?: () => void;
  onOpenSettings?: () => void;
}

const GB = 1024 ** 3;

function formatGb(bytes: number): string {
  return `${(bytes / GB).toFixed(2)} GB`;
}

/**
 * Shared top bar. Live values (active provider/model, storage usage) come from
 * Redux via AppLayout; absent values render an honest empty state.
 */
export function TopStatusBar({
  providerLabel,
  modelLabel,
  storageUsedBytes = 0,
  storageTotalBytes = 0,
  onSelectModel,
  onOpenSettings,
}: TopStatusBarProps) {
  const hasModel = providerLabel != null || modelLabel != null;
  const hasStorage = storageTotalBytes > 0;
  const usedRatio = hasStorage
    ? Math.min(1, storageUsedBytes / storageTotalBytes)
    : 0;

  return (
    <header className="flex h-14 items-center justify-between border-b border-border bg-surface px-4">
      <div className="flex items-center gap-2.5">
        <BrandMark />
        <span className="text-lg font-extrabold tracking-tight text-text">
          BrowserClaw
        </span>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onSelectModel}
          className="group flex items-center gap-2 rounded-button border border-border bg-surface px-3 py-1.5 text-sm font-medium text-text transition-colors hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          title="Change active model or provider"
        >
          {hasModel ? (
            <>
              <span
                className="size-2 rounded-full bg-success"
                aria-hidden="true"
              />
              {providerLabel != null && (
                <span className="text-muted">{providerLabel}</span>
              )}
              {providerLabel != null && modelLabel != null && (
                <span className="text-muted-subtle">•</span>
              )}
              {modelLabel != null && <span>{modelLabel}</span>}
            </>
          ) : (
            <>
              <span
                className="size-2 rounded-full bg-muted-subtle"
                aria-hidden="true"
              />
              <span className="text-muted">No model selected</span>
            </>
          )}
        </button>

        <div
          className="flex items-center gap-2.5 rounded-button border border-border bg-surface px-3 py-1.5 text-sm"
          title="Local storage usage"
        >
          <Database className="size-4 text-muted" aria-hidden="true" />
          {hasStorage ? (
            <>
              <span className="tabular-nums text-muted">
                {formatGb(storageUsedBytes)}{' '}
                <span className="text-muted-subtle">/</span>{' '}
                {formatGb(storageTotalBytes)}
              </span>
              <span
                className="h-1.5 w-16 overflow-hidden rounded-full bg-background"
                role="progressbar"
                aria-label="Storage used"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(usedRatio * 100)}
              >
                <span
                  className="block h-full rounded-full bg-primary"
                  style={{ width: `${usedRatio * 100}%` }}
                />
              </span>
            </>
          ) : (
            <span className="text-muted-subtle">Storage not measured</span>
          )}
        </div>

        <button
          type="button"
          onClick={onOpenSettings}
          className="flex items-center gap-2 rounded-button border border-border bg-surface px-3 py-1.5 text-sm font-medium text-text transition-colors hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <SettingsIcon className="size-4 text-muted" aria-hidden="true" />
          Settings
        </button>
      </div>
    </header>
  );
}
