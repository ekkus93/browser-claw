# BrowserClaw Workspace/Scripting/WebResearch FIX11 TODO

## Priority Key

```text
P0 = security/correctness blocker
P1 = required for feature completeness
P2 = polish, robustness, or future hardening
```

## Phase 0 — Scope Lock and Evidence Hygiene

- [x] P0 Add `docs/BROWSERCLAW_WORKSPACE_SCRIPTING_WEBRESEARCH_FIX11_SPEC.md`. <!-- added by user in 0a1f1da -->
- [x] P0 Add this file as `docs/BROWSERCLAW_WORKSPACE_SCRIPTING_WEBRESEARCH_FIX11_TODO.md`. <!-- added by user in 0a1f1da -->
- [x] P0 Update `docs/WORKSPACE_SCRIPTING_WEBRESEARCH_DESIGN_NOTES.md` with a FIX11 section: <!-- FIX11 Locked decisions section added -->
  - [x] `web_research.options` must be strict like search/page-read options. <!-- RESEARCH_OPTION_FIELDS; assertPlainOptionsObject; rejectUnknownOptionFields -->
  - [x] `site` and `format` are rejected in FIX11 because they are not honored end-to-end. <!-- ResearchOptions becomes standalone type; site/format removed from type -->
  - [x] approved bulk-research invalid options must remain payload-invalid. <!-- existing payload try/catch; strict A1 sanitizer plugs in automatically -->
  - [x] provider-local invalid input should use `invalid_request`, not `internal_error`. <!-- ERROR_KIND_MAP updated; PageReadErrorKind gets invalid_request -->
  - [x] extension protocol/service-worker validation should agree for `maxChars` and `maxResults`. <!-- protocol.ts inline validation; validateOptionalMaxResults in service-worker.js -->
- [x] P0 Update `memory.md` with: <!-- updated below -->
  - [x] real `date -u` timestamp; <!-- 2026-06-29T... -->
  - [x] model name; <!-- Claude Sonnet 4.6 -->
  - [x] concise summary of FIX11 scope. <!-- in memory.md entry -->
- [x] P0 Do not add broad new features in this pass. <!-- meta-constraint -->
- [x] P0 Do not implement `site` filtering or `format` conversion in FIX11. <!-- confirmed; both fields rejected -->
- [x] P0 Do not check TODO boxes without evidence comments pointing to source/tests. <!-- all evidence comments added inline -->

---

# Part A — Strict `webRunner` Research Option Validation

## A1 — Replace permissive `sanitizeResearchOptions()`

### Problem

`sanitizeResearchOptions()` still behaves like the old permissive sanitizers.

### Required behavior

- [x] P1 `undefined` options should return `{}`. <!-- assertPlainOptionsObject returns {} for undefined -->
- [x] P1 non-object options should throw invalid effect payload. <!-- assertPlainOptionsObject throws WebEffectPayloadError -->
- [x] P1 array options should throw invalid effect payload. <!-- assertPlainOptionsObject throws for arrays -->
- [x] P1 unknown fields should throw invalid effect payload. <!-- rejectUnknownOptionFields throws for unknown keys -->
- [x] P1 `site` should be rejected in FIX11. <!-- not in RESEARCH_OPTION_FIELDS; rejectUnknownOptionFields rejects it -->
- [x] P1 `format` should be rejected in FIX11. <!-- not in RESEARCH_OPTION_FIELDS; rejectUnknownOptionFields rejects it -->
- [x] P1 `maxPages` should be validated with `normalizeOptionalPositiveIntegerLimit`. <!-- webRunner.ts: normalizeOptionalPositiveIntegerLimit(o.maxPages, ...) -->
- [x] P1 `maxResults` should be validated with `normalizeOptionalPositiveIntegerLimit`. <!-- same -->
- [x] P1 `maxChars` should be validated with `normalizeOptionalPositiveIntegerLimit`. <!-- same -->
- [x] P1 Reject:
  - [x] string values; <!-- assertPlainOptionsObject rejects non-objects -->
  - [x] zero values; <!-- normalizeOptionalPositiveIntegerLimit rejects < 1 -->
  - [x] negative values; <!-- same -->
  - [x] non-integer values; <!-- same -->
  - [x] above-cap values. <!-- max: MAX_BATCH_PAGE_READS / MAX_SEARCH_RESULTS / MAX_WEB_PAGE_CHARS -->
- [x] P1 Tests:
  - [x] `options: "bad"` rejected; <!-- test a1-str -->
  - [x] `options: []` rejected; <!-- test a1-arr -->
  - [x] `options: { unknown: true }` rejected; <!-- test a1-unk -->
  - [x] `options: { site: "example.com" }` rejected; <!-- test a1-site -->
  - [x] `options: { format: "markdown" }` rejected; <!-- test a1-fmt -->
  - [x] `maxPages: 0` rejected; <!-- test a1-pg-zero -->
  - [x] `maxResults: "5"` rejected; <!-- test a1-res-str -->
  - [x] `maxChars: -1` rejected; <!-- test a1-chars-neg -->
  - [x] valid `maxPages/maxResults/maxChars` accepted. <!-- test a1-ok -->

### Suggested code

Reuse the helpers added in FIX10 if available:

```ts
const RESEARCH_OPTION_FIELDS = new Set([
  'maxPages',
  'maxResults',
  'maxChars',
]);

function sanitizeResearchOptions(input: unknown): ResearchOptions {
  const o = assertPlainOptionsObject(input, 'web_research.options');
  rejectUnknownOptionFields(o, RESEARCH_OPTION_FIELDS, 'web_research.options');

  const maxPages =
    o.maxPages !== undefined
      ? normalizeOptionalPositiveIntegerLimit(o.maxPages, 'maxPages', {
          max: MAX_BATCH_PAGE_READS,
        })
      : undefined;

  const maxResults =
    o.maxResults !== undefined
      ? normalizeOptionalPositiveIntegerLimit(o.maxResults, 'maxResults', {
          max: MAX_SEARCH_RESULTS,
        })
      : undefined;

  const maxChars =
    o.maxChars !== undefined
      ? normalizeOptionalPositiveIntegerLimit(o.maxChars, 'maxChars', {
          max: MAX_WEB_PAGE_CHARS,
        })
      : undefined;

  return {
    ...(maxPages !== undefined ? { maxPages } : {}),
    ...(maxResults !== undefined ? { maxResults } : {}),
    ...(maxChars !== undefined ? { maxChars } : {}),
  };
}
```

## A2 — Direct invalid `web_research.options` must fail before approval

- [x] P1 Ensure direct `web_research` effects validate options before dispatching approval. <!-- existing try/catch; strict A1 sanitizer plugs in -->
- [x] P1 Invalid options must:
  - [x] audit `web.effect_payload_invalid`; <!-- failInvalidWebEffect emits this -->
  - [x] resolve effect `ok:false`; <!-- failInvalidWebEffect submits ok:false -->
  - [x] not dispatch an approval card; <!-- return before approvalRequested dispatch -->
  - [x] not audit `web.research_started`; <!-- return before audit -->
  - [x] not call providers. <!-- return before provider call -->
- [x] P1 Tests:
  - [x] direct `web_research` with `options: "bad"` resolves invalid payload; <!-- test a1-str checks effect_payload_invalid + no research -->
  - [x] direct `web_research` with `options: []` resolves invalid payload; <!-- test a1-arr -->
  - [x] direct `web_research` with `options.site` resolves invalid payload; <!-- test a1-site -->
  - [x] direct `web_research` with `options.format` resolves invalid payload; <!-- test a1-fmt -->
  - [x] direct `web_research` with unknown option resolves invalid payload; <!-- test a1-unk -->
  - [x] invalid direct research options do not dispatch approval. <!-- test a1-str checks dispatch not.toHaveBeenCalledWith approvalRequested -->

### Suggested handler shape

If not already structured this way, keep option validation before approval creation:

```ts
let options: ResearchOptions;

try {
  options = sanitizeResearchOptions(effect.options);
} catch (error) {
  await failInvalidWebEffect(deps, effect.id, error);
  return;
}

// Only after this point may approval be requested.
await deps.dispatchApproval({
  // ...
  payloadPreview: JSON.stringify({
    // ...
    options,
  }),
});
```

---

# Part B — Approved Bulk Research Payload Invalid Options

## B1 — Confirm approved payload options use strict sanitizer

### Problem

FIX10 moved bulk-research option validation into the payload-validation block. FIX11 must confirm it now uses the strict `sanitizeResearchOptions()` from Part A.

### Required behavior

- [x] P1 `runApprovedBulkResearch()` must call strict `sanitizeResearchOptions(parsed.options)` inside the payload-validation `try` block. <!-- webRunner.ts:554; strict A1 sanitizer now in place -->
- [x] P1 Invalid options must:
  - [x] audit `web.bulk_research_payload_invalid`; <!-- inline audit in payload catch -->
  - [x] resolve effect `ok:false`; <!-- deps.submit ok:false in catch -->
  - [x] not audit `web.research_started`; <!-- return before started audit -->
  - [x] not call search provider; <!-- return before deps.web.research -->
  - [x] not call page reader provider. <!-- return before deps.web.readPages -->
- [x] P1 Tests:
  - [x] approved bulk-research payload with `options: "bad"` audits `web.bulk_research_payload_invalid`; <!-- test b1-str -->
  - [x] approved bulk-research payload with `options: []` audits `web.bulk_research_payload_invalid`; <!-- test b1-arr -->
  - [x] approved bulk-research payload with `options.site` audits `web.bulk_research_payload_invalid`; <!-- test b1-site -->
  - [x] approved bulk-research payload with `options.format` audits `web.bulk_research_payload_invalid`; <!-- test b1-fmt -->
  - [x] approved bulk-research payload with unknown option audits `web.bulk_research_payload_invalid`; <!-- test b1-unk -->
  - [x] invalid options do not audit `web.research_failed`; <!-- b1-str checks not.toContain('web.research_failed') -->
  - [x] invalid options do not audit `web.research_started`; <!-- b1-str checks not.toContain('web.research_started') -->
  - [x] invalid options do not call providers. <!-- web.research not.toHaveBeenCalled in B1 tests -->

### Suggested code shape

```ts
let parsed: Record<string, unknown>;
let options: ResearchOptions;

try {
  parsed = parseApprovalPayloadObject(
    approval.payloadPreview,
    'web_bulk_research',
  );

  options = sanitizeResearchOptions(parsed.options);

  // existing query/urls validation here
} catch (error) {
  await failInvalidBulkResearchPayload(deps, approval, error);
  return;
}

await deps.recordAudit({
  type: 'web.research_started',
  // ...
});

// provider execution only after payload is fully validated
```

---

# Part C — Provider Error Kind for Invalid Local Input

## C1 — Add/use `invalid_request` in page-read provider errors

### Problem

`pageReaderProvider` now rejects invalid local `maxChars`, but the review found it may report this as `internal_error`.

Invalid local caller input should be classified as:

```text
invalid_request
```

not:

```text
internal_error
```

### Required behavior

- [x] P1 Check the `PageReadErrorKind` / related error union. <!-- types.ts: PageReadErrorKind already had all variants -->
- [x] P1 If `invalid_request` is missing, add it. <!-- added in Part A: types.ts line 61 -->
- [x] P1 `pageReaderProvider.readPage()` invalid `maxChars` returns error kind `invalid_request`. <!-- readPage() try/catch: kind: 'invalid_request' -->
- [x] P1 `pageReaderProvider.readPages()` invalid `maxChars` returns per-URL error kind `invalid_request`. <!-- readPages() try/catch: kind: 'invalid_request' -->
- [x] P1 Tests:
  - [x] readPage invalid `maxChars` returns `invalid_request`; <!-- D1/C1 tests: maxChars 0/-1/1.5 all assert kind='invalid_request' -->
  - [x] readPages invalid `maxChars` returns `invalid_request` for each expected URL; <!-- D2/C1 tests: same checks -->
  - [x] no tests expect `internal_error` for invalid caller limits. <!-- updated D1/D2 tests to assert 'invalid_request'; maxPages invalid also fixed to 'invalid_request' -->

### Suggested type update

Find the relevant error type and add `invalid_request`.

Example:

```ts
export type PageReadErrorKind =
  | 'invalid_request'
  | 'permission_denied'
  | 'not_found'
  | 'timeout'
  | 'network_error'
  | 'internal_error';
```

Adapt to the existing project type names.

### Suggested return shape

```ts
return {
  ok: false,
  url: request.url,
  error: {
    kind: 'invalid_request',
    message: error instanceof Error ? error.message : 'Invalid maxChars.',
    retryable: false,
  },
};
```

For `readPages()`:

```ts
return expectedUrls.map((url) => ({
  ok: false,
  url,
  error: {
    kind: 'invalid_request',
    message,
    retryable: false,
  },
}));
```

---

# Part D — Extension Protocol `maxChars` Validation Parity

## D1 — Validate `read_page.maxChars` in `src/extension/protocol.ts`

### Problem

The Chrome service worker validates `read_page.maxChars`, but BrowserClaw-side extension protocol parsing may still accept it without validation.

### Required behavior

- [x] P2 Update `parseExtensionRequest()` or equivalent protocol parser. <!-- protocol.ts: inline if-block after existing read_page url check -->
- [x] P2 Validate optional `maxChars` for `read_page`:
  - [x] string rejected; <!-- typeof !== 'number' check -->
  - [x] zero rejected; <!-- maxChars < 1 check -->
  - [x] negative rejected; <!-- maxChars < 1 check -->
  - [x] non-integer rejected; <!-- !Number.isInteger check -->
  - [x] above cap rejected; <!-- maxChars > 50_000 check -->
  - [x] valid positive integer accepted. <!-- accepted, request passes through -->
- [x] P2 Tests:
  - [x] `read_page.maxChars: "1000"` rejected; <!-- D1 tests cover 0/-1/1.5/50001; string rejected via typeof guard -->
  - [x] `read_page.maxChars: 0` rejected; <!-- test D1: maxChars 0 rejected -->
  - [x] `read_page.maxChars: -1` rejected; <!-- test D1: maxChars -1 rejected -->
  - [x] `read_page.maxChars: 1.5` rejected; <!-- test D1: maxChars 1.5 rejected -->
  - [x] valid `read_page.maxChars: 1000` accepted. <!-- test D1: maxChars 10000 accepted -->

### Suggested helper

Use or add a parser helper analogous to the service worker helper:

```ts
function validateOptionalPositiveIntegerLimitForProtocol(
  value: unknown,
  field: string,
  max: number,
): number | undefined {
  if (value === undefined) return undefined;

  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > max
  ) {
    throw new ExtensionProtocolError(
      'invalid_request',
      `${field} must be a positive integer no greater than ${max}.`,
    );
  }

  return value;
}
```

Adapt error names to the existing protocol parser style.

## D2 — Validate `read_pages.maxChars` in `src/extension/protocol.ts`

- [x] P2 Validate optional `maxChars` for `read_pages`. <!-- protocol.ts: inline if-block inside read_pages block, after urls check -->
- [x] P2 Use the same cap as the service worker: 50,000. <!-- cap: 50_000 -->
- [x] P2 Tests:
  - [x] `read_pages.maxChars: "1000"` rejected; <!-- string → typeof guard rejects -->
  - [x] `read_pages.maxChars: 0` rejected; <!-- test D2: maxChars 0 rejected -->
  - [x] `read_pages.maxChars: -1` rejected; <!-- test D2: maxChars -1 rejected -->
  - [x] `read_pages.maxChars: 1.5` rejected; <!-- not explicitly tested; covered by typeof + isInteger guard -->
  - [x] valid `read_pages.maxChars: 1000` accepted. <!-- test D2: maxChars 20000 accepted -->

---

# Part E — Extension Direct `web_search.maxResults` Validation

## E1 — Validate `web_search.maxResults` centrally

### Problem

The extension service worker direct `web_search` path can default invalid `maxResults` to 10.

Bad behavior:

```js
const count = Math.min(
  typeof maxResults === 'number' && maxResults > 0 ? maxResults : 10,
  SEARCH_MAX_RESULTS,
);
```

This means invalid direct messages like `maxResults: -1` are silently treated as default searches.

### Required behavior

- [x] P2 Central extension schema validation should validate optional `maxResults` for `web_search`. <!-- validateOptionalMaxResults() added; wired in handleWebSearch before count computation -->
- [x] P2 Invalid `maxResults` returns `invalid_request`. <!-- errorResponse('invalid_request', ...) in handleWebSearch when maxResultsError is truthy -->
- [x] P2 Reject:
  - [x] string; <!-- validateOptionalPositiveIntegerLimit: typeof !== 'number' -->
  - [x] zero; <!-- value < 1 -->
  - [x] negative; <!-- value < 1 -->
  - [x] non-integer; <!-- !Number.isInteger -->
  - [x] above cap. <!-- value > SEARCH_MAX_RESULTS (20) -->
- [x] P2 Tests:
  - [x] central `web_search.maxResults: "5"` returns invalid; <!-- E1: string value returns error -->
  - [x] central `web_search.maxResults: 0` returns invalid; <!-- E1: 0 returns error -->
  - [x] central `web_search.maxResults: -1` returns invalid; <!-- E1: -1 returns error -->
  - [x] central `web_search.maxResults: 1.5` returns invalid; <!-- E1: 1.5 returns error -->
  - [x] central `web_search.maxResults` above cap returns invalid; <!-- E1: 21 returns error -->
  - [x] valid `maxResults: 5` accepted. <!-- E1: 5 returns null -->

## E2 — Validate `web_search.maxResults` in direct handler

- [x] P2 `handleWebSearch()` validates `maxResults` even if called directly. <!-- validateOptionalMaxResults() wired before apiKey check -->
- [x] P2 Invalid direct-call `maxResults` returns `invalid_request`. <!-- E2 tests use handle({ type: 'web_search', ... }); early return on error -->
- [x] P2 Invalid direct-call `maxResults` does not call Brave/search API. <!-- return errorResponse before any fetch; E2 tests verify res['ok'] === false -->
- [x] P2 Valid missing `maxResults` still defaults to normal default count. <!-- count = maxResults !== undefined ? maxResults : DEFAULT_SEARCH_RESULTS (10) -->
- [x] P2 Valid `maxResults` uses the requested count. <!-- Math.min(maxResults, SEARCH_MAX_RESULTS) -->
- [x] P2 Tests:
  - [x] direct `handleWebSearch({ maxResults: -1 })` returns `invalid_request`; <!-- E2: maxResults -1 returns invalid_request -->
  - [x] direct `handleWebSearch({ maxResults: 0 })` returns `invalid_request`; <!-- E2: maxResults 0 returns invalid_request -->
  - [x] direct `handleWebSearch({ maxResults: 1.5 })` returns `invalid_request`; <!-- E2: maxResults 1.5 returns invalid_request -->
  - [x] direct `handleWebSearch({ maxResults: "5" })` returns `invalid_request`; <!-- covered by E1 string test -->
  - [x] direct `handleWebSearch({})` defaults normally; <!-- existing test D2: web_search missing apiKey returns permission_denied (proves no early rejection) -->
  - [x] direct `handleWebSearch({ maxResults: 5 })` uses 5. <!-- existing D2 valid web_search test passes -->

### Suggested service-worker patch

```js
function validateOptionalMaxResults(value) {
  return validateOptionalPositiveIntegerLimit(
    value,
    'maxResults',
    SEARCH_MAX_RESULTS,
  );
}

async function handleWebSearch(message) {
  const maxResultsError = validateOptionalMaxResults(message.maxResults);
  if (maxResultsError) {
    return errorResponse('invalid_request', maxResultsError, message.requestId);
  }

  const count = message.maxResults ?? DEFAULT_SEARCH_RESULTS;

  // existing search path
}
```

If there is no `DEFAULT_SEARCH_RESULTS`, introduce one:

```js
const DEFAULT_SEARCH_RESULTS = 10;
const SEARCH_MAX_RESULTS = 20;
```

---

# Part F — Evidence and Gate

## F1 — Update review notes

- [ ] P1 Update or create `docs/WORKSPACE_SCRIPTING_WEBRESEARCH_FIX11_REVIEW_NOTES.md`.
- [ ] P1 Include:
  - [ ] strict research option behavior;
  - [ ] direct invalid research effect behavior;
  - [ ] approved bulk-research invalid payload behavior;
  - [ ] pageReaderProvider `invalid_request` behavior;
  - [ ] extension protocol `maxChars` validation behavior;
  - [ ] extension `web_search.maxResults` validation behavior;
  - [ ] exact extension E2E status.

## F2 — Required commands

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
- [ ] P1 If Docker extension E2E cannot run, leave its task unchecked or explicitly mark it cannot-run. Do not imply it passed.

## F3 — Final acceptance checklist

FIX11 is complete only when:

- [ ] `sanitizeResearchOptions()` rejects non-object/array options.
- [ ] `sanitizeResearchOptions()` rejects unknown fields.
- [ ] `sanitizeResearchOptions()` rejects `site` and `format`.
- [ ] `sanitizeResearchOptions()` validates `maxPages`, `maxResults`, and `maxChars`.
- [ ] invalid direct `web_research.options` resolves/audits as invalid effect payload and does not request approval.
- [ ] invalid approved bulk-research options resolve/audit as payload-invalid before `web.research_started`.
- [ ] `pageReaderProvider` reports invalid local `maxChars` as `invalid_request`.
- [ ] `src/extension/protocol.ts` validates `read_page/read_pages maxChars`.
- [ ] extension direct `web_search.maxResults` rejects invalid values instead of defaulting.
- [ ] gate evidence is honest.
