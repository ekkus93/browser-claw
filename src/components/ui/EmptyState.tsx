import type { ReactNode } from 'react';
import { Inbox } from 'lucide-react';
import { cn } from '../../lib/cn.ts';

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-card border border-dashed border-border bg-surface px-6 py-12 text-center',
        className,
      )}
    >
      <span className="flex size-11 items-center justify-center rounded-full bg-surface-subtle text-muted">
        {icon ?? <Inbox className="size-5" aria-hidden="true" />}
      </span>
      <div className="max-w-sm">
        <h3 className="text-md font-semibold text-text">{title}</h3>
        {description != null && (
          <p className="mt-1 text-sm leading-relaxed text-muted">
            {description}
          </p>
        )}
      </div>
      {action != null && <div className="mt-1">{action}</div>}
    </div>
  );
}
