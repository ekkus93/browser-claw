import type { BrowserClawDB } from '../db/db.ts';
import type { Command } from './effectTypes.ts';
import {
  createReferenceRuntime,
  type ClawRuntimePort,
  type RuntimeSnapshot,
} from './referenceRuntime.ts';
import { executeEffect, type EffectContext } from './effectExecutor.ts';
import { SnapshotScheduler } from './snapshotScheduler.ts';

const LATEST_SNAPSHOT_ID = 'latest';

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
      snapshot: this.#port.snapshot(),
    });
  }
}

export async function loadLatestSnapshot(
  db: BrowserClawDB,
): Promise<RuntimeSnapshot | undefined> {
  const row = await db.runtime_snapshots.get(LATEST_SNAPSHOT_ID);
  return (row?.snapshot as RuntimeSnapshot | undefined) ?? undefined;
}

/** Build a host backed by the TS reference runtime, optionally restored. */
export function createRuntimeHost(
  ctx: EffectContext,
  snapshot?: RuntimeSnapshot,
): RuntimeHost {
  return new RuntimeHost(createReferenceRuntime(snapshot), ctx);
}
