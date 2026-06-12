import { Settings as SettingsIcon, Database } from 'lucide-react';
import { BrandMark } from './BrandMark.tsx';

export interface TopStatusBarProps {
  providerLabel?: string;
  modelLabel?: string;
  /** Bytes used / total for the storage pill. */
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
 * Shared top bar. Live values (active provider/model, storage usage) are wired
 * to Redux in Phase 2; the defaults here mirror the canonical mockup.
 */
export function TopStatusBar({
  providerLabel = 'wllama',
  modelLabel = 'SmolLM2',
  storageUsedBytes = 1.42 * GB,
  storageTotalBytes = 5 * GB,
  onSelectModel,
  onOpenSettings,
}: TopStatusBarProps) {
  const usedRatio =
    storageTotalBytes > 0
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
          <span className="size-2 rounded-full bg-success" aria-hidden="true" />
          <span className="text-muted">{providerLabel}</span>
          <span className="text-muted-subtle">•</span>
          <span>{modelLabel}</span>
        </button>

        <div
          className="flex items-center gap-2.5 rounded-button border border-border bg-surface px-3 py-1.5 text-sm"
          title="Local storage usage"
        >
          <Database className="size-4 text-muted" aria-hidden="true" />
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
