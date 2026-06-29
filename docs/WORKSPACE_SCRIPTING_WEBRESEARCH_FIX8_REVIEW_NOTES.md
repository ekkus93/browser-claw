# FIX8 Review Notes — Workspace Scripting / Web Research

Date: 2026-06-29

## What Was Fixed

### A1/A2/A3 — Canonical `browserclaw-web` Options

- `src/script/agentBlockParser.ts`:
  - Added `CanonicalWebOptions` interface (`maxPages?`, `maxChars?`, `maxResults?`).
  - Added `canonicalizeWebRequestOptions()` helper — merges top-level convenience fields into nested `options`; rejects conflicting top-level/nested values; validates `maxPages` via `normalizeOptionalPositiveIntegerLimit`.
  - Updated `BrowserClawWebRequest.options?: CanonicalWebOptions` (typed, not `Record<string, unknown>`).
  - Removed top-level `maxPages`/`maxChars`/`maxResults` from the interface (now canonical only via `options`).
  - 8 new A1/A2 FIX8 tests covering top-level normalization, conflict rejection, and invalid maxPages.
- `src/runtime/referenceRuntime.ts`: removed unnecessary cast on `webRequest.options` access.

### B1 — Reference Runtime Forwards Validated Options

- `src/runtime/referenceRuntime.ts` `readPages` branch:
  - `validatedMaxPages` now captured from `normalizeOptionalPositiveIntegerLimit`.
  - Emitted `web_research` effect includes `options: { maxPages: validatedMaxPages }` when present.
  - Previously: validated maxPages then emitted effect WITHOUT `options`, silently dropping the limit.
- 2 new B1 FIX8 tests in `referenceRuntime.test.ts`.

### C1/C2 — WebRunner Invalid Option Handling

- `src/runtime/webRunner.ts` `web_research` handler:
  - `sanitizeResearchOptions(effect.options)` wrapped in try/catch.
  - On error: calls `failInvalidWebEffect()` → audits `web.effect_payload_invalid`, resolves `ok:false`, no approval dispatched.
  - Previously: `sanitizeResearchOptions()` was called before any try/catch; invalid options threw uncaught.
- `web_search`: `sanitizeSearchOptions()` already inside try block — no change needed.
- `web_page_read`: `sanitizeReadOptions()` already inside try block — no change needed.
- 3 new C1 FIX8 tests in `webRunner.test.ts`.

### D1/D2 — Extension Handler Defense-in-Depth

- `extension/chrome-web-research/service-worker.js` `handleReadPages()`:
  - Added `validateOptionalPositiveIntegerLimit(maxPages, 'maxPages', READ_PAGES_MAX)` at start.
  - Invalid direct-call `maxPages` returns structured `invalid_request`; does not read any pages.
  - Updated `effectiveMax` computation to use `maxPages` directly (no fallback to `urls.length` since invalid is now rejected).
- Policy change: above-`READ_PAGES_MAX` values now **rejected** (not clamped). Updated existing B1 capping test.
- 5 new D1 FIX8 tests + 1 updated B1 test in `serviceWorkerReadPages.test.ts`.

### E1 — Rust Redaction Precision

- `crates/claw-core/src/lib.rs`:
  - Replaced `redact_marker_all()` with `redact_sk_tokens()` and `redact_bearer_tokens()`.
  - `redact_sk_tokens(prefix)`: checks `is_sk_boundary_before()` (requires non-alphanumeric/non-hyphen/non-underscore before) AND `secret_suffix_len() >= 12` (minimum 12 chars after prefix). Prevents `risk-level`, `task-id`, `disk-cache`, `ask-for-help` from being redacted.
  - `redact_bearer_tokens()`: checks `is_word_boundary_before()` (whitespace/start/punctuation).
  - `redact_authorization_headers()`: unchanged (loop-based, no false-positive risk).
  - 8 new E1 FIX8 Rust tests; 58 total cargo tests pass.

---

## What Remains Deferred

- B2: Option forwarding for `search`, `readPage`, `research` ops — `maxResults`/`maxChars` from top-level are normalized into `options` by the parser (A1) and then passed via `webRequest.options` to the runtime. The runtime emits effects without forwarding `options` for `search`/`readPage`/`research`; however, `webRunner.ts` handlers correctly read `effect.options` when present. The gap (runtime drops options on emission) is a pre-existing limitation; FIX8 closes the most critical path (readPages + maxPages).
- B3: `validateRuntimeWebOptions()` shared helper not added; `normalizeOptionalPositiveIntegerLimit` is used directly at each boundary.

---

## Gate Results

| Command | Result |
|---|---|
| `pnpm run typecheck` | ✓ 0 errors |
| `pnpm run lint` | ✓ 0 warnings |
| `pnpm run format:check` | ✓ all files formatted |
| `pnpm test -- --no-file-parallelism` | ✓ 1283 passed, 126 test files |
| `pnpm run test:e2e` | ✓ 30 passed |
| `pnpm run test:extension:e2e` | ✗ 5 failed (headless MV3 service worker; expected) |
| `pnpm run test:extension:e2e:docker` | ✓ 5 passed (after FIX8 changes) |
| `pnpm run build` | ✓ (chunk-size warnings only) |
| `pnpm run build:wasm` | ✓ |
| `cargo test` (claw-core) | ✓ 58 passed |
| `cargo clippy -- -D warnings` | ✓ 0 warnings |
