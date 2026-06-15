import type { AppConfig } from '../config/appConfig.ts';
import type { AppDispatch } from '../store/store.ts';
import type { BrowserClawDB } from '../db/db.ts';
import {
  runtimeFailed,
  type RuntimeMode,
} from '../store/slices/runtimeSlice.ts';
import { recordAudit } from '../audit/auditSink.ts';
import type { ClawRuntimePort, RuntimeSnapshot } from './referenceRuntime.ts';

/** Shown when the runtime boot sequence throws unexpectedly (A2.10). */
export const RUNTIME_BOOT_FAILED_MESSAGE =
  'The BrowserClaw runtime could not start (an unexpected error occurred during boot). Reload to try again.';

/**
 * Handle an UNEXPECTED runtime-boot failure — one thrown outside the normal
 * `onFailed` path (e.g. opening the database, reading a snapshot, or wiring the
 * host threw). Never fail silently to the console (hardening A2.10): surface a
 * blocking, app-wide runtime error AND attempt a durable audit. The audit write
 * is best-effort (if the DB itself is the failure it may also fail, which is
 * fine — the UI error still shows).
 */
export function reportRuntimeBootFailure(
  deps: { dispatch: AppDispatch; db: BrowserClawDB },
  error: unknown,
): void {
  console.error('Runtime boot failed', error);
  deps.dispatch(runtimeFailed(RUNTIME_BOOT_FAILED_MESSAGE));
  void recordAudit(deps.db, deps.dispatch, {
    type: 'runtime.boot_failed',
    summary: 'Unexpected error while starting the runtime',
    source: 'runtime',
    risk: 'high',
    status: 'failure',
  });
}

/**
 * Resolves which runtime backs the app, failing closed.
 *
 * Default behavior: load the real Rust/WASM runtime. If it can't load, the app
 * does NOT silently drop to the TS reference runtime — it fails (port `null`),
 * the caller blocks the UI and audits the failure. The reference runtime is
 * used only when `config.isDevFallbackAllowed` is explicitly enabled, in which
 * case the persistent safety banner is already showing. See HARDENING_NOTES.md.
 */
export interface RuntimeBootDeps {
  config: Pick<AppConfig, 'isDevFallbackAllowed'>;
  createWasm: (snapshot?: RuntimeSnapshot) => Promise<ClawRuntimePort>;
  createReference: (
    snapshot?: RuntimeSnapshot,
  ) => ClawRuntimePort | Promise<ClawRuntimePort>;
  /** Called when the WASM runtime loads successfully. */
  onLoaded: (mode: RuntimeMode) => void;
  /** Called when WASM failed but the dev fallback is permitted. */
  onFallback: (error: unknown) => void;
  /** Called when WASM failed and no fallback is permitted (fatal). */
  onFailed: (error: unknown) => void;
}

export interface RuntimeBootResult {
  /** The resolved port, or null when boot failed closed. */
  port: ClawRuntimePort | null;
  mode: RuntimeMode | null;
}

export async function loadRuntimePort(
  deps: RuntimeBootDeps,
  snapshot?: RuntimeSnapshot,
): Promise<RuntimeBootResult> {
  try {
    const port = await deps.createWasm(snapshot);
    deps.onLoaded('wasm');
    return { port, mode: 'wasm' };
  } catch (error) {
    if (deps.config.isDevFallbackAllowed) {
      const port = await deps.createReference(snapshot);
      deps.onFallback(error);
      return { port, mode: 'reference' };
    }
    deps.onFailed(error);
    return { port: null, mode: null };
  }
}
