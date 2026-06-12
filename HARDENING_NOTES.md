# BrowserClaw Hardening Notes — Ground Rules

These are the non-negotiable invariants for the runtime/storage/provider/skills
hardening pass. They exist so that **a user never believes BrowserClaw used the
real runtime, real provider, real audit log, real memory store, or real skill
permissions when it actually used a mock, fallback, no-op, or seeded demo
path.** Every change in this pass must preserve them.

See `docs/BROWSERCLAW_RUNTIME_STORAGE_SECURITY_HARDENING_SPEC.md` and `…_TODO.md`
for the full plan, and `docs/replies1.md` for the canonical decisions resolving
the open questions.

## The invariants

1. **No silent fallbacks.** If the Rust/WASM runtime can't load, the app fails
   closed (blocking error, audited) — it does not silently drop to the TS
   reference runtime. The reference runtime runs only behind an explicit
   `VITE_ALLOW_REFERENCE_RUNTIME_FALLBACK` (or demo mode), with a persistent
   banner and a `runtime.reference_fallback_used` audit event.

2. **No no-op effect handlers.** A missing effect port or unknown effect type is
   fatal and visible, never a silent success. Every effect failure dispatches a
   runtime/effect error, appends a durable audit event, and surfaces a
   user-visible error state.

3. **No implicit mock provider.** An unknown or unconfigured provider returns an
   error (setup-required), it does not resolve to the mock provider. The mock
   provider answers only when explicitly selected and only when the mock
   override is enabled.

4. **No fake seeded audit/memory data outside explicit demo mode.** Sample
   memories and audit events are not written into durable storage in a normal
   build. Demo data is gated behind demo mode, marked as demo, and shown with a
   banner.

5. **No decrypted secrets in Redux, localStorage, console logs, audit events, or
   screenshots.** Decrypted API keys and tokens live in the in-memory
   `SecretVault` only. This is an acceptance criterion that must hold across all
   code.

## The safety policy (how overrides are turned on)

All overrides are off by default — a normal build is fully fail-closed. They are
opt-in via build-time Vite flags, parsed once in `src/config/appConfig.ts`:

| Flag                                         | Effect                                                         |
| -------------------------------------------- | -------------------------------------------------------------- |
| `VITE_DEMO_MODE=true`                        | Enables seeded demo data; implies both overrides below.        |
| `VITE_ALLOW_REFERENCE_RUNTIME_FALLBACK=true` | Permits the TS reference runtime when WASM can't load.         |
| `VITE_ALLOW_MOCK_PROVIDER=true`              | Permits the mock provider when no real provider is configured. |

Only the exact value `true` (string or boolean) turns a flag on; anything else
is off. Whenever any override is active, `SafetyOverrideBanner` shows a
persistent warning naming the active unsafe paths.

> Note: this policy module is the single source of truth. As later phases land,
> the runtime startup (Phase 1.1) and provider resolver (Phase 2.2) consume
> `appConfig` to decide whether their fallback paths are permitted; the default
> remains fail-closed.
