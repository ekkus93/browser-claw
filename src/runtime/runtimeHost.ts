import type { BrowserClawDB } from '../db/db.ts';
import type { Command, Effect } from './effectTypes.ts';
import {
  createReferenceRuntime,
  SNAPSHOT_SCHEMA_VERSION,
  type ClawRuntimePort,
  type RuntimeSnapshot,
} from './referenceRuntime.ts';
import { executeEffect, type EffectContext } from './effectExecutor.ts';
import { recordAudit } from '../audit/auditSink.ts';
import { SnapshotScheduler } from './snapshotScheduler.ts';

/**
 * Effects the host runs to completion itself (the audit log + snapshot saves).
 * They have no emitted -> resolved lifecycle, and auditing them would be noise
 * (and, for audit_append, near-self-referential), so they're excluded from the
 * verbose effect-lifecycle audit.
 */
const TERMINAL_EFFECTS = new Set<Effect['type']>([
  'audit_append',
  'runtime_snapshot_save',
]);

const LATEST_SNAPSHOT_ID = 'latest';

/** Outcome of attempting to load the persisted snapshot. */
export type SnapshotLoad =
  | { status: 'none' }
  | { status: 'ok'; snapshot: RuntimeSnapshot }
  | { status: 'incompatible'; foundVersion: number | undefined };

export interface RuntimeHostOptions {
  /** Enable debounced snapshot persistence after each submitted command. */
  snapshot?: {
    delayMs?: number;
    onError?: (error: unknown) => void;
  };
  /**
   * Predicate gating the verbose effect-lifecycle audit. Called per submit; when
   * it returns true the host records runtime.effect_emitted/resolved events.
   * Default off (no predicate) keeps the audit log uncluttered.
   */
  auditEffects?: () => boolean;
}

/**
 * Owns a runtime port and runs the command -> effects -> side-effects loop,
 * plus snapshot persistence. The host is a service (not Redux state) since it
 * holds the live runtime; the listener middleware drives it.
 */
export class RuntimeHost {
  readonly #port: ClawRuntimePort;
  readonly #ctx: EffectContext;
  readonly #snapshots: SnapshotScheduler | undefined;
  readonly #auditEffects: (() => boolean) | undefined;

  constructor(
    port: ClawRuntimePort,
    ctx: EffectContext,
    options?: RuntimeHostOptions,
  ) {
    this.#port = port;
    this.#ctx = ctx;
    this.#auditEffects = options?.auditEffects;
    this.#snapshots = options?.snapshot
      ? new SnapshotScheduler(
          () => this.saveSnapshot(),
          options.snapshot.delayMs,
          options.snapshot.onError,
        )
      : undefined;
  }

  async submit(command: Command): Promise<void> {
    const verbose = this.#auditEffects?.() ?? false;
    // A resolve_effect command IS the resolution of a previously emitted effect;
    // record that transition (success/failure from result.ok) before draining
    // the follow-up effects it produces.
    if (verbose && command.type === 'resolve_effect') {
      this.#auditResolved(command);
    }
    for (const effect of this.#port.dispatch(command)) {
      if (verbose) this.#auditEmitted(effect);
      await executeEffect(effect, this.#ctx);
    }
    // Coalesced save after the turn settles (no-op unless snapshots enabled).
    this.#snapshots?.schedule();
  }

  #auditEmitted(effect: Effect): void {
    if (TERMINAL_EFFECTS.has(effect.type)) return;
    void recordAudit(this.#ctx.db, this.#ctx.dispatch, {
      type: 'runtime.effect_emitted',
      summary: `Effect emitted: ${effect.type}`,
      source: 'runtime',
      risk: 'info',
      status: 'pending',
      effectId: effect.id,
    });
  }

  #auditResolved(command: Extract<Command, { type: 'resolve_effect' }>): void {
    const result = command.result as { ok?: boolean } | null;
    const ok = result?.ok !== false;
    void recordAudit(this.#ctx.db, this.#ctx.dispatch, {
      type: ok ? 'runtime.effect_resolved' : 'runtime.effect_failed',
      summary: ok
        ? `Effect resolved: ${command.id}`
        : `Effect resolved with failure: ${command.id}`,
      source: 'runtime',
      risk: 'info',
      status: ok ? 'success' : 'failure',
      effectId: command.id,
    });
  }

  /** Persist any pending snapshot immediately (idle/error/before-unload). */
  async flushSnapshot(): Promise<void> {
    await this.#snapshots?.flush();
  }

  /** Persist the current runtime state so it survives reload. */
  async saveSnapshot(): Promise<void> {
    const now = this.#ctx.now ?? Date.now;
    await this.#ctx.db.runtime_snapshots.put({
      id: LATEST_SNAPSHOT_ID,
      createdAt: now(),
      version: SNAPSHOT_SCHEMA_VERSION,
      snapshot: this.#port.snapshot(),
    });
  }
}

/**
 * Load the persisted snapshot, gating on schema compatibility. A snapshot whose
 * stored version does not match SNAPSHOT_SCHEMA_VERSION (including pre-version
 * rows with no version) is dropped from storage and reported as `incompatible`
 * so the caller can audit it and start fresh — restoring it could silently
 * corrupt runtime state. Dropping it also stops it failing the same way forever.
 */
export async function loadLatestSnapshot(
  db: BrowserClawDB,
): Promise<SnapshotLoad> {
  const row = await db.runtime_snapshots.get(LATEST_SNAPSHOT_ID);
  if (!row || row.snapshot === undefined) return { status: 'none' };
  if (row.version !== SNAPSHOT_SCHEMA_VERSION) {
    await db.runtime_snapshots.delete(LATEST_SNAPSHOT_ID);
    return { status: 'incompatible', foundVersion: row.version };
  }
  return { status: 'ok', snapshot: row.snapshot as RuntimeSnapshot };
}

/** Build a host backed by the TS reference runtime, optionally restored. */
export function createRuntimeHost(
  ctx: EffectContext,
  snapshot?: RuntimeSnapshot,
): RuntimeHost {
  return new RuntimeHost(createReferenceRuntime(snapshot), ctx);
}
