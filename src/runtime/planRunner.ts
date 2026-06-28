/**
 * Host handler for the runtime's `script_plan_proposal` effect (Part C5). A
 * proposed plan is validated and queued for inline approval (like a tool call);
 * nothing runs until the user approves. On approval the plan runs through the
 * audited plan runtime and the effect resolves with its result, so the runtime
 * continues the turn. A rejected/invalid plan resolves as a failure — the
 * runtime never proceeds as if a plan it didn't run succeeded.
 */

import { recordAudit } from '../audit/auditSink.ts';
import { approvalRequested } from '../store/slices/approvalsSlice.ts';
import {
  proposePlan,
  rejectPlan,
  runApprovedPlan,
} from '../script/planRuntime.ts';
import { validatePlan } from '../script/planSchema.ts';
import type { PlanOpContext } from '../script/planOps.ts';
import type { Command, Effect } from './effectTypes.ts';
import { tryParseApprovalPayload } from './approvalPayload.ts';

type PlanEffect = Extract<Effect, { type: 'script_plan_proposal' }>;

export interface PlanEffectDeps {
  /** Plan execution context (workspace fs, db, dispatch, allowed tools). */
  ctx: PlanOpContext;
  submit: (command: Command) => Promise<void>;
}

export function createPlanEffectHandler(deps: PlanEffectDeps) {
  return async (effect: PlanEffect): Promise<void> => {
    const validation = validatePlan(effect.plan);
    if (!validation.ok) {
      void recordAudit(deps.ctx.db, deps.ctx.dispatch, {
        type: 'script.plan_failed',
        summary: `Plan rejected (invalid): ${validation.errors.join('; ')}`,
        source: 'script',
        risk: 'medium',
        status: 'failure',
      });
      await deps.submit({
        type: 'resolve_effect',
        id: effect.id,
        result: {
          ok: false,
          error: {
            kind: 'plan_invalid',
            message: validation.errors.join('; '),
          },
        },
      });
      return;
    }
    const proposal = proposePlan(deps.ctx, validation.plan);
    deps.ctx.dispatch(
      approvalRequested({
        id: effect.id,
        kind: 'plan',
        title: proposal.title,
        risk: proposal.risk,
        summary: proposal.reason,
        payloadPreview: JSON.stringify(validation.plan),
      }),
    );
  };
}

export interface ApprovedPlan {
  id: string;
  status: 'approved' | 'rejected';
  /** The plan JSON the user reviewed (the approval's payloadPreview). */
  payloadPreview?: string;
}

/**
 * Run (or decline) a plan the user resolved on the approval card, then resolve
 * the runtime effect. Called by the approval-resolution listener (Part F3).
 */
export async function runApprovedPlanEffect(
  deps: PlanEffectDeps,
  approval: ApprovedPlan,
): Promise<void> {
  const plan: unknown = tryParseApprovalPayload(approval.payloadPreview);

  if (approval.status !== 'approved') {
    if (plan && typeof plan === 'object') {
      const v = validatePlan(plan);
      if (v.ok) rejectPlan(deps.ctx, v.plan);
    }
    await deps.submit({
      type: 'resolve_effect',
      id: approval.id,
      result: { ok: false, error: { kind: 'user_rejected' } },
    });
    return;
  }

  const result = await runApprovedPlan(deps.ctx, plan);
  await deps.submit({
    type: 'resolve_effect',
    id: approval.id,
    result: result.ok
      ? { ok: true, outputs: result.outputs }
      : {
          ok: false,
          error: {
            kind: result.errorKind ?? 'plan_failed',
            message: result.error ?? 'plan failed',
          },
        },
  });
}

