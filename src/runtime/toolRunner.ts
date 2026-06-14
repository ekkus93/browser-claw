import type { BrowserClawDB } from '../db/db.ts';
import type { AppDispatch } from '../store/store.ts';
import { recordAudit } from '../audit/auditSink.ts';
import { approvalRequested } from '../store/slices/approvalsSlice.ts';
import type { SkillPermissions } from '../skills/skillTypes.ts';
import type { Command, Effect } from './effectTypes.ts';
import { normalizeApprovalRisk } from './effectExecutor.ts';
import { runToolCall, type ToolContext } from '../tools/tools.ts';

type ToolEffect = Extract<Effect, { type: 'tool_call_proposal' }>;

/** Where a skill's declared permissions live in its private state. */
const PERMISSIONS_KEY = '__permissions__';

export interface ToolEffectDeps {
  db: BrowserClawDB;
  dispatch: AppDispatch;
  /** Feed a command back into the runtime (host.submit) to resolve the effect. */
  submit: (command: Command) => Promise<void>;
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
    if (!effect.skill_id) {
      await deny(effect, 'no active skill');
      return;
    }
    const skill = await deps.db.skills.get(effect.skill_id);
    if (!skill) {
      await deny(effect, `unknown skill ${effect.skill_id}`);
      return;
    }
    if (!skill.enabled) {
      await deny(effect, `skill ${effect.skill_id} is disabled`);
      return;
    }
    const permRow = await deps.db.skill_state.get([
      effect.skill_id,
      PERMISSIONS_KEY,
    ]);
    const tools = (permRow?.value as SkillPermissions | undefined)?.tools ?? [];
    if (!tools.includes(effect.name)) {
      await deny(
        effect,
        `skill ${effect.skill_id} did not declare tool '${effect.name}'`,
      );
      return;
    }

    // Permitted — surface it for inline approval; nothing runs until approved.
    deps.dispatch(
      approvalRequested({
        id: effect.id,
        kind: 'tool_call',
        title: effect.name,
        risk: normalizeApprovalRisk(effect.risk),
        summary: `Tool call: ${effect.name}`,
        payloadPreview: JSON.stringify(effect.args),
        toolName: effect.name,
        toolArgs: effect.args,
      }),
    );
  };
}

export interface ApprovedToolCall {
  id: string;
  status: 'approved' | 'rejected';
  toolName?: string;
  toolArgs?: unknown;
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
 * as if a declined/failed tool succeeded. Permission was already enforced when
 * the call was queued (see createToolEffectHandler).
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
  const args =
    typeof approval.toolArgs === 'object' && approval.toolArgs !== null
      ? (approval.toolArgs as Record<string, unknown>)
      : {};
  try {
    const output = await runToolCall(
      { name, args },
      { allowedTools: [name], ctx: deps.ctx ?? {} },
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
