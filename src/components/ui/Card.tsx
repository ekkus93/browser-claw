import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/cn.ts';

type DivProps = HTMLAttributes<HTMLDivElement>;

export function Card({ className, ...rest }: DivProps) {
  return (
    <div
      className={cn(
        'rounded-card border border-border bg-surface shadow-sm',
        className,
      )}
      {...rest}
    />
  );
}

export function CardHeader({ className, ...rest }: DivProps) {
  return (
    <div
      className={cn(
        'flex items-start justify-between gap-3 border-b border-border px-4 py-3',
        className,
      )}
      {...rest}
    />
  );
}

interface CardTitleProps {
  children: ReactNode;
  description?: ReactNode;
}

export function CardTitle({ children, description }: CardTitleProps) {
  return (
    <div className="min-w-0">
      <h2 className="truncate text-md font-semibold text-text">{children}</h2>
      {description != null && (
        <p className="mt-0.5 text-sm text-muted">{description}</p>
      )}
    </div>
  );
}

export function CardContent({ className, ...rest }: DivProps) {
  return <div className={cn('p-4', className)} {...rest} />;
}

export function CardFooter({ className, ...rest }: DivProps) {
  return (
    <div
      className={cn(
        'flex items-center justify-end gap-2 border-t border-border px-4 py-3',
        className,
      )}
      {...rest}
    />
  );
}
