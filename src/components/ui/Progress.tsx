import { cn } from '../../lib/cn.ts';

export type ProgressTone = 'primary' | 'success' | 'warning' | 'danger';

export interface ProgressProps {
  /** 0–100. */
  value: number;
  label?: string;
  /** Show the numeric percentage on the right of the label row. */
  showValue?: boolean;
  tone?: ProgressTone;
  className?: string;
}

const TONES: Record<ProgressTone, string> = {
  primary: 'bg-primary',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
};

export function Progress({
  value,
  label,
  showValue = false,
  tone = 'primary',
  className,
}: ProgressProps) {
  const clamped = Math.max(0, Math.min(100, value));

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {(label != null || showValue) && (
        <div className="flex items-center justify-between text-sm">
          {label != null ? (
            <span className="text-muted">{label}</span>
          ) : (
            <span />
          )}
          {showValue && (
            <span className="tabular-nums text-muted-subtle">
              {Math.round(clamped)}%
            </span>
          )}
        </div>
      )}
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-background"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(clamped)}
      >
        <div
          className={cn('h-full rounded-full transition-[width]', TONES[tone])}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}
