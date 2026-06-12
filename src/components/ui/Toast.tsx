import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  CheckCircle2,
  Info,
  AlertTriangle,
  XCircle,
  X,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '../../lib/cn.ts';
import {
  ToastContext,
  type ToastOptions,
  type ToastTone,
} from './toastContext.ts';

interface ToastRecord extends ToastOptions {
  id: string;
}

const TONE_META: Record<ToastTone, { icon: LucideIcon; accent: string }> = {
  info: { icon: Info, accent: 'text-primary' },
  success: { icon: CheckCircle2, accent: 'text-success' },
  warning: { icon: AlertTriangle, accent: 'text-warning' },
  danger: { icon: XCircle, accent: 'text-danger' },
};

function ToastCard({
  record,
  onDismiss,
}: {
  record: ToastRecord;
  onDismiss: (id: string) => void;
}) {
  const { icon: Icon, accent } = TONE_META[record.tone ?? 'info'];
  return (
    <div
      role="status"
      className="pointer-events-auto flex w-80 items-start gap-3 rounded-card border border-border bg-surface p-3 shadow-lg"
    >
      <Icon
        className={cn('mt-0.5 size-4.5 shrink-0', accent)}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-text">{record.title}</p>
        {record.description != null && (
          <p className="mt-0.5 text-sm leading-snug text-muted">
            {record.description}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={() => onDismiss(record.id)}
        aria-label="Dismiss notification"
        className="-mr-1 -mt-1 flex size-6 shrink-0 items-center justify-center rounded-button text-muted-subtle transition-colors hover:bg-surface-subtle hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <X className="size-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: ToastRecord[];
  onDismiss: (id: string) => void;
}) {
  if (toasts.length === 0) return null;
  return createPortal(
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2"
    >
      {toasts.map((record) => (
        <ToastCard key={record.id} record={record} onDismiss={onDismiss} />
      ))}
    </div>,
    document.body,
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const counter = useRef(0);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (options: ToastOptions) => {
      counter.current += 1;
      const id = `toast-${counter.current}`;
      setToasts((prev) => [...prev, { id, ...options }]);
      const duration = options.duration ?? 4000;
      if (duration > 0) {
        window.setTimeout(() => dismiss(id), duration);
      }
    },
    [dismiss],
  );

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}
