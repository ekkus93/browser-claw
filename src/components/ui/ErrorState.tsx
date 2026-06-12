import type { ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { cn } from '../../lib/cn.ts';

export interface ErrorStateProps {
  title?: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function ErrorState({
  title = 'Something went wrong',
  description,
  action,
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-card border border-danger-subtle bg-danger-subtle px-6 py-12 text-center',
        className,
      )}
    >
      <span className="flex size-11 items-center justify-center rounded-full bg-surface text-danger">
        <AlertTriangle className="size-5" aria-hidden="true" />
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
