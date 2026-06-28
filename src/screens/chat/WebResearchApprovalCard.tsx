import {
  type ApprovalRequest,
  type ApprovalRisk,
} from '../../store/slices/approvalsSlice.ts';
import { Button } from '../../components/ui/Button.tsx';
import { Badge, type BadgeTone } from '../../components/ui/Badge.tsx';

export interface WebResearchApprovalCardProps {
  approval: ApprovalRequest;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}

const RISK_TONE: Record<ApprovalRisk, BadgeTone> = {
  low: 'success',
  medium: 'warning',
  high: 'danger',
};

const MAX_VISIBLE_URLS = 5;

interface ParsedPayload {
  urls?: string[];
  query?: string;
  maxChars?: number;
}

function parsePayload(raw: string): ParsedPayload | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null) {
      return parsed as ParsedPayload;
    }
    return null;
  } catch {
    return null;
  }
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function buildSummary(kind: string, payload: ParsedPayload | null): string {
  const urls = payload?.urls ?? [];
  const n = urls.length;
  if (kind === 'bulk_research' && payload?.query) {
    return `Search: "${payload.query}"${n > 0 ? ` + read ${String(n)} page${n === 1 ? '' : 's'}` : ''}`;
  }
  if (n === 1) return 'Read 1 page';
  if (n > 1) return `Read ${String(n)} pages`;
  return kind === 'bulk_research' ? 'Web research' : 'Read page';
}

/**
 * Approval card for web_page_read and bulk_research approval kinds.
 * Shows URL list, domain badges, risk, and Approve/Reject controls.
 * No "Edit" button — URL editing requires re-validation; deferred to v0.2.
 */
export function WebResearchApprovalCard({
  approval,
  onApprove,
  onReject,
}: WebResearchApprovalCardProps) {
  const pending = approval.status === 'pending';
  const payload = parsePayload(approval.payloadPreview);
  const urls = payload?.urls ?? [];
  const visibleUrls = urls.slice(0, MAX_VISIBLE_URLS);
  const overflow = urls.length - visibleUrls.length;
  const domains = [...new Set(urls.map(extractDomain))];
  const summary = buildSummary(approval.kind, payload);

  return (
    <div className="rounded-card border border-border bg-surface-subtle p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-semibold text-text">{summary}</span>
        <div className="flex items-center gap-2">
          <Badge tone={RISK_TONE[approval.risk]}>{approval.risk} risk</Badge>
          <Badge tone="neutral">{approval.kind}</Badge>
        </div>
      </div>

      {payload?.query && (
        <p className="mt-2 text-xs text-muted">
          Query: <span className="text-text">{payload.query}</span>
        </p>
      )}

      {visibleUrls.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {visibleUrls.map((url) => (
            <li key={url} className="truncate text-xs text-muted">
              {url}
            </li>
          ))}
          {overflow > 0 && (
            <li className="text-xs text-muted-subtle">
              and {String(overflow)} more
            </li>
          )}
        </ul>
      )}

      {domains.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {domains.map((d) => (
            <Badge key={d} tone="neutral">
              {d}
            </Badge>
          ))}
        </div>
      )}

      {payload === null && (
        <pre className="mt-2 max-h-24 overflow-auto rounded border border-border bg-surface p-2 text-xs text-muted">
          {approval.payloadPreview}
        </pre>
      )}

      <div className="mt-3 flex gap-2">
        <Button
          size="sm"
          variant="primary"
          disabled={!pending}
          onClick={() => onApprove(approval.id)}
        >
          Approve
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={!pending}
          onClick={() => onReject(approval.id)}
        >
          Reject
        </Button>
      </div>
    </div>
  );
}
