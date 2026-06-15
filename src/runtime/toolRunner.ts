import type { BrowserClawDB } from '../db/db.ts';
import type { AppDispatch } from '../store/store.ts';
import { recordAudit } from '../audit/auditSink.ts';
import { approvalRequested } from '../store/slices/approvalsSlice.ts';
import { authorizeSkillTool } from '../skills/skillPermissions.ts';
import type { Command, Effect } from './effectTypes.ts';
import { normalizeApprovalRisk } from './effectExecutor.ts';
import { runToolCall, type ToolContext } from '../tools/tools.ts';
import { getApprovalPolicy } from '../settings/appSettings.ts';

type ToolEffect = Extract<Effect, { type: 'tool_call_proposal' }>;

export interface ToolEffectDeps {
  db: BrowserClawDB;
  dispatch: AppDispatch;
  /** Feed a command back into the runtime (host.submit) to resolve the effect. */
  submit: (command: Command) => Promise<void>;
  /**
   * The active conversation id, for provenance on an auto-approved tool's
   * persisted record (e.g. Remember). Optional — when absent, an auto-approved
   * call simply runs without conversation provenance.
   */
  getConversationId?: () => string;
}

/**
 * Handles the runtime's `tool_call_proposal` effect. Fails closed (Phase 7.4):
 * a tool call is only queued for approval if it comes from an installed,
 * ENABLED skill that DECLARED the tool. Otherwise it is audited and resolved
 * back as a failure so the runtime never proceeds as if the tool ran. A
 * permitted call still requires the user's inline approval before it executes.
 */
export function createToolEffectHandler(deps: ToolEffectDeps) {
  async function deny(effect: ToolEffect, reason: string): Promise<void> {
    void recordAudit(deps.db, deps.dispatch, {
      type: 'tool.denied',
      summary: `Tool '${effect.name}' denied: ${reason}`,
      source: 'skill',
      risk: 'medium',
      status: 'failure',
      toolName: effect.name,
      ...(effect.skill_id ? { skillId: effect.skill_id } : {}),
    });
    await deps.submit({
      type: 'resolve_effect',
      id: effect.id,
      result: {
        ok: false,
        error: { kind: 'tool_not_permitted', message: reason },
      },
    });
  }

  return async (effect: ToolEffect): Promise<void> => {
    const authz = await authorizeSkillTool(
      deps.db,
      effect.skill_id ?? '',
      effect.name,
    );
    if (!authz.ok) {
      await deny(effect, authz.reason);
      return;
    }

    // Permitted. The approval policy decides whether the user must confirm or
    // the call may auto-run. Fail-closed: only the opt-in 'auto_low_medium'
    // policy relaxes anything, and even then HIGH risk ALWAYS prompts — there is
    // no path that auto-approves a high-risk effect.
    const risk = normalizeApprovalRisk(effect.risk);
    const policy = await getApprovalPolicy(deps.db);
    if (policy === 'auto_low_medium' && risk !== 'high') {
      // Auto-approved — but never silent: audit the auto-approval, then run it
      // through the SAME execution path as a user approval (which audits
      // tool.executed and resolves the effect).
      void recordAudit(deps.db, deps.dispatch, {
        type: 'tool.auto_approved',
        summary: `Tool '${effect.name}' auto-approved (${risk} risk, policy)`,
        source: 'skill',
        risk: 'low',
        status: 'success',
        toolName: effect.name,
        skillId: effect.skill_id,
      });
      await runApprovedToolCall(
        { db: deps.db, dispatch: deps.dispatch, submit: deps.submit },
        {
          id: effect.id,
          status: 'approved',
          toolName: effect.name,
          argsJson: JSON.stringify(effect.args),
          skillId: effect.skill_id,
          ...(deps.getConversationId
            ? { conversationId: deps.getConversationId() }
            : {}),
        },
      );
      return;
    }

    // Surface it for inline approval; nothing runs until approved. The
    // payloadPreview is the exact args JSON the user reviews and may EDIT; it's
    // the single source of truth for what actually runs.
    void recordAudit(deps.db, deps.dispatch, {
      type: 'tool.proposed',
      summary: `Tool '${effect.name}' proposed`,
      source: 'skill',
      risk: 'info',
      status: 'pending',
      toolName: effect.name,
      skillId: effect.skill_id,
    });
    deps.dispatch(
      approvalRequested({
        id: effect.id,
        kind: 'tool_call',
        title: effect.name,
        risk,
        summary: `Tool call: ${effect.name}`,
        payloadPreview: JSON.stringify(effect.args),
        toolName: effect.name,
        skillId: effect.skill_id,
      }),
    );
  };
}

export interface ApprovedToolCall {
  id: string;
  status: 'approved' | 'rejected';
  toolName?: string;
  /** The (possibly user-edited) args JSON from the approval card. */
  argsJson?: string;
  /** Provenance threaded to the tool (e.g. for a persisted memory). */
  conversationId?: string;
  skillId?: string;
}

function parseArgs(argsJson: string | undefined): Record<string, unknown> {
  if (!argsJson) return {};
  try {
    const parsed: unknown = JSON.parse(argsJson);
    return typeof parsed === 'object' &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export interface RunApprovedToolDeps {
  db: BrowserClawDB;
  dispatch: AppDispatch;
  submit: (command: Command) => Promise<void>;
  /** Tool execution context (e.g. injectable fetch). Defaults to {}. */
  ctx?: ToolContext;
}

/**
 * Run (or decline) a tool call the user resolved on the approval card, then
 * resolve the effect back into the runtime so it continues the turn. A
 * rejection or a tool error resolves as a failure — the runtime never proceeds
 * as if a declined/failed tool succeeded.
 *
 * Defense in depth (hardening A1.1): permission is RE-CHECKED here at execution
 * time, not trusted from the approval/Redux state. An approval can sit in the
 * queue while the skill is disabled or has the tool revoked; the proposal-time
 * check (see createToolEffectHandler) is not the security boundary.
 */
export async function runApprovedToolCall(
  deps: RunApprovedToolDeps,
  approval: ApprovedToolCall,
): Promise<void> {
  const name = approval.toolName ?? '';
  if (approval.status !== 'approved') {
    void recordAudit(deps.db, deps.dispatch, {
      type: 'tool.rejected',
      summary: `Tool '${name}' rejected by the user`,
      source: 'skill',
      risk: 'low',
      status: 'failure',
      toolName: name,
    });
    await deps.submit({
      type: 'resolve_effect',
      id: approval.id,
      result: { ok: false, error: { kind: 'user_rejected' } },
    });
    return;
  }
  // Re-authorize against the skill's PROTECTED permissions before running.
  const skillId = approval.skillId ?? '';
  const authz = await authorizeSkillTool(deps.db, skillId, name);
  if (!authz.ok) {
    void recordAudit(deps.db, deps.dispatch, {
      type: 'tool.permission_recheck_failed',
      summary: `Tool '${name}' blocked at execution: ${authz.reason}`,
      source: 'skill',
      risk: 'medium',
      status: 'failure',
      toolName: name,
      ...(skillId ? { skillId } : {}),
    });
    await deps.submit({
      type: 'resolve_effect',
      id: approval.id,
      result: {
        ok: false,
        error: { kind: 'tool_not_permitted', message: authz.reason },
      },
    });
    return;
  }
  const args = parseArgs(approval.argsJson);
  // The tool gets db/dispatch + provenance so a persisting tool (Remember) can
  // write a correctly-attributed, audited record.
  const ctx: ToolContext = {
    ...(deps.ctx ?? {}),
    db: deps.db,
    dispatch: deps.dispatch,
    ...(approval.conversationId
      ? { conversationId: approval.conversationId }
      : {}),
    ...(approval.skillId ? { skillId: approval.skillId } : {}),
  };
  try {
    const output = await runToolCall(
      { name, args },
      { allowedTools: [name], ctx },
    );
    void recordAudit(deps.db, deps.dispatch, {
      type: 'tool.executed',
      summary: `Tool '${name}' executed`,
      source: 'skill',
      risk: 'info',
      status: 'success',
      toolName: name,
    });
    await deps.submit({
      type: 'resolve_effect',
      id: approval.id,
      result: { ok: true, text: output },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    void recordAudit(deps.db, deps.dispatch, {
      type: 'tool.failed',
      summary: `Tool '${name}' failed: ${message}`,
      source: 'skill',
      risk: 'low',
      status: 'failure',
      toolName: name,
    });
    await deps.submit({
      type: 'resolve_effect',
      id: approval.id,
      result: { ok: false, error: { kind: 'tool_failed', message } },
    });
  }
}
