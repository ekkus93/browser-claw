/**
 * Host handler for the runtime's `sandbox_script_proposal` effect (Part F3, the
 * D6 analog of the C5 plan bridge). A proposed v0.2 sandboxed script is
 * validated and queued for inline approval; nothing runs until the user
 * approves. On approval the script runs through the audited sandbox runtime and
 * the effect resolves with its result, so the runtime continues the turn. A
 * rejected/invalid request resolves as a failure — the runtime never proceeds as
 * if a script it didn't run succeeded.
 */

import { approvalRequested } from '../store/slices/approvalsSlice.ts';
import {
  proposeScript,
  rejectScript,
  runApprovedScript,
  type ScriptRuntimeContext,
} from '../script/scriptRuntime.ts';
import { validateScriptRequest } from '../script/scriptRequest.ts';
import type { Command, Effect } from './effectTypes.ts';

type SandboxScriptEffect = Extract<Effect, { type: 'sandbox_script_proposal' }>;

export interface SandboxScriptEffectDeps {
  /** Sandbox capability/audit context (workspace fs, db, dispatch, web, tools). */
  ctx: ScriptRuntimeContext;
  submit: (command: Command) => Promise<void>;
}

export function createSandboxScriptEffectHandler(
  deps: SandboxScriptEffectDeps,
) {
  return async (effect: SandboxScriptEffect): Promise<void> => {
    // proposeScript validates, audits sandbox_requested | sandbox_rejected, and
    // builds the approval-card preview.
    const result = proposeScript(deps.ctx, effect.request);
    if (!result.ok) {
      await deps.submit({
        type: 'resolve_effect',
        id: effect.id,
        result: {
          ok: false,
          error: {
            kind: 'script_invalid',
            message: result.errors.join('; '),
          },
        },
      });
      return;
    }
    const { proposal } = result;
    deps.ctx.dispatch(
      approvalRequested({
        id: effect.id,
        kind: 'sandbox_script',
        title: proposal.title,
        risk: proposal.risk,
        summary: proposal.reason,
        payloadPreview: JSON.stringify(effect.request),
      }),
    );
  };
}

export interface ApprovedSandboxScript {
  id: string;
  status: 'approved' | 'rejected';
  /** The script-request JSON the user reviewed (the approval's payloadPreview). */
  payloadPreview?: string;
}

/**
 * Run (or decline) a sandboxed script the user resolved on the approval card,
 * then resolve the runtime effect. Called by the approval-resolution listener.
 */
export async function runApprovedSandboxScriptEffect(
  deps: SandboxScriptEffectDeps,
  approval: ApprovedSandboxScript,
): Promise<void> {
  const request: unknown = approval.payloadPreview
    ? safeParse(approval.payloadPreview)
    : undefined;

  if (approval.status !== 'approved') {
    const v = validateScriptRequest(request);
    if (v.ok) rejectScript(deps.ctx, v.request);
    await deps.submit({
      type: 'resolve_effect',
      id: approval.id,
      result: { ok: false, error: { kind: 'user_rejected' } },
    });
    return;
  }

  const result = await runApprovedScript(deps.ctx, request);
  await deps.submit({
    type: 'resolve_effect',
    id: approval.id,
    result: result.ok
      ? { ok: true, value: result.value }
      : {
          ok: false,
          error: {
            kind: result.errorKind ?? 'script_failed',
            message: result.error ?? 'script failed',
          },
        },
  });
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
