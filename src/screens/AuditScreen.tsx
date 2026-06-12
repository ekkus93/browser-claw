import { useEffect, useRef, useState } from 'react';
import { useAppDispatch, useAppSelector } from '../store/hooks.ts';
import {
  auditAppended,
  auditCleared,
  type AuditEntry,
  type AuditRisk,
} from '../store/slices/auditSlice.ts';
import { Button } from '../components/ui/Button.tsx';
import { Badge, type BadgeTone } from '../components/ui/Badge.tsx';
import { Select } from '../components/ui/Select.tsx';
import { Progress } from '../components/ui/Progress.tsx';

const SAMPLE_AUDIT: AuditEntry[] = [
  {
    id: 'a5',
    type: 'llm_request_sent',
    summary: 'LLM request sent',
    risk: 'low',
    at: 5,
  },
  {
    id: 'a4',
    type: 'memory_created',
    summary: 'Memory created',
    risk: 'info',
    at: 4,
  },
  {
    id: 'a3',
    type: 'skill_installed',
    summary: 'Skill installed',
    risk: 'medium',
    at: 3,
  },
  {
    id: 'a2',
    type: 'secret_unlocked',
    summary: 'Secret unlocked',
    risk: 'medium',
    at: 2,
  },
  {
    id: 'a1',
    type: 'backup_exported',
    summary: 'Backup exported',
    risk: 'low',
    at: 1,
  },
];

const RISK_TONE: Record<AuditRisk, BadgeTone> = {
  info: 'neutral',
  low: 'success',
  medium: 'warning',
  high: 'danger',
};

function formatTime(at: number): string {
  if (at < 1_000_000_000) return `#${at}`;
  return new Date(at).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function AuditScreen() {
  const dispatch = useAppDispatch();
  const recent = useAppSelector((state) => state.audit.recent);
  const seededRef = useRef(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [riskFilter, setRiskFilter] = useState<'all' | AuditRisk>('all');

  useEffect(() => {
    if (!seededRef.current && recent.length === 0) {
      seededRef.current = true;
      SAMPLE_AUDIT.forEach((entry) => dispatch(auditAppended(entry)));
    }
  }, [recent.length, dispatch]);

  const events =
    riskFilter === 'all'
      ? recent
      : recent.filter((entry) => entry.risk === riskFilter);

  const total = recent.length;
  const riskCounts: Record<AuditRisk, number> = {
    info: 0,
    low: 0,
    medium: 0,
    high: 0,
  };
  for (const entry of recent) riskCounts[entry.risk] += 1;
  const pct = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0);

  function exportCsv() {
    if (typeof URL.createObjectURL !== 'function') return;
    const header = 'time,type,summary,risk\n';
    const body = recent
      .map((e) => `${e.at},${e.type},"${e.summary}",${e.risk}`)
      .join('\n');
    const url = URL.createObjectURL(
      new Blob([header + body], { type: 'text/csv' }),
    );
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'audit.csv';
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="overflow-y-auto">
      <div className="grid gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <main className="flex min-w-0 flex-col gap-4">
          <header>
            <h1 className="text-xl font-bold text-text">Audit</h1>
            <p className="text-sm text-muted">
              Chronological record of system events.
            </p>
          </header>

          <div className="flex flex-wrap items-end gap-3">
            <Select
              label="Risk"
              value={riskFilter}
              onChange={(event) =>
                setRiskFilter(event.target.value as 'all' | AuditRisk)
              }
            >
              <option value="all">All</option>
              <option value="info">Info</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </Select>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                dispatch(auditCleared());
                setExpandedId(null);
              }}
            >
              Clear
            </Button>
          </div>

          <div className="overflow-hidden rounded-card border border-border bg-surface">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-subtle">
                  <th className="px-4 py-2 font-medium">Time</th>
                  <th className="px-4 py-2 font-medium">Event</th>
                  <th className="px-4 py-2 font-medium">Risk</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {events.length === 0 ? (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-4 py-6 text-center text-muted"
                    >
                      No audit events.
                    </td>
                  </tr>
                ) : (
                  events.map((entry) => (
                    <FragmentRow
                      key={entry.id}
                      entry={entry}
                      expanded={expandedId === entry.id}
                      onToggle={() =>
                        setExpandedId((prev) =>
                          prev === entry.id ? null : entry.id,
                        )
                      }
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>
        </main>

        <aside className="flex flex-col gap-4">
          <div className="rounded-card border border-border bg-surface p-4">
            <h2 className="mb-3 text-sm font-semibold text-text">
              Audit summary
            </h2>
            <dl className="flex flex-col gap-1.5 text-sm">
              <SummaryRow label="Total" value={String(total)} />
              <SummaryRow label="Success" value={String(total)} />
              <SummaryRow label="Failed" value="0" />
            </dl>
          </div>

          <div className="rounded-card border border-border bg-surface p-4">
            <h2 className="mb-3 text-sm font-semibold text-text">
              Risk breakdown
            </h2>
            <div className="flex flex-col gap-3">
              {(['low', 'medium', 'high', 'info'] as AuditRisk[]).map(
                (risk) => (
                  <Progress
                    key={risk}
                    value={pct(riskCounts[risk])}
                    label={risk}
                    showValue
                    tone={
                      risk === 'high'
                        ? 'danger'
                        : risk === 'medium'
                          ? 'warning'
                          : risk === 'low'
                            ? 'success'
                            : 'primary'
                    }
                  />
                ),
              )}
            </div>
          </div>

          <Button variant="secondary" size="sm" onClick={exportCsv}>
            Export CSV
          </Button>
        </aside>
      </div>
    </div>
  );
}

function FragmentRow({
  entry,
  expanded,
  onToggle,
}: {
  entry: AuditEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        onClick={onToggle}
        className="cursor-pointer border-b border-border last:border-0 hover:bg-surface-subtle"
      >
        <td className="px-4 py-3 tabular-nums text-muted">
          {formatTime(entry.at)}
        </td>
        <td className="px-4 py-3 font-medium text-text">{entry.summary}</td>
        <td className="px-4 py-3">
          <Badge tone={RISK_TONE[entry.risk]} dot>
            {entry.risk}
          </Badge>
        </td>
        <td className="px-4 py-3">
          <Badge tone="success">OK</Badge>
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-border last:border-0">
          <td colSpan={4} className="bg-surface-subtle px-4 py-3">
            <p className="mb-1 text-xs font-medium text-muted-subtle">
              Details JSON
            </p>
            <pre className="overflow-x-auto rounded-button border border-border bg-surface p-2 font-mono text-xs text-text">
              {JSON.stringify(entry, null, 2)}
            </pre>
          </td>
        </tr>
      )}
    </>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-muted-subtle">{label}</dt>
      <dd className="font-medium text-text">{value}</dd>
    </div>
  );
}
