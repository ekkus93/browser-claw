import type { BrowserClawDB } from '../db/db.ts';
import type { Command } from './effectTypes.ts';
import {
  createReferenceRuntime,
  type ClawRuntimePort,
  type RuntimeSnapshot,
} from './referenceRuntime.ts';
import { executeEffect, type EffectContext } from './effectExecutor.ts';

const LATEST_SNAPSHOT_ID = 'latest';

/**
 * Owns a runtime port and runs the command -> effects -> side-effects loop,
 * plus snapshot persistence. The host is a service (not Redux state) since it
 * holds the live runtime; the listener middleware drives it.
 */
export class RuntimeHost {
  readonly #port: ClawRuntimePort;
  readonly #ctx: EffectContext;

  constructor(port: ClawRuntimePort, ctx: EffectContext) {
    this.#port = port;
    this.#ctx = ctx;
  }

  async submit(command: Command): Promise<void> {
    for (const effect of this.#port.dispatch(command)) {
      await executeEffect(effect, this.#ctx);
    }
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
