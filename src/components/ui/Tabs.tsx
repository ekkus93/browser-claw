import { useId, useState, type ReactNode, type KeyboardEvent } from 'react';
import { cn } from '../../lib/cn.ts';

export interface TabItem {
  id: string;
  label: ReactNode;
  content: ReactNode;
}

export interface TabsProps {
  items: TabItem[];
  defaultTab?: string;
  className?: string;
}

export function Tabs({ items, defaultTab, className }: TabsProps) {
  const baseId = useId();
  const [active, setActive] = useState(defaultTab ?? items[0]?.id ?? '');
  const activeItem = items.find((t) => t.id === active) ?? items[0];

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const currentIndex = items.findIndex((t) => t.id === active);
    if (currentIndex < 0) return;

    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight')
      nextIndex = (currentIndex + 1) % items.length;
    else if (event.key === 'ArrowLeft')
      nextIndex = (currentIndex - 1 + items.length) % items.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = items.length - 1;

    if (nextIndex != null) {
      event.preventDefault();
      const next = items[nextIndex];
      if (next) {
        setActive(next.id);
        document.getElementById(`${baseId}-tab-${next.id}`)?.focus();
      }
    }
  }

  if (!activeItem) return null;

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div
        role="tablist"
        className="flex items-center gap-1 border-b border-border"
      >
        {items.map((tab) => {
          const selected = tab.id === activeItem.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`${baseId}-tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(tab.id)}
              onKeyDown={onKeyDown}
              className={cn(
                '-mb-px border-b-2 px-3 py-2 text-sm transition-colors',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
                selected
                  ? 'border-primary font-semibold text-primary'
                  : 'border-transparent font-medium text-muted hover:text-text',
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      <div
        role="tabpanel"
        id={`${baseId}-panel-${activeItem.id}`}
        aria-labelledby={`${baseId}-tab-${activeItem.id}`}
      >
        {activeItem.content}
      </div>
    </div>
  );
}
