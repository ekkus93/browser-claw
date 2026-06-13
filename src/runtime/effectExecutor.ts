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
import { runtimeErrored } from '../store/slices/runtimeSlice.ts';

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
 * Fail an effect closed (TODO 1.2): record a durable failure audit, surface a
 * user-visible runtime error, and throw so the host loop stops instead of
 * silently skipping a side effect the runtime asked for. Used for unknown
 * effect types and missing required handlers.
 */
async function failEffect(
  ctx: EffectContext,
  effectType: string,
  reason: string,
  now: () => number,
): Promise<never> {
  const summary = `Runtime effect '${effectType}' could not run: ${reason}`;
  await recordAudit(ctx.db, ctx.dispatch, {
    type: 'runtime.effect_failed',
    summary,
    source: 'runtime',
    status: 'failure',
    risk: 'high',
    at: now(),
  });
  ctx.dispatch(runtimeErrored(summary));
  throw new Error(summary);
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
    case 'llm_request': {
      const handler = ctx.ports?.llmRequest;
      if (!handler) {
        return failEffect(
          ctx,
          effect.type,
          'no llm_request handler is wired',
          now,
        );
      }
      await handler(effect);
      return;
    }
    case 'storage_get':
    case 'storage_put':
    case 'storage_search': {
      const handler = ctx.ports?.storage;
      if (!handler) {
        // Known gap (TODO 5.1): durable storage handlers aren't wired yet, and
        // storage_put carries no conversation_id, so a generic handler can't
        // build a valid row. Record the dropped effect rather than performing
        // it silently — but don't fail the turn: the chat flow already persists
        // messages via the llm handler, so nothing is lost. Making this fatal
        // needs the 5.1 handler + a conversation_id on the storage effect.
        await recordAudit(ctx.db, ctx.dispatch, {
          type: 'runtime.effect_dropped',
          summary: `Storage effect '${effect.type}' dropped: no storage handler wired`,
          source: 'runtime',
          status: 'failure',
          risk: 'low',
          at: now(),
        });
        return;
      }
      await handler(effect);
      return;
    }
    case 'skill_fs_read_text':
    case 'skill_state_get':
    case 'skill_state_put': {
      const handler = ctx.ports?.skill;
      if (!handler) {
        return failEffect(ctx, effect.type, 'no skill handler is wired', now);
      }
      await handler(effect);
      return;
    }
    default:
      // An effect type the host doesn't recognize (e.g. a malformed effect from
      // the WASM boundary) must fail, never be silently skipped.
      return failEffect(
        ctx,
        (effect as { type: string }).type,
        'unknown effect type',
        now,
      );
  }
}
