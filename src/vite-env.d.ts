/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Enable seeded demo data; implies the dev runtime/provider overrides. */
  readonly VITE_DEMO_MODE?: string;
  /** Permit falling back to the TS reference runtime if WASM can't load. */
  readonly VITE_ALLOW_REFERENCE_RUNTIME_FALLBACK?: string;
  /** Permit the mock provider to answer when no real provider is configured. */
  readonly VITE_ALLOW_MOCK_PROVIDER?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
