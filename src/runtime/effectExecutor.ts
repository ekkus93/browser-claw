import type { AppDispatch } from '../store/store.ts';
import type { BrowserClawDB } from '../db/db.ts';
import type { Effect } from './effectTypes.ts';
import { recordAudit } from '../audit/auditSink.ts';
import { normalizeRiskLevel } from '../audit/auditService.ts';
import { SNAPSHOT_SCHEMA_VERSION } from './referenceRuntime.ts';
import {
  approvalRequested,
  type ApprovalRisk,
} from '../store/slices/approvalsSlice.ts';

/**
 * Host-side effect handlers for effects the runtime can't perform itself.
 * Provider calls (llm_request), durable storage, and skill filesystem access
 * are filled in by their respective phases (7, 3/later, 10); until then they
 * are injectable no-ops.
 */
export interface EffectPorts {
  llmRequest?(
    effect: Extract<Effect, { type: 'llm_request' }>,
  ): void | Promise<void>;
  storage?(
    effect: Extract<
      Effect,
      { type: 'storage_get' | 'storage_put' | 'storage_search' }
    >,
  ): void | Promise<void>;
  skill?(
    effect: Extract<
      Effect,
      { type: 'skill_fs_read_text' | 'skill_state_get' | 'skill_state_put' }
    >,
  ): void | Promise<void>;
}

export interface EffectContext {
  dispatch: AppDispatch;
  db: BrowserClawDB;
  /** Clock for host-side timestamps (impure side). */
  now?: () => number;
  ports?: EffectPorts;
}

function normalizeApprovalRisk(risk: string): ApprovalRisk {
  return risk === 'high' || risk === 'medium' ? risk : 'low';
}

/**
 * Route one runtime effect to its side effect: audit -> Redux feed, snapshot
 * -> Dexie, tool-call -> the approval queue, and the rest -> injected ports.
 * Decrypted secrets never appear in an effect payload, so nothing here leaks.
 */
export async function executeEffect(
  effect: Effect,
  ctx: EffectContext,
): Promise<void> {
  const now = ctx.now ?? Date.now;
  switch (effect.type) {
    case 'audit_append':
      await recordAudit(ctx.db, ctx.dispatch, {
        type: effect.event_type,
        summary: effect.summary,
        source: 'runtime',
        risk: normalizeRiskLevel(effect.risk),
        at: now(),
      });
      return;
    case 'runtime_snapshot_save':
      await ctx.db.runtime_snapshots.put({
        id: effect.id,
        createdAt: now(),
        version: SNAPSHOT_SCHEMA_VERSION,
        snapshot: effect.snapshot,
      });
      return;
    case 'tool_call_proposal':
      ctx.dispatch(
        approvalRequested({
          id: effect.id,
          kind: 'tool_call',
          title: effect.name,
          risk: normalizeApprovalRisk(effect.risk),
          summary: `Tool call: ${effect.name}`,
          payloadPreview: JSON.stringify(effect.args),
        }),
      );
      return;
    case 'llm_request':
      await ctx.ports?.llmRequest?.(effect);
      return;
    case 'storage_get':
    case 'storage_put':
    case 'storage_search':
      await ctx.ports?.storage?.(effect);
      return;
    case 'skill_fs_read_text':
    case 'skill_state_get':
    case 'skill_state_put':
      await ctx.ports?.skill?.(effect);
      return;
  }
}
