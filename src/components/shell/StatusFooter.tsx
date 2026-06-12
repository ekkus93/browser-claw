import { ChevronRight } from 'lucide-react';

export type RuntimeStatus = 'ready' | 'initializing' | 'busy' | 'error';

export interface StatusFooterProps {
  status?: RuntimeStatus;
  version?: string;
  onViewStatus?: () => void;
}

const STATUS_META: Record<
  RuntimeStatus,
  { dot: string; label: string; message: string }
> = {
  ready: {
    dot: 'bg-success',
    label: 'Runtime',
    message: 'BrowserClaw runtime is ready',
  },
  initializing: {
    dot: 'bg-warning',
    label: 'Runtime',
    message: 'BrowserClaw runtime is starting…',
  },
  busy: {
    dot: 'bg-primary',
    label: 'Runtime',
    message: 'BrowserClaw runtime is working…',
  },
  error: {
    dot: 'bg-danger',
    label: 'Runtime',
    message: 'BrowserClaw runtime hit an error',
  },
};

/**
 * Bottom-of-sidebar runtime status card plus the version footer. Live runtime
 * status is wired to Redux in Phase 2; defaults mirror the canonical mockup.
 */
export function StatusFooter({
  status = 'ready',
  version = 'v0.7.0',
  onViewStatus,
}: StatusFooterProps) {
  const meta = STATUS_META[status];

  return (
    <div className="mt-auto flex flex-col gap-3 p-3">
      <div className="rounded-card border border-border bg-surface-subtle p-3">
        <div className="flex items-center gap-2">
          <span
            className={`size-2 rounded-full ${meta.dot}`}
            aria-hidden="true"
          />
          <span className="text-sm font-semibold text-text">{meta.label}</span>
        </div>
        <p className="mt-1.5 text-sm leading-snug text-muted">{meta.message}</p>
        <button
          type="button"
          onClick={onViewStatus}
          className="mt-2 inline-flex items-center gap-0.5 rounded-sm text-sm font-medium text-primary transition-colors hover:text-primary/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          View status
          <ChevronRight className="size-3.5" aria-hidden="true" />
        </button>
      </div>

      <div className="flex items-center gap-2 px-1">
        <span className="size-1.5 rounded-full bg-success" aria-hidden="true" />
        <span className="text-xs font-medium tabular-nums text-muted-subtle">
          {version}
        </span>
      </div>
    </div>
  );
}
