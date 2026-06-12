/**
 * App-wide safety configuration policy.
 *
 * BrowserClaw fails closed by default: in a normal build, none of the
 * "unsafe convenience" behaviors are permitted. Each must be turned on
 * explicitly via a build-time `VITE_*` flag, and whenever any is on the user
 * sees a persistent banner (see `SafetyOverrideBanner`).
 *
 * The three overrides this policy governs:
 *   - reference-runtime fallback (when the Rust/WASM runtime can't load),
 *   - the in-memory mock provider (used when no real provider is configured),
 *   - seeded demo data (sample memories/audit events).
 *
 * Canonical rule: a user must never believe BrowserClaw used the real runtime,
 * real provider, real audit log, real memory store, or real skill permissions
 * when it actually used a mock, fallback, no-op, or seeded demo path. These
 * flags are the *only* way to opt into those paths, and they are always
 * surfaced. See HARDENING_NOTES.md.
 */

/** Minimal env shape we read from. `import.meta.env` satisfies this. */
export type AppConfigEnv = Record<string, string | boolean | undefined>;

export interface AppConfig {
  /** Demo mode: permits seeded sample data and implies the dev overrides. */
  readonly isDemoMode: boolean;
  /** Allow falling back to the TS reference runtime if WASM can't load. */
  readonly isDevFallbackAllowed: boolean;
  /** Allow the mock provider to answer when no real provider is configured. */
  readonly isMockProviderAllowed: boolean;
  /** True if any override is active — drives the persistent warning banner. */
  readonly isSafetyOverrideActive: boolean;
}

/** A `VITE_*` flag counts as on only for the exact string/boolean `true`. */
function isFlagEnabled(value: string | boolean | undefined): boolean {
  return value === true || value === 'true';
}

/**
 * Derive the safety policy from an env record. Pure and total: an empty record
 * yields the fully fail-closed configuration (every override off). Demo mode
 * implies both dev overrides so demo builds are self-consistent.
 */
export function parseAppConfig(env: AppConfigEnv): AppConfig {
  const isDemoMode = isFlagEnabled(env.VITE_DEMO_MODE);
  const isDevFallbackAllowed =
    isDemoMode || isFlagEnabled(env.VITE_ALLOW_REFERENCE_RUNTIME_FALLBACK);
  const isMockProviderAllowed =
    isDemoMode || isFlagEnabled(env.VITE_ALLOW_MOCK_PROVIDER);
  const isSafetyOverrideActive =
    isDemoMode || isDevFallbackAllowed || isMockProviderAllowed;
  return {
    isDemoMode,
    isDevFallbackAllowed,
    isMockProviderAllowed,
    isSafetyOverrideActive,
  };
}

/** The resolved policy for this build, derived once from Vite's env. */
export const appConfig: AppConfig = parseAppConfig(import.meta.env);
