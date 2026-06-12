import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db.ts';
import type { AuditEventRow, AuditRiskLevel } from '../db/types.ts';
import { auditEventsToCsv } from '../audit/auditService.ts';
import { Button } from '../components/ui/Button.tsx';
import { Badge, type BadgeTone } from '../components/ui/Badge.tsx';
import { Select } from '../components/ui/Select.tsx';
import { Progress } from '../components/ui/Progress.tsx';

const RISK_TONE: Record<AuditRiskLevel, BadgeTone> = {
  info: 'neutral',
  low: 'success',
  medium: 'warning',
  high: 'danger',
  critical: 'danger',
};

const STATUS_META: Record<
  AuditEventRow['status'],
  { tone: BadgeTone; label: string }
> = {
  success: { tone: 'success', label: 'OK' },
  failure: { tone: 'danger', label: 'Failed' },
  pending: { tone: 'warning', label: 'Pending' },
  rejected: { tone: 'neutral', label: 'Rejected' },
  cancelled: { tone: 'neutral', label: 'Cancelled' },
};

const RISK_LEVELS: AuditRiskLevel[] = [
  'info',
  'low',
  'medium',
  'high',
  'critical',
];

function formatTime(at: number): string {
  if (at < 1_000_000_000) return `#${at}`;
  return new Date(at).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function AuditScreen() {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [riskFilter, setRiskFilter] = useState<'all' | AuditRiskLevel>('all');

  const recent =
    useLiveQuery(
      () => db.audit_events.orderBy('at').reverse().toArray(),
      [],
    ) ?? [];

  const events =
    riskFilter === 'all'
      ? recent
      : recent.filter((entry) => entry.risk === riskFilter);

  const total = recent.length;
  const successCount = recent.filter((e) => e.status === 'success').length;
  const failedCount = recent.filter((e) => e.status === 'failure').length;
  const riskCounts: Record<AuditRiskLevel, number> = {
    info: 0,
    low: 0,
    medium: 0,
    high: 0,
    critical: 0,
  };
  for (const entry of recent) riskCounts[entry.risk] += 1;
  const pct = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0);

  async function clearAudit() {
    await db.audit_events.clear();
    setExpandedId(null);
  }

  function exportCsv() {
    if (typeof URL.createObjectURL !== 'function') return;
    const url = URL.createObjectURL(
      new Blob([auditEventsToCsv(recent)], { type: 'text/csv' }),
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
                setRiskFilter(event.target.value as 'all' | AuditRiskLevel)
              }
            >
              <option value="all">All</option>
              <option value="info">Info</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </Select>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                void clearAudit();
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
              <SummaryRow label="Success" value={String(successCount)} />
              <SummaryRow label="Failed" value={String(failedCount)} />
            </dl>
          </div>

          <div className="rounded-card border border-border bg-surface p-4">
            <h2 className="mb-3 text-sm font-semibold text-text">
              Risk breakdown
            </h2>
            <div className="flex flex-col gap-3">
              {RISK_LEVELS.map((risk) => (
                <Progress
                  key={risk}
                  value={pct(riskCounts[risk])}
                  label={risk}
                  showValue
                  tone={
                    risk === 'high' || risk === 'critical'
                      ? 'danger'
                      : risk === 'medium'
                        ? 'warning'
                        : risk === 'low'
                          ? 'success'
                          : 'primary'
                  }
                />
              ))}
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
  entry: AuditEventRow;
  expanded: boolean;
  onToggle: () => void;
}) {
  const status = STATUS_META[entry.status];
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
          <Badge tone={status.tone}>{status.label}</Badge>
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
