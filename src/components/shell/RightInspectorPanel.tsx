import { useId, useState, type ReactNode } from 'react';

export type InspectorTabId =
  | 'tools'
  | 'context'
  | 'memory'
  | 'skills'
  | 'audit';

interface InspectorTab {
  id: InspectorTabId;
  label: string;
  hint: string;
}

const TABS: InspectorTab[] = [
  {
    id: 'tools',
    label: 'Tool Calls',
    hint: 'Recent tool calls and proposed actions',
  },
  {
    id: 'context',
    label: 'Context',
    hint: 'Runtime, provider, model, data location',
  },
  {
    id: 'memory',
    label: 'Memory',
    hint: 'Retrieved and recently used memories',
  },
  {
    id: 'skills',
    label: 'Skills',
    hint: 'Active skills, state, and audit events',
  },
  {
    id: 'audit',
    label: 'Audit',
    hint: 'Recent events, approvals, risk metrics',
  },
];

export interface RightInspectorPanelProps {
  defaultTab?: InspectorTabId;
  /** Optional content per tab; falls back to a hint placeholder. */
  renderTab?: (tab: InspectorTabId) => ReactNode;
}

/**
 * Shared right inspector. Phase 2+ feeds real content per tab; for now each
 * tab renders its canonical summary hint as a placeholder.
 */
export function RightInspectorPanel({
  defaultTab = 'tools',
  renderTab,
}: RightInspectorPanelProps) {
  const [active, setActive] = useState<InspectorTabId>(defaultTab);
  const baseId = useId();
  const activeTab = TABS.find((t) => t.id === active) ?? TABS[0]!;

  return (
    <aside
      aria-label="Inspector"
      className="flex h-full flex-col border-l border-border bg-surface"
    >
      <div
        role="tablist"
        aria-label="Inspector views"
        className="flex items-center gap-1 overflow-x-auto border-b border-border px-2 py-2"
      >
        {TABS.map((tab) => {
          const selected = tab.id === active;
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
              className={[
                'whitespace-nowrap rounded-button px-2.5 py-1.5 text-sm transition-colors',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
                selected
                  ? 'bg-primary-subtle font-semibold text-primary'
                  : 'font-medium text-muted hover:bg-surface-subtle hover:text-text',
              ].join(' ')}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={`${baseId}-panel-${activeTab.id}`}
        aria-labelledby={`${baseId}-tab-${activeTab.id}`}
        className="flex-1 overflow-y-auto p-4 text-sm text-muted"
      >
        {renderTab?.(activeTab.id) ?? (
          <p className="leading-relaxed">{activeTab.hint}.</p>
        )}
      </div>
    </aside>
  );
}
