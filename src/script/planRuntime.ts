/**
 * Plan approval + audit (Part C4). A plan is a meaningful, multi-step side
 * effect, so it is PROPOSED with a risk + capability/step preview, then on
 * approval it runs through {@link executePlan} with its whole lifecycle audited
 * (requested → started → completed/failed/cancelled); a rejection is audited and
 * runs nothing.
 *
 * Redux-agnostic (uses the audit sink only). The inline approval-card queue +
 * resolution listener are wired in the approval-integration phase (Part F3).
 */

import { recordAudit } from '../audit/auditSink.ts';
import type { ApprovalRisk } from '../store/slices/approvalsSlice.ts';
import {
  executePlan,
  type PlanRunOptions,
  type PlanRunResult,
} from './planExecutor.ts';
import { type PlanOpContext } from './planOps.ts';
import {
  planCapabilities,
  validatePlan,
  type BrowserClawPlan,
} from './planSchema.ts';

export const PLAN_RUNTIME_LABEL = 'Structured Plan DSL v0.1';

const WRITE_OPS = /writeText|updateText|appendText|move|copy/;

/** A plan that deletes is high risk; one that writes/webs/tools is medium. */
export function classifyPlanRisk(plan: BrowserClawPlan): ApprovalRisk {
  let risk: ApprovalRisk = 'low';
  for (const step of plan.steps) {
    if (step.op === 'fs.delete') return 'high';
    if (
      WRITE_OPS.test(step.op) ||
      step.op.startsWith('web.') ||
      step.op === 'tool.call' ||
      step.op === 'memory.create'
    ) {
      risk = 'medium';
    }
  }
  return risk;
}

export interface PlanProposal {
  plan: BrowserClawPlan;
  runtime: typeof PLAN_RUNTIME_LABEL;
  title: string;
  reason: string;
  risk: ApprovalRisk;
  capabilities: string[];
  steps: { id: string; op: string }[];
  files: { reads: string[]; writes: string[]; deletes: string[] };
  urls: string[];
}

function literal(step: Record<string, unknown>, key: string): string | null {
  const value = step[key];
  return typeof value === 'string' ? value : null;
}

/** Build the approval preview for a plan (capabilities, steps, files, URLs). */
export function buildPlanProposal(plan: BrowserClawPlan): PlanProposal {
  const reads: string[] = [];
  const writes: string[] = [];
  const deletes: string[] = [];
  const urls: string[] = [];
  for (const step of plan.steps) {
    const path = literal(step, 'path');
    if (step.op === 'fs.delete' && path) deletes.push(path);
    else if (WRITE_OPS.test(step.op) && path) writes.push(path);
    else if (step.op.startsWith('fs.read') && path) reads.push(path);
    const from = literal(step, 'from');
    const to = literal(step, 'to');
    if (from) reads.push(from);
    if (to) writes.push(to);
    const url = literal(step, 'url');
    if (url) urls.push(url);
  }
  return {
    plan,
    runtime: PLAN_RUNTIME_LABEL,
    title: plan.title,
    reason: plan.reason,
    risk: classifyPlanRisk(plan),
    capabilities: planCapabilities(plan),
    steps: plan.steps.map((s) => ({ id: s.id, op: s.op })),
    files: { reads, writes, deletes },
    urls,
  };
}

function audit(
  ctx: PlanOpContext,
  type: string,
  summary: string,
  risk: ApprovalRisk | 'info',
  status: 'success' | 'failure' | 'pending' | 'rejected' | 'cancelled',
): void {
  void recordAudit(ctx.db, ctx.dispatch, {
    type,
    summary,
    source: 'script',
    risk: risk === 'low' ? 'low' : risk,
    status,
  });
}

/** Audit that a plan was proposed for approval, returning its proposal. */
export function proposePlan(
  ctx: PlanOpContext,
  plan: BrowserClawPlan,
): PlanProposal {
  const proposal = buildPlanProposal(plan);
  audit(
    ctx,
    'script.plan_requested',
    `Plan proposed: ${plan.title}`,
    proposal.risk,
    'pending',
  );
  return proposal;
}

/** Audit a rejected plan (nothing runs). */
export function rejectPlan(ctx: PlanOpContext, plan: BrowserClawPlan): void {
  audit(
    ctx,
    'script.plan_rejected',
    `Plan rejected: ${plan.title}`,
    'low',
    'rejected',
  );
}

/**
 * Run an APPROVED plan with full lifecycle auditing. Validates first, audits
 * started, runs the executor, then audits completed / failed / cancelled.
 */
export async function runApprovedPlan(
  ctx: PlanOpContext,
  plan: BrowserClawPlan | unknown,
  options: PlanRunOptions = {},
): Promise<PlanRunResult> {
  const validation = validatePlan(plan);
  if (!validation.ok) {
    audit(
      ctx,
      'script.plan_failed',
      `Plan invalid: ${validation.errors.join('; ')}`,
      'medium',
      'failure',
    );
    return {
      ok: false,
      outputs: {},
      steps: [],
      error: validation.errors.join('; '),
      errorKind: 'validation_error',
    };
  }
  const valid = validation.plan;
  audit(
    ctx,
    'script.plan_started',
    `Plan started: ${valid.title}`,
    'info',
    'pending',
  );
  const result = await executePlan(ctx, valid, options);
  if (result.ok) {
    audit(
      ctx,
      'script.plan_completed',
      `Plan completed: ${valid.title}`,
      'info',
      'success',
    );
  } else if (result.errorKind === 'cancelled') {
    audit(
      ctx,
      'script.plan_cancelled',
      `Plan cancelled: ${valid.title}`,
      'low',
      'cancelled',
    );
  } else {
    audit(
      ctx,
      'script.plan_failed',
      `Plan failed: ${valid.title} (${result.error ?? result.errorKind ?? 'error'})`,
      'medium',
      'failure',
    );
  }
  return result;
}
