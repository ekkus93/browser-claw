import { forwardRef, useId, type SelectHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../lib/cn.ts';

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  hint?: string;
  error?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  function Select(
    { label, hint, error, id, className, children, ...rest },
    ref,
  ) {
    const autoId = useId();
    const selectId = id ?? autoId;
    const describedById = hint || error ? `${selectId}-desc` : undefined;
    const invalid = error != null && error !== '';

    return (
      <div className="flex flex-col gap-1.5">
        {label != null && (
          <label htmlFor={selectId} className="text-sm font-medium text-text">
            {label}
          </label>
        )}
        <div className="relative">
          <select
            ref={ref}
            id={selectId}
            aria-invalid={invalid || undefined}
            aria-describedby={describedById}
            className={cn(
              'h-9 w-full appearance-none rounded-button border bg-surface pl-3 pr-9 text-sm text-text transition-colors',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
              'disabled:cursor-not-allowed disabled:bg-surface-subtle disabled:opacity-60',
              invalid ? 'border-danger' : 'border-border',
              className,
            )}
            {...rest}
          >
            {children}
          </select>
          <ChevronDown
            className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted"
            aria-hidden="true"
          />
        </div>
        {(hint || error) && (
          <p
            id={describedById}
            className={cn('text-xs', invalid ? 'text-danger' : 'text-muted')}
          >
            {error || hint}
          </p>
        )}
      </div>
    );
  },
);
