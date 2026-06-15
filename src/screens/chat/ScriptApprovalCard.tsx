import { useState, type ReactNode } from 'react';
import {
  type ApprovalRequest,
  type ApprovalRisk,
} from '../../store/slices/approvalsSlice.ts';
import { Button } from '../../components/ui/Button.tsx';
import { Badge, type BadgeTone } from '../../components/ui/Badge.tsx';
import {
  PLAN_RUNTIME_LABEL,
  buildPlanProposal,
  type PlanProposal,
} from '../../script/planRuntime.ts';
import { validatePlan } from '../../script/planSchema.ts';
import {
  buildScriptProposal,
  type ScriptProposal,
} from '../../script/scriptRuntime.ts';
import { validateScriptRequest } from '../../script/scriptRequest.ts';

const RISK_TONE: Record<ApprovalRisk, BadgeTone> = {
  low: 'success',
  medium: 'warning',
  high: 'danger',
};

/** The outcome of a run, shown after the user approves (Part G2). */
export interface ScriptRunOutcome {
  state: 'running' | 'completed' | 'failed';
  message?: string;
}

export interface ScriptApprovalCardProps {
  approval: ApprovalRequest;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  /** Optional live progress/result for the run the card proposed. */
  outcome?: ScriptRunOutcome;
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mt-3">
      <p className="mb-1 text-xs font-medium text-muted-subtle">{label}</p>
      {children}
    </div>
  );
}

function Chips({ items }: { items: readonly string[] }) {
  if (items.length === 0) {
    return <p className="text-xs text-muted-subtle">none</p>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <Badge key={item} tone="neutral">
          {item}
        </Badge>
      ))}
    </div>
  );
}

function PlanDetails({ proposal }: { proposal: PlanProposal }) {
  return (
    <>
      <Section label="Capabilities">
        <Chips items={proposal.capabilities} />
      </Section>
      <Section label={`Steps (${proposal.steps.length})`}>
        <ol className="list-inside list-decimal font-mono text-xs text-text">
          {proposal.steps.map((step) => (
            <li key={step.id}>{step.op}</li>
          ))}
        </ol>
      </Section>
      {(proposal.files.reads.length > 0 ||
        proposal.files.writes.length > 0 ||
        proposal.files.deletes.length > 0) && (
        <Section label="Files">
          <ul className="font-mono text-xs text-text">
            {proposal.files.reads.map((p) => (
              <li key={`r-${p}`} className="text-muted">
                read {p}
              </li>
            ))}
            {proposal.files.writes.map((p) => (
              <li key={`w-${p}`} className="text-warning">
                write {p}
              </li>
            ))}
            {proposal.files.deletes.map((p) => (
              <li key={`d-${p}`} className="text-danger">
                delete {p}
              </li>
            ))}
          </ul>
        </Section>
      )}
      {proposal.urls.length > 0 && (
        <Section label="URLs">
          <ul className="font-mono text-xs text-text">
            {proposal.urls.map((u) => (
              <li key={u}>{u}</li>
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}

function ScriptDetails({ proposal }: { proposal: ScriptProposal }) {
  const { limits } = proposal;
  return (
    <>
      <Section label="Reason">
        <p className="text-sm text-muted">{proposal.reason}</p>
      </Section>
      <Section label="Code">
        <pre className="max-h-48 overflow-auto rounded-button border border-border bg-surface p-2 font-mono text-xs text-text">
          {proposal.codePreview}
          {proposal.codeTruncated ? '\n… (truncated)' : ''}
        </pre>
      </Section>
      <Section label="Capabilities">
        <Chips items={proposal.capabilities} />
      </Section>
      <Section label="File scopes">
        <ul className="font-mono text-xs text-text">
          {proposal.fileScopes.reads.map((p) => (
            <li key={`r-${p}`} className="text-muted">
              read {p}
            </li>
          ))}
          {proposal.fileScopes.writes.map((p) => (
            <li key={`w-${p}`} className="text-warning">
              write {p}
            </li>
          ))}
          {proposal.fileScopes.reads.length === 0 &&
            proposal.fileScopes.writes.length === 0 && (
              <li className="text-muted-subtle">none</li>
            )}
        </ul>
      </Section>
      <Section label="Network / web">
        <p className="text-xs text-text">
          network: {proposal.network}
          {proposal.webPermissions.search ? ' · web search' : ''}
          {proposal.webPermissions.read.length > 0
            ? ` · read ${proposal.webPermissions.read.join(', ')}`
            : ''}
        </p>
      </Section>
      <Section label="Limits">
        <p className="font-mono text-xs text-text">
          {limits.timeoutMs}ms · {limits.maxOutputBytes}B out ·{' '}
          {limits.maxFileReads} reads · {limits.maxFileWrites} writes
        </p>
      </Section>
    </>
  );
}

function runtimeFor(approval: ApprovalRequest): {
  label: string;
  plan?: PlanProposal;
  script?: ScriptProposal;
} {
  const parsed = parse(approval.payloadPreview);
  if (approval.kind === 'plan') {
    const v = validatePlan(parsed);
    return v.ok
      ? { label: PLAN_RUNTIME_LABEL, plan: buildPlanProposal(v.plan) }
      : { label: PLAN_RUNTIME_LABEL };
  }
  const v = validateScriptRequest(parsed);
  return v.ok
    ? {
        label: buildScriptProposal(v.request, v.risk).runtime,
        script: buildScriptProposal(v.request, v.risk),
      }
    : { label: 'Sandboxed Script Runtime v0.2' };
}

const OUTCOME_TONE: Record<ScriptRunOutcome['state'], BadgeTone> = {
  running: 'primary',
  completed: 'success',
  failed: 'danger',
};

/**
 * Approval card for the two script runtimes (Part G2). Shows the runtime type,
 * reason, and — for a sandboxed script — the code preview, capabilities, file
 * scopes, network/web permissions, and resource limits, so the user can make an
 * informed approve/reject decision. Live progress/results render once it runs.
 */
export function ScriptApprovalCard({
  approval,
  onApprove,
  onReject,
  outcome,
}: ScriptApprovalCardProps) {
  const [showRaw, setShowRaw] = useState(false);
  const pending = approval.status === 'pending';
  const { label, plan, script } = runtimeFor(approval);

  return (
    <div className="rounded-card border border-border bg-surface-subtle p-4">
      <div className="flex items-center justify-between gap-3">
        <Badge tone="primary">{label}</Badge>
        {pending ? (
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

      <p className="mt-2 text-sm font-semibold text-text">{approval.title}</p>
      <p className="text-xs text-muted-subtle">{approval.kind}</p>

      {plan && <PlanDetails proposal={plan} />}
      {script && <ScriptDetails proposal={script} />}
      {!plan && !script && (
        <Section label="Exact data">
          <pre className="overflow-x-auto rounded-button border border-border bg-surface p-2 font-mono text-xs text-text">
            {approval.payloadPreview}
          </pre>
        </Section>
      )}

      {outcome && (
        <Section label="Result">
          <Badge tone={OUTCOME_TONE[outcome.state]} dot>
            {outcome.state}
          </Badge>
          {outcome.message && (
            <p
              className={
                outcome.state === 'failed'
                  ? 'mt-1 text-sm text-danger'
                  : 'mt-1 text-sm text-muted'
              }
            >
              {outcome.message}
            </p>
          )}
        </Section>
      )}

      <div className="mt-3 flex items-center gap-2">
        {(plan || script) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowRaw((v) => !v)}
          >
            {showRaw ? 'Hide raw' : 'View raw'}
          </Button>
        )}
        {pending && (
          <>
            <Button
              variant="primary"
              size="sm"
              onClick={() => onApprove(approval.id)}
            >
              Approve
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onReject(approval.id)}
            >
              Reject
            </Button>
          </>
        )}
      </div>

      {showRaw && (
        <pre className="mt-3 max-h-48 overflow-auto rounded-button border border-border bg-surface p-2 font-mono text-xs text-text">
          {approval.payloadPreview}
        </pre>
      )}
    </div>
  );
}
