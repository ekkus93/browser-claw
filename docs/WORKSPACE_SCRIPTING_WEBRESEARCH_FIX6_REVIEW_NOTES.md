# FIX6 Review Notes — Workspace Scripting / Web Research

Date: 2026-06-29

## What Was Fixed

### A1-A3 — Rust/WASM failure serialization parity with TypeScript

- Added `Runtime::tool_content_from_effect_failure()` private method in `crates/claw-core/src/lib.rs`.
- Produces `{ type: "effect_failure", kind, message, retryable }` JSON — mirrors TS `toolContentFromEffectFailure()` in `src/runtime/effectFailure.ts`.
- Wired into effect failure branch (`plan_proposal`, `sandbox_script_proposal`, `web_search`, `web_page_read`, `web_research`, `extension_request`) replacing `"Operation was not completed."`.
- Wired into `tool_call` failure branch replacing `"Tool call was not completed."`.
- Redaction handles: `"Bearer "`, `"Authorization:"`, `"sk-ant-"`, `"sk-"` (in that order to avoid partial matches).
- Fixed pre-existing duplicate `#[test]` attribute on `c2_search_missing_query_emits_invalid_web_request_audit`.
- 8 new Rust unit tests (45 total vs 37 before FIX6).

### B1-B3 — TypeScript reference runtime `readPages` validation

- `src/runtime/referenceRuntime.ts`: Added per-slot URL validation loop using `classifyFetchUrl()`.
- Each slot validated: non-empty string, then `classifyFetchUrl` safety check; emits `runtime.invalid_web_request` and short-circuits on first bad slot.
- 5 new unit tests in `referenceRuntime.test.ts`.

### C1-C2 — Reactive Settings capability status

- `src/screens/SettingsScreen.tsx`: Changed state from `capabilityStatus` (snapshot) to `rawExtensionStatus` (raw probe result).
- `capabilityStatus` now derived reactively via `useMemo` over `rawExtensionStatus`, `webKey.keyConfigured`, and `webKey.vaultLocked`.
- Capability status updates immediately when key is cleared or vault is locked — no new probe needed.
- 2 new C1 FIX6 tests in `SettingsScreen.test.tsx`.

### D1 — Bulk research rejection ordering

- `src/runtime/webRunner.ts` `runApprovedBulkResearch()`: moved `status !== 'approved'` check before `parseApprovalPayloadObject` call.
- Rejected malformed approvals now audit `web.research_rejected` (not `web.bulk_research_payload_invalid`).
- 4 new D1 tests in `webRunner.test.ts`.

### E1 — `readPages(maxPages)` top-level failure consistency

- `src/extension/pageReaderProvider.ts`: moved `expectedUrls` computation to top of `readPages()`.
- All three failure paths (transport throw, invalid top-level response, success mapping) now use `expectedUrls` instead of `request.urls`.
- 3 new E1 FIX6 tests in `pageReaderProvider.test.ts`.

### F1-F2 — Minor cleanup audit

- F1: `agentBlockParser.ts` inspected — no duplicate `script_request` union entry found; no change needed.
- F2: Targeted grep for quiet fallback patterns in `src/script`, `src/runtime`, `crates/` — all remaining `?? ''`, `.filter()`, and `unwrap_or` hits are at post-parse or UI layers, not protocol boundaries; no unsafe fallbacks found.

---

## What Remains Deferred

- **E2**: Validate `maxPages` itself (negative, zero, NaN, non-integer) — deferred to future pass.
- Extension E2E tests require headed Chrome (Xvfb/Docker); they fail in headless mode due to MV3 service worker restrictions. Docker run passes 5/5.

---

## Gate Results

| Command | Result |
|---|---|
| `pnpm run typecheck` | ✓ 0 errors |
| `pnpm run lint` | ✓ 0 warnings |
| `pnpm run format:check` | ✓ all files formatted |
| `pnpm test -- --no-file-parallelism` | ✓ 1225 passed, 125 test files |
| `pnpm run test:e2e` | ✓ 30 passed |
| `pnpm run test:extension:e2e` | ✗ 5 failed (headless: MV3 service worker; expected) |
| `pnpm run test:extension:e2e:docker` | ✓ 5 passed |
| `pnpm run build` | ✓ (chunk-size warnings only, not errors) |
| `pnpm run build:wasm` | ✓ |
| `cargo test` (claw-core) | ✓ 44 passed |
| `cargo clippy -- -D warnings` | ✓ 0 warnings |

---

## Rust/WASM Failure Serialization Status

Implemented and tested. `tool_content_from_effect_failure()` produces structured JSON matching the TypeScript contract. Token-shaped strings are redacted. 8 new Rust unit tests cover the happy path, defaults, redaction, and per-effect wiring.
