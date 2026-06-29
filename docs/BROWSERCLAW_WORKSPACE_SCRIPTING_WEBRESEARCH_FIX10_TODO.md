# BrowserClaw Workspace/Scripting/WebResearch FIX10 TODO

## Priority Key

```text
P0 = security/correctness blocker
P1 = required for feature completeness
P2 = polish, robustness, or future hardening
```

## Phase 0 — Scope Lock and Evidence Hygiene

- [x] P0 Add `docs/BROWSERCLAW_WORKSPACE_SCRIPTING_WEBRESEARCH_FIX10_SPEC.md`. <!-- added by user in deeb922 -->
- [x] P0 Add this file as `docs/BROWSERCLAW_WORKSPACE_SCRIPTING_WEBRESEARCH_FIX10_TODO.md`. <!-- added by user in deeb922 -->
- [x] P0 Update `docs/WORKSPACE_SCRIPTING_WEBRESEARCH_DESIGN_NOTES.md` with a FIX10 section: <!-- FIX10 Locked decisions section added -->
  - [x] `webRunner` search/page-read option sanitizers must be strict. <!-- documented: assertPlainOptionsObject, rejectUnknownOptionFields, SEARCH/PAGE_READ_OPTION_FIELDS -->
  - [x] invalid `maxResults` / `maxChars` must not be silently dropped. <!-- documented: throw on zero/negative/string/non-integer/above-cap -->
  - [x] approved single page-read invalid options must be payload-invalid. <!-- documented: sanitizeReadOptions before page_read_started; failInvalidPageReadPayload -->
  - [x] `pageReaderProvider` must validate `maxChars`. <!-- documented: readPage returns invalid_request; readPages uses separate try/catch -->
  - [x] extension `read_page` / `read_pages` must validate `maxChars`. <!-- documented: validateOptionalMaxChars via DEFAULT_MAX_CHARS; central + direct -->
  - [x] gate evidence must distinguish pass/fail/cannot-run/not-attempted. <!-- documented: NOT ATTEMPTED stays unchecked -->
- [x] P0 Update `memory.md` with: <!-- memory.md updated with 2026-06-29T23:17:36Z entry -->
  - [x] real `date -u` timestamp; <!-- 2026-06-29T23:17:36Z -->
  - [x] model name; <!-- Claude Sonnet 4.6 -->
  - [x] concise summary of FIX10 scope. <!-- FIX10 scope: strict sanitizers, payload-invalid classification, provider/extension maxChars -->
- [x] P0 Do not add broad new features in this pass. <!-- meta-constraint; no new features added -->
- [x] P0 Do not check TODO boxes without evidence comments pointing to source/tests. <!-- all evidence comments added inline -->
- [x] P0 Correct any FIX9 gate evidence that implies Docker extension E2E passed or completed if it was not actually attempted. <!-- FIX9 TODO line 413: [x] → [ ]; added explicit NOT ATTEMPTED language -->

---

# Part A — Strict `webRunner` Search Option Validation

## A1 — Replace permissive `sanitizeSearchOptions()`

### Problem

`sanitizeSearchOptions()` still uses permissive conditional spreading:

```ts
function sanitizeSearchOptions(input: unknown): SearchOptions {
  const o = (
    typeof input === 'object' && input !== null ? input : {}
  ) as Record<string, unknown>;
  return {
    ...(typeof o.maxResults === 'number' ? { maxResults: o.maxResults } : {}),
    ...(typeof o.site === 'string' ? { site: o.site } : {}),
  };
}
```

This silently drops malformed values and accepts invalid numeric values.

### Required behavior

- [x] P1 `undefined` options should return `{}`. <!-- assertPlainOptionsObject returns {} for undefined -->
- [x] P1 non-object options should throw invalid effect payload. <!-- assertPlainOptionsObject throws WebEffectPayloadError -->
- [x] P1 array options should throw invalid effect payload. <!-- assertPlainOptionsObject checks Array.isArray -->
- [x] P1 unknown fields should throw invalid effect payload. <!-- rejectUnknownOptionFields throws for fields not in SEARCH_OPTION_FIELDS -->
- [x] P1 `site` should be rejected unless fully supported end-to-end. For FIX10, reject it. <!-- SEARCH_OPTION_FIELDS = new Set(['maxResults']); site not present -->
- [x] P1 `maxResults` should be validated with `normalizeOptionalPositiveIntegerLimit`. <!-- src/runtime/webRunner.ts: sanitizeSearchOptions -->
- [x] P1 Reject:
  - [x] string; <!-- normalizeOptionalPositiveIntegerLimit throws on non-number -->
  - [x] zero; <!-- normalizeOptionalPositiveIntegerLimit throws on value < 1 -->
  - [x] negative; <!-- normalizeOptionalPositiveIntegerLimit throws on value < 1 -->
  - [x] non-integer; <!-- normalizeOptionalPositiveIntegerLimit throws on !Number.isInteger -->
  - [x] above cap. <!-- max: MAX_SEARCH_RESULTS (20) -->
- [x] P1 Tests:
  - [x] `maxResults: "1"` rejected, not silently dropped; <!-- A2 test a2-str -->
  - [x] `maxResults: 0` rejected; <!-- A2 test a2-zero -->
  - [x] `maxResults: -1` rejected; <!-- A2 test a2-neg -->
  - [x] `maxResults: 1.5` rejected; <!-- A2 test a2-float -->
  - [x] `maxResults` above cap rejected; <!-- A2 test a2-cap -->
  - [x] `site` rejected; <!-- A2 test a2-site -->
  - [x] unknown option rejected; <!-- A2 test a2-unk -->
  - [x] valid `maxResults: 1` accepted. <!-- A1 test a1-ok -->

### Suggested code

```ts
function assertPlainOptionsObject(
  input: unknown,
  label: string,
): Record<string, unknown> {
  if (input === undefined) return {};

  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new WebEffectPayloadError(
      'web_effect_invalid_field',
      `${label} must be an object.`,
    );
  }

  return input as Record<string, unknown>;
}

function rejectUnknownOptionFields(
  input: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  label: string,
): void {
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) {
      throw new WebEffectPayloadError(
        'web_effect_invalid_field',
        `Unsupported ${label} field: ${key}.`,
      );
    }
  }
}

const SEARCH_OPTION_FIELDS = new Set(['maxResults']);

function sanitizeSearchOptions(input: unknown): SearchOptions {
  const o = assertPlainOptionsObject(input, 'web_search.options');
  rejectUnknownOptionFields(o, SEARCH_OPTION_FIELDS, 'web_search.options');

  const maxResults =
    o.maxResults !== undefined
      ? normalizeOptionalPositiveIntegerLimit(o.maxResults, 'maxResults', {
          max: MAX_SEARCH_RESULTS,
        })
      : undefined;

  return {
    ...(maxResults !== undefined ? { maxResults } : {}),
  };
}
```

## A2 — Invalid search options must resolve/audit as invalid effect payload

- [x] P1 Ensure `createWebEffectHandler()` catches `sanitizeSearchOptions()` errors as invalid effect payload. <!-- sanitizeSearchOptions added to query try/catch in web_search branch -->
- [x] P1 Invalid search options must:
  - [x] audit `web.effect_payload_invalid` or the existing equivalent; <!-- failInvalidWebEffect audits web.effect_payload_invalid -->
  - [x] resolve effect `ok:false`; <!-- failInvalidWebEffect resolves ok:false -->
  - [x] not audit `web.search_started`; <!-- validated before web.search_started audit -->
  - [x] not call search provider. <!-- return before deps.web.search() call -->
- [x] P1 Tests:
  - [x] direct `web_search` effect with `options.maxResults: 0` resolves invalid payload; <!-- test a2-zero -->
  - [x] direct `web_search` effect with `options.maxResults: "1"` resolves invalid payload; <!-- test a2-str -->
  - [x] invalid search options do not call provider; <!-- web.search not.toHaveBeenCalled in all A2 tests -->
  - [x] invalid search options do not audit `web.search_failed`. <!-- a2-str checks not.toContain('web.search_failed') -->

### Suggested handler shape

If search sanitization currently happens inside a provider try/catch, split validation from provider execution:

```ts
let request: SearchRequest;

try {
  request = {
    query: effect.query,
    ...sanitizeSearchOptions(effect.options),
  };
} catch (error) {
  await failInvalidWebEffect(deps, effect.id, error);
  return;
}

await deps.recordAudit({ type: 'web.search_started', ... });

try {
  const result = await deps.web.search(request);
  // success path
} catch (error) {
  // provider failure only
}
```

---

# Part B — Strict `webRunner` Page-Read Option Validation

## B1 — Replace permissive `sanitizeReadOptions()`

### Problem

`sanitizeReadOptions()` still silently drops malformed `maxChars` and accepts unsupported fields.

Bad examples:

```json
{ "maxChars": "2000" }
{ "maxChars": 0 }
{ "maxChars": -1 }
{ "maxChars": 1.5 }
{ "maxChars": 999999 }
{ "format": "markdown" }
{ "timeoutMs": 10000 }
{ "unknown": true }
```

### Required behavior

- [ ] P1 `undefined` options should return `{ url }`.
- [ ] P1 non-object options should throw invalid effect payload.
- [ ] P1 array options should throw invalid effect payload.
- [ ] P1 unknown fields should throw invalid effect payload.
- [ ] P1 `format` should be rejected in FIX10 unless fully supported end-to-end.
- [ ] P1 `timeoutMs` should be rejected in FIX10 unless fully supported/validated end-to-end.
- [ ] P1 `maxChars` should be validated with `normalizeOptionalPositiveIntegerLimit` and `MAX_WEB_PAGE_CHARS`.
- [ ] P1 Reject:
  - [ ] string;
  - [ ] zero;
  - [ ] negative;
  - [ ] non-integer;
  - [ ] above cap.
- [ ] P1 Tests:
  - [ ] `maxChars: "2000"` rejected;
  - [ ] `maxChars: 0` rejected;
  - [ ] `maxChars: -1` rejected;
  - [ ] `maxChars: 1.5` rejected;
  - [ ] `maxChars` above cap rejected;
  - [ ] `format` rejected;
  - [ ] `timeoutMs` rejected;
  - [ ] unknown option rejected;
  - [ ] valid `maxChars: 1000` accepted.

### Suggested code

```ts
const PAGE_READ_OPTION_FIELDS = new Set(['maxChars']);

function sanitizeReadOptions(input: unknown, url: string): PageReadRequest {
  const o = assertPlainOptionsObject(input, 'web_page_read.options');
  rejectUnknownOptionFields(o, PAGE_READ_OPTION_FIELDS, 'web_page_read.options');

  const maxChars =
    o.maxChars !== undefined
      ? normalizeOptionalPositiveIntegerLimit(o.maxChars, 'maxChars', {
          max: MAX_WEB_PAGE_CHARS,
        })
      : undefined;

  return {
    url,
    ...(maxChars !== undefined ? { maxChars } : {}),
  };
}
```

## B2 — Direct `web_page_read` invalid options must resolve/audit as invalid effect payload

- [ ] P1 Ensure direct `web_page_read` effects validate options before `web.page_read_started`.
- [ ] P1 Invalid page-read options must:
  - [ ] audit `web.effect_payload_invalid` or existing equivalent;
  - [ ] resolve effect `ok:false`;
  - [ ] not audit `web.page_read_started`;
  - [ ] not call page reader provider.
- [ ] P1 Tests:
  - [ ] direct `web_page_read` with `options.maxChars: -1` resolves invalid payload;
  - [ ] direct `web_page_read` with `options.maxChars: "2000"` resolves invalid payload;
  - [ ] invalid page-read options do not call provider;
  - [ ] invalid page-read options do not audit `web.page_read_failed`.

---

# Part C — Approved Single Page-Read Payload Classification

## C1 — Move page-read option validation into payload-validation block

### Problem

Approved page-read payloads can validate URL first, record `web.page_read_started`, then fail later due to bad options. Invalid approval payload options should be payload-invalid, not provider/page-read failure.

### Required behavior

- [ ] P1 In `runApprovedWebPageRead()`:
  - [ ] handle rejection before parsing payload;
  - [ ] parse payload;
  - [ ] validate URL;
  - [ ] sanitize/validate options;
  - [ ] on URL/options validation error, audit payload-invalid;
  - [ ] resolve effect `ok:false`;
  - [ ] do not audit `web.page_read_started`;
  - [ ] do not call provider.
- [ ] P1 Tests:
  - [ ] approved page-read payload with `options.maxChars: 0` audits payload-invalid;
  - [ ] approved page-read payload with `options.maxChars: -1` audits payload-invalid;
  - [ ] approved page-read payload with `options.maxChars: "2000"` audits payload-invalid;
  - [ ] invalid options do not audit `web.page_read_failed`;
  - [ ] invalid options do not call provider.

### Suggested code order

```ts
export async function runApprovedWebPageRead(
  approval: Approval,
  deps: WebRunnerDeps,
): Promise<void> {
  if (approval.status !== 'approved') {
    // existing user rejected path
    return;
  }

  let url: string;
  let request: PageReadRequest;

  try {
    const parsed = parseApprovalPayloadObject(approval.payloadPreview, 'web_page_read');
    url = requireStringField(parsed, 'url', 'web_page_read');
    assertFetchUrlAllowed(url);
    request = sanitizeReadOptions(parsed.options, url);
  } catch (error) {
    await failInvalidPageReadPayload(deps, approval, error);
    return;
  }

  await deps.recordAudit({
    type: 'web.page_read_started',
    // ...
  });

  try {
    const result = await deps.web.readPage(request);
    // success path
  } catch (error) {
    // provider failure only
  }
}
```

If there is no `failInvalidPageReadPayload()` helper, create one analogous to the bulk-research invalid-payload helper. Use the existing audit naming convention in `webRunner.ts`.

---

# Part D — `pageReaderProvider` `maxChars` Defense-in-Depth

## D1 — Validate `maxChars` in `readPage()`

### Problem

`pageReaderProvider.readPage()` can forward invalid `maxChars` to the extension.

### Required behavior

- [ ] P1 Validate `request.maxChars` before sending to extension.
- [ ] P1 Reject:
  - [ ] string if type permits runtime input;
  - [ ] zero;
  - [ ] negative;
  - [ ] non-integer;
  - [ ] above cap.
- [ ] P1 Invalid `maxChars` should return a structured page-read failure and not send to extension.
- [ ] P1 Tests:
  - [ ] `readPage({ maxChars: -1 })` returns invalid failure;
  - [ ] `readPage({ maxChars: 0 })` returns invalid failure;
  - [ ] `readPage({ maxChars: 1.5 })` returns invalid failure;
  - [ ] valid `maxChars: 1000` is sent to extension.

### Suggested helper

```ts
function normalizeOptionalMaxChars(value: unknown): number | undefined {
  return normalizeOptionalPositiveIntegerLimit(value, 'maxChars', {
    max: MAX_WEB_PAGE_CHARS,
  });
}
```

For `readPage()`:

```ts
async function readPage(request: PageReadRequest): Promise<PageReadResult> {
  let maxChars: number | undefined;

  try {
    maxChars = normalizeOptionalMaxChars(request.maxChars);
  } catch (error) {
    return {
      ok: false,
      url: request.url,
      error: {
        kind: 'invalid_request',
        message: error instanceof Error ? error.message : 'Invalid maxChars.',
        retryable: false,
      },
    };
  }

  // send { ...request, maxChars } to extension
}
```

Adapt return shape to the existing `PageReadResult` type.

## D2 — Validate `maxChars` in `readPages()`

- [ ] P1 Validate `request.maxChars` before sending to extension.
- [ ] P1 Invalid `maxChars` should return one structured failure for each expected URL.
- [ ] P1 Do not send invalid `maxChars` to extension.
- [ ] P1 Tests:
  - [ ] `readPages({ urls: [...], maxChars: -1 })` returns failures for expected URLs;
  - [ ] invalid `maxChars` does not call transport;
  - [ ] valid `maxChars` is sent to extension.

### Suggested readPages shape

```ts
async function readPages(request: ReadPagesRequest): Promise<ReadPagesResult> {
  let effectiveMaxPages: number | undefined;
  let maxChars: number | undefined;

  try {
    effectiveMaxPages = normalizeOptionalMaxPages(request.maxPages);
    maxChars = normalizeOptionalMaxChars(request.maxChars);
  } catch (error) {
    const expectedUrls = expectedUrlsForReadPages({
      ...request,
      maxPages: effectiveMaxPages,
    });

    return failuresForUrls(
      expectedUrls,
      'invalid_request',
      error instanceof Error ? error.message : 'Invalid readPages request.',
    );
  }

  const expectedUrls = expectedUrlsForReadPages({
    ...request,
    maxPages: effectiveMaxPages,
  });

  // send normalized maxPages/maxChars to extension
}
```

Be careful that if `maxPages` validation fails first, `effectiveMaxPages` may be undefined. In that case, use the same URL subset semantics already used for invalid maxPages tests, or validate maxPages first and compute expected URLs only after maxPages succeeds.

---

# Part E — Extension Service Worker `maxChars` Validation

## E1 — Add central `maxChars` validation for `read_page`

- [ ] P1 In `validateMessageSchema()` or equivalent central validator:
  - [ ] validate optional `maxChars` for `read_page`;
  - [ ] reject zero;
  - [ ] reject negative;
  - [ ] reject non-integer;
  - [ ] reject above cap;
  - [ ] reject string values.
- [ ] P1 Tests:
  - [ ] `read_page` with `maxChars: 0` returns `invalid_request`;
  - [ ] `read_page` with `maxChars: -1` returns `invalid_request`;
  - [ ] `read_page` with `maxChars: 1.5` returns `invalid_request`;
  - [ ] `read_page` with `maxChars: "1000"` returns `invalid_request`;
  - [ ] valid `maxChars: 1000` accepted.

## E2 — Add direct handler validation for `handleReadPage()`

- [ ] P1 `handleReadPage()` validates `maxChars` even if called directly.
- [ ] P1 Invalid direct-call `maxChars` returns `invalid_request`.
- [ ] P1 Invalid direct-call `maxChars` does not execute/read page content.
- [ ] P1 Tests:
  - [ ] direct `handleReadPage({ maxChars: -1 })` returns `invalid_request`;
  - [ ] direct `handleReadPage({ maxChars: 0 })` returns `invalid_request`;
  - [ ] direct `handleReadPage({ maxChars: 1.5 })` returns `invalid_request`;
  - [ ] valid direct `maxChars: 1000` works.

## E3 — Add central/direct `maxChars` validation for `read_pages`

- [ ] P1 `validateMessageSchema()` validates optional `maxChars` for `read_pages`.
- [ ] P1 `handleReadPages()` validates `maxChars` directly.
- [ ] P1 Invalid `maxChars` returns `invalid_request`.
- [ ] P1 Invalid `maxChars` does not execute/read pages.
- [ ] P1 Tests:
  - [ ] `read_pages` with `maxChars: -1` returns `invalid_request`;
  - [ ] `read_pages` with `maxChars: 0` returns `invalid_request`;
  - [ ] `read_pages` with `maxChars: 1.5` returns `invalid_request`;
  - [ ] valid `read_pages maxChars: 1000` works.

### Suggested service-worker code

```js
const MAX_WEB_PAGE_CHARS = 50_000;

function validateOptionalMaxChars(value) {
  return validateOptionalPositiveIntegerLimit(
    value,
    'maxChars',
    MAX_WEB_PAGE_CHARS,
  );
}

function validateReadPageMessage(message) {
  // existing URL validation...

  const maxCharsError = validateOptionalMaxChars(message.maxChars);
  if (maxCharsError) {
    return { ok: false, message: maxCharsError };
  }

  return { ok: true };
}
```

Use the existing error response shape and helper naming in the service worker.

---

# Part F — Evidence and Gate Cleanup

## F1 — Update review notes

- [ ] P1 Update or create `docs/WORKSPACE_SCRIPTING_WEBRESEARCH_FIX10_REVIEW_NOTES.md`.
- [ ] P1 Include:
  - [ ] strict search options behavior;
  - [ ] strict page-read options behavior;
  - [ ] approved page-read invalid-payload classification;
  - [ ] provider `maxChars` validation;
  - [ ] extension `maxChars` validation;
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

### Evidence examples

If Docker extension E2E actually passes:

```md
- [x] P1 `pnpm run test:extension:e2e:docker` — PASS: 5/5.
```

If Docker is unavailable:

```md
- [ ] P1 `pnpm run test:extension:e2e:docker` — NOT RUN: Docker unavailable in this environment. Extension E2E not independently verified for FIX10.
```

## F3 — Final acceptance checklist

FIX10 is complete only when:

- [ ] `sanitizeSearchOptions()` rejects invalid/unsupported options.
- [ ] invalid search options resolve/audit as invalid effect payload and do not call provider.
- [ ] `sanitizeReadOptions()` rejects invalid/unsupported options.
- [ ] direct `web_page_read` invalid options resolve/audit as invalid effect payload and do not call provider.
- [ ] approved page-read invalid options are payload-invalid before `web.page_read_started`.
- [ ] `pageReaderProvider.readPage()` validates `maxChars`.
- [ ] `pageReaderProvider.readPages()` validates `maxChars`.
- [ ] extension `read_page` validates `maxChars` centrally and in direct handler.
- [ ] extension `read_pages` validates `maxChars` centrally and in direct handler.
- [ ] gate evidence honestly distinguishes pass/fail/cannot-run/not-attempted.
