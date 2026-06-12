import { useState } from 'react';
import {
  type ApprovalRequest,
  type ApprovalRisk,
} from '../../store/slices/approvalsSlice.ts';
import { Button } from '../../components/ui/Button.tsx';
import { Badge, type BadgeTone } from '../../components/ui/Badge.tsx';

export interface ApprovalCardProps {
  approval: ApprovalRequest;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onEdit: (id: string, payloadPreview: string) => void;
}

const RISK_TONE: Record<ApprovalRisk, BadgeTone> = {
  low: 'success',
  medium: 'warning',
  high: 'danger',
};

/**
 * Inline approval card — the surface that enforces "no meaningful side effect
 * happens silently". Shows the action, its risk, and the exact payload, and
 * lets the user approve, edit, or reject before anything runs.
 */
export function ApprovalCard({
  approval,
  onApprove,
  onReject,
  onEdit,
}: ApprovalCardProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(approval.payloadPreview);
  const pending = approval.status === 'pending';

  return (
    <div className="rounded-card border border-border bg-surface-subtle p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-semibold text-text">Proposed action</span>
        {approval.status === 'pending' ? (
          <Badge tone={RISK_TONE[approval.risk]} dot>
            Risk: {approval.risk}
          </Badge>
        ) : (
          <Badge
            tone={approval.status === 'approved' ? 'success' : 'danger'}
            dot
          >
            {approval.status}
          </Badge>
        )}
      </div>

      <p className="mt-2 text-sm font-medium text-text">{approval.title}</p>
      <p className="text-xs text-muted-subtle">{approval.kind}</p>
      <p className="mt-1 text-sm text-muted">{approval.summary}</p>

      <div className="mt-3">
        <p className="mb-1 text-xs font-medium text-muted-subtle">Exact data</p>
        {editing ? (
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={4}
            className="w-full rounded-button border border-border bg-surface p-2 font-mono text-xs text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          />
        ) : (
          <pre className="overflow-x-auto rounded-button border border-border bg-surface p-2 font-mono text-xs text-text">
            {approval.payloadPreview}
          </pre>
        )}
      </div>

      {pending && (
        <div className="mt-3 flex items-center gap-2">
          <Button
            variant="primary"
            size="sm"
            onClick={() => onApprove(approval.id)}
          >
            Approve
          </Button>
          {editing ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                onEdit(approval.id, draft);
                setEditing(false);
              }}
            >
              Save
            </Button>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setEditing(true)}
            >
              Edit
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onReject(approval.id)}
          >
            Reject
          </Button>
        </div>
      )}
    </div>
  );
}
