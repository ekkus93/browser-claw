# BrowserClaw Workspace/Scripting/WebResearch FIX12 TODO

## Priority Key

```text
P0 = security/correctness blocker
P1 = required for feature completeness
P2 = polish, robustness, or future hardening
```

## Phase 0 — Scope Lock and Evidence Hygiene

- [ ] P0 Add `docs/BROWSERCLAW_WORKSPACE_SCRIPTING_WEBRESEARCH_FIX12_SPEC.md`.
- [ ] P0 Add this file as `docs/BROWSERCLAW_WORKSPACE_SCRIPTING_WEBRESEARCH_FIX12_TODO.md`.
- [ ] P0 Update `docs/WORKSPACE_SCRIPTING_WEBRESEARCH_DESIGN_NOTES.md` with a FIX12 section:
  - [ ] batch `readPages()` top-level extension `invalid_request` must map to `invalid_request`;
  - [ ] service-worker central schema and direct handler must both validate `web_search.maxResults`;
  - [ ] BrowserClaw-side protocol must cap `web_search.maxResults` at 20;
  - [ ] explicit test evidence must match actual tests;
  - [ ] gate evidence must distinguish pass/fail/cannot-run/not-attempted.
- [ ] P0 Update `memory.md` with:
  - [ ] real `date -u` timestamp;
  - [ ] model name;
  - [ ] concise summary of FIX12 scope.
- [ ] P0 Do not add broad new features in this pass.
- [ ] P0 Do not implement `site` or `format` support.
- [ ] P0 Do not check TODO boxes without evidence comments pointing to source/tests.
- [ ] P0 Correct any FIX11 TODO/review-note evidence comments that overclaim explicit tests.

---

# Part A — Batch `readPages()` Extension Error Mapping

## A1 — Map top-level extension `invalid_request` through `toError()`

### Problem

`pageReaderProvider.readPages()` currently handles top-level batch extension errors by hardcoding `internal_error`.

Bad pattern:

```ts
if (
  !isExtensionResponse(raw) ||
  !raw.ok ||
  !Array.isArray(raw['results'])
) {
  const errorMsg =
    isExtensionResponse(raw) && !raw.ok
      ? raw.error.message
      : 'invalid extension response';

  return expectedUrls.map((url) => ({
    ok: false,
    url,
    error: { kind: 'internal_error', message: errorMsg },
  }));
}
```

If the extension returns `invalid_request`, this incorrectly becomes `internal_error`.

### Required behavior

- [ ] P1 If response is not an extension response, return per-URL `internal_error`.
- [ ] P1 If response is an extension error response, use `toError(raw)`.
- [ ] P1 Extension `invalid_request` must become page-read `invalid_request`.
- [ ] P1 If response is successful but `results` is missing/not array, return per-URL `internal_error`.
- [ ] P1 Tests:
  - [ ] top-level batch extension `invalid_request` maps to `invalid_request` for every expected URL;
  - [ ] top-level batch extension `permission_denied` still maps to the expected provider error kind;
  - [ ] malformed batch extension response maps to `internal_error`;
  - [ ] successful response missing `results` maps to `internal_error`.

### Suggested code

```ts
if (!isExtensionResponse(raw)) {
  return expectedUrls.map((url) => ({
    ok: false as const,
    url,
    error: {
      kind: 'internal_error' as const,
      message: 'invalid extension response',
      retryable: false,
    },
  }));
}

if (!raw.ok) {
  const error = toError(raw);

  return expectedUrls.map((url) => ({
    ok: false as const,
    url,
    error,
  }));
}

if (!Array.isArray(raw['results'])) {
  return expectedUrls.map((url) => ({
    ok: false as const,
    url,
    error: {
      kind: 'internal_error' as const,
      message: 'invalid extension response',
      retryable: false,
    },
  }));
}
```

If the existing `toError()` does not include `retryable`, preserve the existing project error shape.

---

# Part B — Service-Worker Central `web_search.maxResults` Validation

## B1 — Validate `maxResults` in `validateMessageSchema()`

### Problem

`handleWebSearch()` validates `maxResults`, but the central schema validator does not. This breaks the central+direct validation pattern used elsewhere.

### Required behavior

- [ ] P2 In `validateMessageSchema()` / central message validation, validate optional `maxResults` for `web_search`.
- [ ] P2 Reject:
  - [ ] string;
  - [ ] zero;
  - [ ] negative;
  - [ ] non-integer;
  - [ ] above `SEARCH_MAX_RESULTS`.
- [ ] P2 Accept:
  - [ ] missing `maxResults`;
  - [ ] `maxResults: 1`;
  - [ ] `maxResults: SEARCH_MAX_RESULTS`.
- [ ] P2 Invalid central-schema validation returns `invalid_request`.
- [ ] P2 Tests:
  - [ ] central `web_search.maxResults: "5"` returns invalid;
  - [ ] central `web_search.maxResults: 0` returns invalid;
  - [ ] central `web_search.maxResults: -1` returns invalid;
  - [ ] central `web_search.maxResults: 1.5` returns invalid;
  - [ ] central `web_search.maxResults: 21` returns invalid;
  - [ ] central `web_search.maxResults: 20` accepted.

### Suggested code

In the `web_search` branch of `validateMessageSchema()`:

```js
const maxResultsError = validateOptionalMaxResults(message.maxResults);
if (maxResultsError) {
  return errorResponse('invalid_request', maxResultsError, message.requestId);
}
```

Use the existing `validateOptionalMaxResults()` helper from FIX11.

## B2 — Keep direct handler validation

- [ ] P2 `handleWebSearch()` must still validate `maxResults` directly.
- [ ] P2 Direct invalid `maxResults` returns `invalid_request`.
- [ ] P2 Direct invalid `maxResults` must not call fetch/search API.
- [ ] P2 Tests:
  - [ ] direct `handleWebSearch({ maxResults: -1 })` returns `invalid_request`;
  - [ ] direct `handleWebSearch({ maxResults: 0 })` returns `invalid_request`;
  - [ ] direct `handleWebSearch({ maxResults: 1.5 })` returns `invalid_request`;
  - [ ] direct `handleWebSearch({ maxResults: "5" })` returns `invalid_request`;
  - [ ] direct `handleWebSearch({ maxResults: 21 })` returns `invalid_request`;
  - [ ] direct `handleWebSearch({})` defaults to `DEFAULT_SEARCH_RESULTS`;
  - [ ] direct `handleWebSearch({ maxResults: 5 })` uses 5.

---

# Part C — BrowserClaw Protocol `web_search.maxResults` Cap Parity

## C1 — Reject above-cap `web_search.maxResults` in `src/extension/protocol.ts`

### Problem

`src/extension/protocol.ts` validates that `web_search.maxResults` is a positive integer, but may not reject values above 20.

The service worker rejects above-cap values, so protocol.ts and service-worker disagree.

### Required behavior

- [ ] P2 Update `parseExtensionRequest()` or equivalent protocol parser.
- [ ] P2 `web_search.maxResults` must be optional.
- [ ] P2 Missing `maxResults` is accepted.
- [ ] P2 Valid `1 <= maxResults <= 20` accepted.
- [ ] P2 Reject:
  - [ ] string;
  - [ ] zero;
  - [ ] negative;
  - [ ] non-integer;
  - [ ] above 20.
- [ ] P2 Tests:
  - [ ] `web_search.maxResults: "5"` rejected;
  - [ ] `web_search.maxResults: 0` rejected;
  - [ ] `web_search.maxResults: -1` rejected;
  - [ ] `web_search.maxResults: 1.5` rejected;
  - [ ] `web_search.maxResults: 21` rejected;
  - [ ] `web_search.maxResults: 20` accepted;
  - [ ] missing `web_search.maxResults` accepted.

### Suggested inline code

Follow the existing inline style in `protocol.ts`.

```ts
if (message.maxResults !== undefined) {
  if (
    typeof message.maxResults !== 'number' ||
    !Number.isFinite(message.maxResults) ||
    !Number.isInteger(message.maxResults) ||
    message.maxResults < 1 ||
    message.maxResults > 20
  ) {
    return {
      ok: false,
      reason:
        'web_search maxResults must be a positive integer no greater than 20.',
    };
  }
}
```

If the file already has a search max constant, use it. If not, add a local constant:

```ts
const SEARCH_MAX_RESULTS = 20;
```

Keep it private to `protocol.ts`.

---

# Part D — Explicit Test Evidence Cleanup

## D1 — Add explicit protocol tests for `read_page.maxChars`

### Problem

FIX11 TODO evidence claimed explicit tests for some cases that were only covered by implementation guards.

### Required behavior

- [ ] P2 Add explicit tests for:
  - [ ] `read_page.maxChars: "1000"` rejected;
  - [ ] `read_page.maxChars: 0` rejected;
  - [ ] `read_page.maxChars: -1` rejected;
  - [ ] `read_page.maxChars: 1.5` rejected;
  - [ ] `read_page.maxChars: 50001` rejected;
  - [ ] `read_page.maxChars: 50000` accepted;
  - [ ] missing `read_page.maxChars` accepted.
- [ ] P2 Update TODO/review-note evidence comments to cite the explicit tests.

## D2 — Add explicit protocol tests for `read_pages.maxChars`

- [ ] P2 Add explicit tests for:
  - [ ] `read_pages.maxChars: "1000"` rejected;
  - [ ] `read_pages.maxChars: 0` rejected;
  - [ ] `read_pages.maxChars: -1` rejected;
  - [ ] `read_pages.maxChars: 1.5` rejected;
  - [ ] `read_pages.maxChars: 50001` rejected;
  - [ ] `read_pages.maxChars: 50000` accepted;
  - [ ] missing `read_pages.maxChars` accepted.
- [ ] P2 Update TODO/review-note evidence comments to cite the explicit tests.

## D3 — Add explicit service-worker central-schema tests for `web_search.maxResults`

- [ ] P2 Add explicit tests for central/schema validation:
  - [ ] `maxResults: "5"` rejected;
  - [ ] `maxResults: 0` rejected;
  - [ ] `maxResults: -1` rejected;
  - [ ] `maxResults: 1.5` rejected;
  - [ ] `maxResults: 21` rejected;
  - [ ] `maxResults: 20` accepted;
  - [ ] missing `maxResults` accepted.
- [ ] P2 Update evidence comments to distinguish:
  - [ ] central-schema validation tests;
  - [ ] direct-handler validation tests.

## D4 — Correct overclaimed evidence instead of papering over

- [ ] P2 Search FIX11/FIX12 TODO and review notes for evidence comments that say “test exists” when only implementation coverage exists.
- [ ] P2 Either:
  - [ ] add the missing explicit test; or
  - [ ] change the evidence comment to say “covered by implementation guard, not an explicit test.”
- [ ] P2 Prefer adding explicit tests for validation cases.

---

# Part E — Gate Evidence Cleanup

## E1 — Update review notes

- [ ] P1 Update or create `docs/WORKSPACE_SCRIPTING_WEBRESEARCH_FIX12_REVIEW_NOTES.md`.
- [ ] P1 Include:
  - [ ] batch `readPages()` extension error mapping;
  - [ ] service-worker central `web_search.maxResults` validation;
  - [ ] protocol `web_search.maxResults` cap parity;
  - [ ] explicit test evidence cleanup;
  - [ ] exact gate command results;
  - [ ] exact extension E2E status.

## E2 — Required commands

Run and record actual results:

```bash
pnpm run typecheck
pnpm run lint
pnpm run format:check
pnpm run test
pnpm run test:e2e
pnpm run test:extension:e2e
pnpm run test:extension:e2e:docker
pnpm run build
pnpm run build:wasm
cargo test
cargo clippy
```

- [ ] P0 Record command results in TODO evidence comments.
- [ ] P0 If a command cannot run, record:
  - [ ] exact command;
  - [ ] exact error;
  - [ ] environment reason;
  - [ ] whether it blocks all acceptance or only scoped feature acceptance;
  - [ ] follow-up task.
- [ ] P0 Do not mark failed/cannot-run commands as passed.
- [ ] P0 Do not write “not needed” for `pnpm run build` merely because there were no codegen changes.
- [ ] P1 If Docker extension E2E cannot run, leave its task unchecked or explicitly mark it cannot-run. Do not imply it passed.

### Acceptable examples

If build runs:

```md
- [x] P1 `pnpm run build` — PASS.
```

If build cannot run:

```md
- [ ] P1 `pnpm run build` — CANNOT RUN: `pnpm` unavailable in this environment. Blocks full local acceptance; type/lint/unit tests from CI required.
```

If cargo is irrelevant because no Rust workspace exists:

```md
- [ ] P1 `cargo test` — NOT APPLICABLE: no Cargo workspace in this repo. Verified by `find . -name Cargo.toml`.
```

If cargo exists but was skipped:

```md
- [ ] P1 `cargo test` — NOT RUN. Reason: <exact reason>. This is not accepted as passed.
```

## E3 — Final acceptance checklist

FIX12 is complete only when:

- [ ] `pageReaderProvider.readPages()` maps top-level extension `invalid_request` to `invalid_request`.
- [ ] malformed batch extension responses still map to `internal_error`.
- [ ] service-worker central schema validates `web_search.maxResults`.
- [ ] service-worker direct handler still validates `web_search.maxResults`.
- [ ] `src/extension/protocol.ts` rejects `web_search.maxResults > 20`.
- [ ] protocol and service-worker agree on `maxResults` / `maxChars` limits.
- [ ] explicit tests exist for all previously overclaimed `maxChars` and `maxResults` cases.
- [ ] TODO/review-note evidence accurately identifies tests and cannot-run commands.
- [ ] gate evidence is honest.
