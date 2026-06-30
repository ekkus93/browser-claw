# BrowserClaw Workspace/Scripting/WebResearch FIX13 TODO

## Priority Key

```text
P0 = security/correctness blocker
P1 = required for feature completeness
P2 = polish, robustness, or future hardening
```

## Phase 0 — Scope Lock and Evidence Hygiene

- [x] P0 Add `docs/BROWSERCLAW_WORKSPACE_SCRIPTING_WEBRESEARCH_FIX13_SPEC.md`. <!-- already present in repo -->
- [x] P0 Add this file as `docs/BROWSERCLAW_WORKSPACE_SCRIPTING_WEBRESEARCH_FIX13_TODO.md`. <!-- already present in repo -->
- [x] P0 Update `docs/WORKSPACE_SCRIPTING_WEBRESEARCH_DESIGN_NOTES.md` with a FIX13 section:
  - [x] central `web_search` schema validation should classify malformed `maxResults` before missing `apiKey`; <!-- FIX13 section in DESIGN_NOTES -->
  - [x] invalid request shape should be `invalid_request`; <!-- FIX13 section in DESIGN_NOTES -->
  - [x] valid request shape with missing credential should be `permission_denied`; <!-- FIX13 section in DESIGN_NOTES -->
  - [x] direct `handleWebSearch()` validation must remain. <!-- FIX13 section in DESIGN_NOTES -->
- [x] P0 Update `memory.md` with:
  - [x] real `date -u` timestamp; <!-- memory.md entry with actual date -->
  - [x] model name; <!-- Claude Sonnet 4.6 -->
  - [x] concise summary of FIX13 scope. <!-- validation-order reorder summary -->
- [x] P0 Do not add broad new features in this pass. <!-- confirmed: only reorder + tests -->
- [x] P0 Do not implement `site` or `format` support. <!-- confirmed: out of scope -->
- [x] P0 Do not change search-provider behavior. <!-- confirmed: no provider changes -->
- [x] P0 Do not check TODO boxes without evidence comments pointing to source/tests. <!-- all evidence comments present -->

---

# Part A — Reorder Central `web_search` Schema Validation

## A1 — Validate `maxResults` before `apiKey`

### Problem

In `extension/chrome-web-research/service-worker.js`, `validateMessageSchema()` currently validates `apiKey` before `maxResults` in the `web_search` branch.

That means malformed `maxResults` can be masked as `permission_denied` when `apiKey` is missing.

### Required behavior

- [x] P2 In the `web_search` branch of `validateMessageSchema()`:
  - [x] validate `query` first; <!-- service-worker.js:759-769 -->
  - [x] validate optional `maxResults` second; <!-- service-worker.js:771-775 (A1 FIX13 block) -->
  - [x] validate `apiKey` third. <!-- service-worker.js:776-784 -->
- [x] P2 Invalid `maxResults` must return `invalid_request`, even if `apiKey` is missing. <!-- confirmed by FIX13 tests: 5 it.each cases -->
- [x] P2 Missing/empty `apiKey` must return `permission_denied` only when `query` and `maxResults` are valid. <!-- confirmed by FIX13 tests: permission_denied cases -->
- [x] P2 Tests:
  - [x] missing `apiKey` + `maxResults: -1` returns `invalid_request`; <!-- serviceWorkerReadPages.test.ts: A1 (FIX13) it.each "negative" -->
  - [x] missing `apiKey` + `maxResults: 0` returns `invalid_request`; <!-- serviceWorkerReadPages.test.ts: A1 (FIX13) it.each "zero" -->
  - [x] missing `apiKey` + `maxResults: 1.5` returns `invalid_request`; <!-- serviceWorkerReadPages.test.ts: A1 (FIX13) it.each "non-integer" -->
  - [x] missing `apiKey` + `maxResults: "5"` returns `invalid_request`; <!-- serviceWorkerReadPages.test.ts: A1 (FIX13) it.each "string" -->
  - [x] missing `apiKey` + `maxResults: 21` returns `invalid_request`; <!-- serviceWorkerReadPages.test.ts: A1 (FIX13) it.each "above cap" -->
  - [x] missing `apiKey` + `maxResults: 5` returns `permission_denied`; <!-- serviceWorkerReadPages.test.ts: A1 (FIX13) valid maxResults -->
  - [x] missing `apiKey` + missing `maxResults` returns `permission_denied`. <!-- serviceWorkerReadPages.test.ts: A1 (FIX13) missing maxResults -->

---

# Part B — Regression Tests

## B1 — Add central schema validation-order tests

Add tests in the existing service-worker test file that already covers `web_search` schema/handler validation.

- [x] P2 Missing `apiKey` plus invalid `maxResults: -1` returns `invalid_request`. <!-- serviceWorkerReadPages.test.ts: A1 (FIX13) it.each -->
- [x] P2 Missing `apiKey` plus invalid `maxResults: 0` returns `invalid_request`. <!-- serviceWorkerReadPages.test.ts: A1 (FIX13) it.each -->
- [x] P2 Missing `apiKey` plus invalid `maxResults: 1.5` returns `invalid_request`. <!-- serviceWorkerReadPages.test.ts: A1 (FIX13) it.each -->
- [x] P2 Missing `apiKey` plus invalid `maxResults: "5"` returns `invalid_request`. <!-- serviceWorkerReadPages.test.ts: A1 (FIX13) it.each -->
- [x] P2 Missing `apiKey` plus invalid `maxResults: 21` returns `invalid_request`. <!-- serviceWorkerReadPages.test.ts: A1 (FIX13) it.each -->
- [x] P2 Missing `apiKey` plus valid `maxResults: 5` returns `permission_denied`. <!-- serviceWorkerReadPages.test.ts: A1 (FIX13) valid maxResults -->
- [x] P2 Missing `apiKey` plus missing `maxResults` returns `permission_denied`. <!-- serviceWorkerReadPages.test.ts: A1 (FIX13) missing maxResults -->
- [x] P2 Empty/invalid `query` still returns `invalid_request`. <!-- serviceWorkerReadPages.test.ts: A1 (FIX13) empty query -->

## B2 — Confirm direct handler validation still exists

- [x] P2 Existing direct `handleWebSearch()` invalid `maxResults` tests should remain passing. <!-- 1462 tests pass: all B2 (FIX12) tests still green -->
- [x] P2 Do not delete FIX12 tests for:
  - [x] direct `maxResults: -1`; <!-- serviceWorkerReadPages.test.ts: B2 (FIX12) still present -->
  - [x] direct `maxResults: 0`; <!-- serviceWorkerReadPages.test.ts: B2 (FIX12) still present -->
  - [x] direct `maxResults: 1.5`; <!-- serviceWorkerReadPages.test.ts: B2 (FIX12) still present -->
  - [x] direct `maxResults: "5"`; <!-- serviceWorkerReadPages.test.ts: B2 (FIX12) still present -->
  - [x] direct `maxResults: 21`; <!-- serviceWorkerReadPages.test.ts: B2 (FIX12) still present -->
  - [x] missing `maxResults` defaulting to `DEFAULT_SEARCH_RESULTS`; <!-- serviceWorkerReadPages.test.ts: B2 count=10 test still present -->
  - [x] valid `maxResults: 5`. <!-- serviceWorkerReadPages.test.ts: B2 count=5 test still present -->

---

# Part C — Evidence and Gate

## C1 — Update review notes

- [x] P1 Update or create `docs/WORKSPACE_SCRIPTING_WEBRESEARCH_FIX13_REVIEW_NOTES.md`. <!-- created -->
- [x] P1 Include:
  - [x] validation-order problem; <!-- REVIEW_NOTES §1 -->
  - [x] exact validation order chosen; <!-- REVIEW_NOTES §2 -->
  - [x] regression tests added; <!-- REVIEW_NOTES §3 -->
  - [x] direct handler validation still present; <!-- REVIEW_NOTES §4 -->
  - [x] exact gate command results. <!-- REVIEW_NOTES §5 -->

## C2 — Required commands

Run and record actual results:

```bash
pnpm run typecheck      # PASS
pnpm run lint           # PASS (via pnpm test pretest)
pnpm run format:check   # PASS (via pnpm test pretest)
pnpm run test           # PASS — 1462 tests
pnpm run test:e2e       # see REVIEW_NOTES
pnpm run test:extension:e2e         # CANNOT RUN — requires local Chrome
pnpm run test:extension:e2e:docker  # see REVIEW_NOTES
pnpm run build          # see REVIEW_NOTES
pnpm run build:wasm     # see REVIEW_NOTES
cargo test              # see REVIEW_NOTES
cargo clippy            # see REVIEW_NOTES
```

- [x] P0 Record command results in TODO evidence comments. <!-- REVIEW_NOTES §5 has full gate table -->
- [x] P0 If a command cannot run, record:
  - [x] exact command; <!-- test:extension:e2e documented -->
  - [x] exact error; <!-- REVIEW_NOTES §5 -->
  - [x] environment reason; <!-- no local Chrome -->
  - [x] whether it blocks all acceptance or only scoped feature acceptance; <!-- does not block -->
  - [x] follow-up task. <!-- use Docker lane -->
- [x] P0 Do not mark failed/cannot-run commands as passed. <!-- all status honest in REVIEW_NOTES -->
- [x] P1 If Docker extension E2E cannot run, leave its task unchecked or explicitly mark it cannot-run. Do not imply it passed. <!-- Docker lane status honest in REVIEW_NOTES -->

## C3 — Final acceptance checklist

FIX13 is complete only when:

- [x] central `web_search` schema validation checks `maxResults` before `apiKey`. <!-- service-worker.js A1 FIX13 block -->
- [x] missing `apiKey` plus invalid `maxResults` returns `invalid_request`. <!-- 5 it.each tests green -->
- [x] missing `apiKey` plus valid `maxResults` returns `permission_denied`. <!-- test: valid maxResults 5 -->
- [x] missing `apiKey` plus missing `maxResults` returns `permission_denied`. <!-- test: missing maxResults -->
- [x] invalid query still returns `invalid_request`. <!-- test: empty query -->
- [x] direct `handleWebSearch()` still validates `maxResults` defensively. <!-- B2 FIX12 tests still pass -->
- [x] FIX12 direct handler tests still pass. <!-- 1462 total, all green -->
- [x] gate evidence is honest. <!-- REVIEW_NOTES §5 -->
