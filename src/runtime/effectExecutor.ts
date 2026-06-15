import type { AppDispatch } from '../store/store.ts';
import type { BrowserClawDB } from '../db/db.ts';
import type { Effect } from './effectTypes.ts';
import { recordAudit } from '../audit/auditSink.ts';
import { normalizeRiskLevel } from '../audit/auditService.ts';
import { SNAPSHOT_SCHEMA_VERSION } from './referenceRuntime.ts';
import { type ApprovalRisk } from '../store/slices/approvalsSlice.ts';
import { runtimeErrored } from '../store/slices/runtimeSlice.ts';

/**
 * Host-side effect handlers for effects the runtime can't perform itself
 * (provider calls, durable storage, skill filesystem, tool calls). These are
 * the real wired handlers — NOT no-ops. A handler the runtime needs but that is
 * missing is FATAL: `executeEffect` calls `failEffect` (audited + visible
 * runtime error + throw), so a side effect the runtime asked for is never
 * silently skipped. The ports are optional only so tests can wire a subset.
 *
 * Note: the storage port currently implements `storage_put` only; `storage_get`
 * and `storage_search` are not backed by a real query yet and fail closed (see
 * storageRunner.ts) rather than returning fake data.
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
  tool?(
    effect: Extract<Effect, { type: 'tool_call_proposal' }>,
  ): void | Promise<void>;
}

export interface EffectContext {
  dispatch: AppDispatch;
  db: BrowserClawDB;
  /** Clock for host-side timestamps (impure side). */
  now?: () => number;
  ports?: EffectPorts;
}

export function normalizeApprovalRisk(risk: string): ApprovalRisk {
  return risk === 'high' || risk === 'medium' ? risk : 'low';
}

/**
 * Runtime-emitted audit event types that represent an anomaly and must be
 * recorded with a `failure` status (the audit channel otherwise defaults to
 * success). Currently the A2.2 stray-resolve event.
 */
const RUNTIME_FAILURE_EVENTS = new Set<string>([
  'runtime.resolve_unknown_effect',
]);

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
        // The runtime signals an anomaly (e.g. a stray resolve, A2.2) as a
        // distinct event type; record it with a failure status so it reads as a
        // problem in the audit log rather than a normal success.
        status: RUNTIME_FAILURE_EVENTS.has(effect.event_type)
          ? 'failure'
          : 'success',
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
    case 'tool_call_proposal': {
      // Routed to the tool port, which enforces skill permissions (fail closed)
      // before queuing the call for inline approval (Phase 7.4).
      const handler = ctx.ports?.tool;
      if (!handler) {
        return failEffect(ctx, effect.type, 'no tool handler is wired', now);
      }
      await handler(effect);
      return;
    }
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
        return failEffect(ctx, effect.type, 'no storage handler is wired', now);
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
