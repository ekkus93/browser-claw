import type { ReactNode } from 'react';
import { cn } from '../../lib/cn.ts';

export type BadgeTone =
  | 'neutral'
  | 'primary'
  | 'success'
  | 'warning'
  | 'danger'
  | 'purple';

export interface BadgeProps {
  tone?: BadgeTone;
  dot?: boolean;
  children: ReactNode;
  className?: string;
}

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-background text-muted',
  primary: 'bg-primary-subtle text-primary',
  success: 'bg-success-subtle text-success',
  warning: 'bg-warning-subtle text-warning',
  danger: 'bg-danger-subtle text-danger',
  purple: 'bg-purple-subtle text-purple',
};

const DOTS: Record<BadgeTone, string> = {
  neutral: 'bg-muted-subtle',
  primary: 'bg-primary',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  purple: 'bg-purple',
};

export function Badge({
  tone = 'neutral',
  dot = false,
  children,
  className,
}: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium',
        TONES[tone],
        className,
      )}
    >
      {dot && (
        <span
          className={cn('size-1.5 rounded-full', DOTS[tone])}
          aria-hidden="true"
        />
      )}
      {children}
    </span>
  );
}
