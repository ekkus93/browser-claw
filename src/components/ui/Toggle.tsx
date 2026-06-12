import { useId } from 'react';
import { cn } from '../../lib/cn.ts';

export interface ToggleProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label?: string;
  /** Accessible name when there is no visible label. */
  ariaLabel?: string;
  disabled?: boolean;
  id?: string;
}

/**
 * Accessible switch. Renders a real button with role="switch" so it is
 * keyboard-operable and announced correctly by assistive tech.
 */
export function Toggle({
  checked,
  onCheckedChange,
  label,
  ariaLabel,
  disabled = false,
  id,
}: ToggleProps) {
  const autoId = useId();
  const labelId = label ? `${id ?? autoId}-label` : undefined;

  return (
    <span className="inline-flex items-center gap-2.5">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        aria-label={labelId ? undefined : ariaLabel}
        disabled={disabled}
        onClick={() => onCheckedChange(!checked)}
        className={cn(
          'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
          'disabled:cursor-not-allowed disabled:opacity-50',
          checked ? 'bg-primary' : 'bg-muted-subtle',
        )}
      >
        <span
          className={cn(
            'inline-block size-4 rounded-full bg-surface shadow-sm transition-transform',
            checked ? 'translate-x-4' : 'translate-x-0.5',
          )}
          aria-hidden="true"
        />
      </button>
      {label != null && (
        <span id={labelId} className="text-sm text-text">
          {label}
        </span>
      )}
    </span>
  );
}
