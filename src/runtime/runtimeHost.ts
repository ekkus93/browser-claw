import type { BrowserClawDB } from '../db/db.ts';
import type { Command } from './effectTypes.ts';
import {
  createReferenceRuntime,
  SNAPSHOT_SCHEMA_VERSION,
  type ClawRuntimePort,
  type RuntimeSnapshot,
} from './referenceRuntime.ts';
import { executeEffect, type EffectContext } from './effectExecutor.ts';
import { SnapshotScheduler } from './snapshotScheduler.ts';

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

  constructor(
    port: ClawRuntimePort,
    ctx: EffectContext,
    options?: RuntimeHostOptions,
  ) {
    this.#port = port;
    this.#ctx = ctx;
    this.#snapshots = options?.snapshot
      ? new SnapshotScheduler(
          () => this.saveSnapshot(),
          options.snapshot.delayMs,
          options.snapshot.onError,
        )
      : undefined;
  }

  async submit(command: Command): Promise<void> {
    for (const effect of this.#port.dispatch(command)) {
      await executeEffect(effect, this.#ctx);
    }
    // Coalesced save after the turn settles (no-op unless snapshots enabled).
    this.#snapshots?.schedule();
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
