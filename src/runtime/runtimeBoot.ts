import type { AppConfig } from '../config/appConfig.ts';
import type { RuntimeMode } from '../store/slices/runtimeSlice.ts';
import type { ClawRuntimePort, RuntimeSnapshot } from './referenceRuntime.ts';

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
