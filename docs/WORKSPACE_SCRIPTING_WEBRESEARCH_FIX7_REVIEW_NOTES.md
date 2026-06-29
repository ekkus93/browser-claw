# FIX7 Review Notes — Workspace Scripting / Web Research

Date: 2026-06-29

## What Was Fixed

### A1-A3 — Rust failure redaction completeness

- `crates/claw-core/src/lib.rs`: replaced one-shot `redact()` with two loop-based helpers:
  - `redact_marker_all(input, marker)` — loops until no marker remains (replaces `if contains`).
  - `redact_authorization_headers(input)` — loops until no `Authorization:` remains.
- Redact order: `Authorization:` → `Bearer ` → `sk-ant-` → `sk-` (more-specific first).
- Semantically aligned with TypeScript `toolContentFromEffectFailure()` global regex replacement.
- 6 new A1/A2 FIX7 tests: two `sk-` tokens, `sk-ant-` + `sk-`, two `Bearer` tokens, `Authorization: Bearer`, mixed, and no-false-positive case.
- 50 cargo tests pass, clippy -D warnings clean.

### B1-B4 — `maxPages` validation and normalization

- New file `src/webresearch/limits.ts`:
  - `normalizeOptionalPositiveIntegerLimit(value, field, {max})` — rejects 0, negative, NaN, Infinity, non-integers, strings; accepts undefined or positive integer ≤ max.
  - `LimitValidationError` with `kind` field.
  - `MAX_BATCH_PAGE_READS = 10`, `DEFAULT_MAX_PAGE_CHARS = 50_000`.
- Applied at all protocol boundaries:
  - `src/extension/pageReaderProvider.ts`: validates before computing `expectedUrls`; invalid returns failure for all requested URLs.
  - `src/webresearch/service.ts`: validates in both `research()` and `readPages()`.
  - `src/runtime/webRunner.ts`: validates in `sanitizeResearchOptions()`.
  - `src/script/planOps.ts`: validates before calling `ctx.web.readPages()`; invalid throws `PlanOpError`.
  - `src/runtime/referenceRuntime.ts`: validates `web_request readPages options.maxPages`; invalid emits `runtime.invalid_web_request`.
- 10 unit tests for the helper (limits.test.ts) + 19 B3 tests across 4 test files.

### C1-C2 — Extension `read_pages` central validation

- `extension/chrome-web-research/service-worker.js`:
  - Added `validateNonEmptyStringArray(value, field)` — checks every slot is a non-empty string; returns error message string or null.
  - Added `validateOptionalPositiveIntegerLimit(value, field, max)` — checks optional positive integer; returns error message string or null.
  - `validateMessageSchema` `read_pages` branch: per-slot slot validation (C1) + `maxPages` validation (C2) before handler dispatch.
  - `handleReadPages`: updated limit computation to use `Number.isInteger(maxPages) && maxPages >= 1` guard (defense-in-depth); no longer falls back to `urls.length` on invalid `maxPages`.
  - `READ_PAGES_MAX` constant moved before validation helpers so they can reference it.
- 10 new C1/C2 FIX7 tests in `serviceWorkerReadPages.test.ts`.

---

## What Remains Deferred

- None in FIX7 scope. All acceptance criteria met.

---

## Gate Results

| Command | Result |
|---|---|
| `pnpm run typecheck` | ✓ 0 errors |
| `pnpm run lint` | ✓ 0 warnings |
| `pnpm run format:check` | ✓ all files formatted |
| `pnpm test -- --no-file-parallelism` | ✓ 1264 passed, 126 test files |
| `pnpm run test:e2e` | ✓ 30 passed |
| `pnpm run test:extension:e2e` | ✗ 5 failed (headless MV3 service worker; expected) |
| `pnpm run test:extension:e2e:docker` | ✓ 5 passed (after FIX7 changes) |
| `pnpm run build` | ✓ (chunk-size warnings only) |
| `pnpm run build:wasm` | ✓ |
| `cargo test` (claw-core) | ✓ 50 passed |
| `cargo clippy -- -D warnings` | ✓ 0 warnings |
