import { forwardRef, useId, type InputHTMLAttributes } from 'react';
import { cn } from '../../lib/cn.ts';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, id, className, ...rest },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const describedById = hint || error ? `${inputId}-desc` : undefined;
  const invalid = error != null && error !== '';

  return (
    <div className="flex flex-col gap-1.5">
      {label != null && (
        <label htmlFor={inputId} className="text-sm font-medium text-text">
          {label}
        </label>
      )}
      <input
        ref={ref}
        id={inputId}
        aria-invalid={invalid || undefined}
        aria-describedby={describedById}
        className={cn(
          'h-9 rounded-button border bg-surface px-3 text-sm text-text transition-colors',
          'placeholder:text-muted-subtle',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
          'disabled:cursor-not-allowed disabled:bg-surface-subtle disabled:opacity-60',
          invalid ? 'border-danger' : 'border-border',
          className,
        )}
        {...rest}
      />
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
});
