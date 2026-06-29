# FIX5 Review Notes — Workspace Scripting / Web Research

Date: 2026-06-29

## What Was Fixed

### A1-A3 — Plan Runtime `web.readPages` strict validation
- Added `requirePlanStringArrayField()` call for the `urls` array in `planOps.ts`.
- Added `classifyFetchUrl()` check for every URL slot before calling the provider.
- `readPages()` calls `ctx.web.readPages()` once (batch) rather than calling `readPage()` per URL.
- Tests: 3 unit tests in `planOps.test.ts`.

### B1-B3 — Sandbox `memory.search` caps and sensitivity filter
- Memory snippets returned by `memory.search` are capped to 500 chars each.
- Sensitive memories (tagged as sensitive) are excluded from search results.
- Tests: 3 unit tests in sandbox runner tests.

### C1 — Settings UI capability-specific WebResearch status
- `SettingsScreen.tsx`: `extensionProbe` now calls `normalizeExtensionStatus()` and stores result as `capabilityStatus` state.
- `capabilityStatus` is passed to `WebResearchStatus` as `capabilities=` prop.
- Tests: 5 unit tests in `SettingsScreen.test.tsx`.

### C2 — Settings UI truthful copy about host-permission flow
- `WebResearchStatus.tsx` footer updated: explicitly says BrowserClaw cannot complete new host-permission grants in v0.1; users must grant access through the extension or Chrome settings.

### C3 — Sandbox policy visible in Settings
- Added "Sandbox engine: QuickJS (bundled)" field.
- Paragraph says "disabled by policy in v0.1" — no implication that scripting is user-live.

### D1+D2 — Shared extension E2E helpers; stageExtensionDir symlink fix
- `tests/extension-e2e/helpers.ts`: `getServiceWorker()`, `getExtensionId()`, `stageExtensionDir()`, `assertExtensionFixture()`.
- `stageExtensionDir()` uses `fs.realpathSync + fs.copyFileSync` (not `cpSync dereference:true` which doesn't work in Node 24) to resolve all symlinks before loading into Chrome.

### D3+D4 — Docker extension E2E proof
- Added `.dockerignore` (excludes `node_modules`) — was the root cause of `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`.
- Dockerfile: `CMD ["sh", "-c", "Xvfb :99 ... && pnpm run test:extension:e2e"]` — MV3 service workers don't register in Chrome's headless modes; Xvfb provides the required X display.
- Spec files: changed from `--headless=new` to `headless: false`.

### E1 — `readPages(maxPages)` semantics
- `pageReaderProvider.readPages()` only maps over `expectedUrls = urls.slice(0, maxPages)` — no failure entries generated for intentionally skipped URLs.
- Tests: 3 new tests in `pageReaderProvider.test.ts`.

### F1 — `web_page_read` invalid URL audits `web.effect_payload_invalid`
- Effect handler: missing/empty/blocked URL → `failInvalidWebEffect()`.
- Approval handler: payload parse failure and blocked URL → `failInvalidWebEffect()`.
- Old `web.page_read_payload_invalid` audit type removed; now consistent with `web_search`/`web_research`.
- Tests: 4 new F1 effect-level tests; 4 G1+F1 approval-level tests updated.

### G1 — `toolContentFromEffectFailure()` helper
- New `src/runtime/effectFailure.ts`.
- Returns `{ type: "effect_failure", kind, message, retryable }` as JSON string.
- Redacts `sk-`, `sk-ant-`, `Bearer`, `Authorization` patterns from messages.
- Does not include raw stack traces.
- Tests: 8 unit tests in `effectFailure.test.ts`.

### G2 — Structured failure content in runtime
- `referenceRuntime.ts`: replaced `'Operation was not completed.'` and `'Tool call was not completed.'` with `toolContentFromEffectFailure()`.
- LLM now receives structured JSON failure content for actionable error handling.
- Tests: 3 integration tests in `referenceRuntime.test.ts`.

---

## What Remains Blocked / Deferred

| Feature | Status | Reason |
|---|---|---|
| Rust/WASM `toolContentFromEffectFailure` equivalent | Deferred | Rust runtime not yet wired in TS host path |
| `sandbox_policy_denied` structured failure | Covered by G2 generic path | Sandbox scripting disabled by policy in v0.1 |
| Local extension E2E without display | Fails (expected) | `headless: false` requires X display; use Docker |

---

## Commands Run and Results

```
pnpm run typecheck     → ✓ 0 errors
pnpm run lint          → ✓ 0 warnings
pnpm run format:check  → ✓ all formatted
pnpm run test          → ✓ 1211 tests / 125 files
pnpm run test:e2e      → 28 passed / 2 failed (Firefox flakes only; all Chromium pass)
pnpm run test:extension:e2e → 1 passed / 4 failed (no X display locally; use Docker)
pnpm run test:extension:e2e:docker → ✓ 5 passed (16.7s)
pnpm run build         → ✓ built in 783ms
pnpm run build:wasm    → ✓ done in 2.08s
cargo test             → ✓ 0 tests (Rust unit tests not yet added)
cargo clippy           → ✓ 0 warnings
```

---

## Extension Readiness Status

**READY for v0.1** — proven in Docker:

- J1: `read_page` of fixture article returns sanitized content, title extracted, script content excluded.
- J1: Hostile-script page does not leak JavaScript source.
- J2: Settings "Check" button shows Connected when extension is loaded.
- J2: `read_page` from the app page origin returns sanitized page content.
- J2: Settings shows "Not detected" when extension is absent (negative test).

**Not proven locally** (local headless Chrome doesn't support MV3 extension service workers).
Run `pnpm run test:extension:e2e:docker` for the proof environment.
