# BROWSERCLAW_WORKSPACE_SCRIPTING_WEBRESEARCH_FIX10_REPLIES.md

Answers to Claude Code’s FIX10 questions.

These decisions are intended to keep FIX10 narrow, type-safe, and aligned with the current BrowserClaw codebase. Do not broaden FIX10 into interface rewrites, styling, or new feature work.

---

## 1. `readPage` call-site signature in Part C1

### Answer

Keep the existing two-argument `WebResearchService.readPage` call form.

Do **not** change the `WebResearchService` interface to a single-argument form as part of FIX10.

The spec snippet used `deps.web.readPage(request)` only as pseudocode to show the desired validation ordering. The current interface is authoritative:

```ts
deps.web.readPage(url, options)
```

### Required implementation

In `runApprovedWebPageRead()`, keep the existing service call shape, but move `sanitizeReadOptions(parsed.options, url)` earlier so it runs before the `web.page_read_started` audit.

Correct order:

```ts
let url: string;
let request: PageReadRequest;

try {
  const parsed = parseApprovalPayloadObject(
    approval.payloadPreview,
    'web_page_read',
  );

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
  const result = await deps.web.readPage(url, request);
  // existing success path
} catch (error) {
  // provider/page-read failure only
}
```

If `sanitizeReadOptions()` returns `{ url, maxChars }`, it is okay if the `url` is duplicated in both arguments, as long as this matches the current type and service call convention.

### Do not do this

Do not refactor the whole service interface to:

```ts
deps.web.readPage(request)
```

That is out of scope for FIX10 and creates unnecessary churn.

---

## 2. Audit event name for approved page-read invalid options

### Answer

Use **Option B**: add a dedicated `web.page_read_payload_invalid` event.

Add a small named helper:

```ts
failInvalidPageReadPayload()
```

Do not reuse `web.effect_payload_invalid` for approved page-read payload validation.

### Why

`web.effect_payload_invalid` is appropriate for malformed direct runtime effects.

An approved page-read payload is a different boundary:

```text
approval payload -> parse/validate -> page-read execution
```

The bulk-research path already has a dedicated payload-invalid event:

```text
web.bulk_research_payload_invalid
```

Page-read should mirror that, so audit logs clearly distinguish:

```text
direct effect invalid
approved page-read payload invalid
approved bulk-research payload invalid
provider/page-read execution failure
```

This makes debugging and security review much easier.

### Required implementation

Add a helper analogous to the bulk-research invalid-payload helper:

```ts
async function failInvalidPageReadPayload(
  deps: WebRunnerDeps,
  approval: Approval,
  error: unknown,
): Promise<void> {
  const message =
    error instanceof Error
      ? error.message
      : 'Approved page-read payload was invalid.';

  await deps.recordAudit({
    type: 'web.page_read_payload_invalid',
    source: 'web',
    status: 'failure',
    risk: 'low',
    summary: 'Approved page-read payload was invalid.',
    details: {
      approvalId: approval.id,
      effectId: approval.effectId,
      message,
    },
  });

  await deps.resolveEffect(approval.effectId, {
    ok: false,
    error: {
      kind: 'web_invalid_payload',
      message,
      retryable: false,
    },
  });
}
```

Adapt field names to the existing `Approval` and audit types if they differ.

### Required tests

Add tests for:

```text
approved page-read payload with options.maxChars: 0 audits web.page_read_payload_invalid
approved page-read payload with options.maxChars: -1 audits web.page_read_payload_invalid
approved page-read payload with options.maxChars: "2000" audits web.page_read_payload_invalid
invalid approved page-read options do not audit web.page_read_started
invalid approved page-read options do not audit web.page_read_failed
invalid approved page-read options do not call provider
```

---

## 3. `DEFAULT_MAX_CHARS` vs `MAX_WEB_PAGE_CHARS` in extension service worker

### Answer

Use **Option C** for FIX10: keep `DEFAULT_MAX_CHARS` as-is and reference it inside `validateOptionalMaxChars()`.

Do not introduce a duplicate second constant in the service worker.

Do not rename the existing constant in FIX10 unless the rename is extremely low-risk and clearly touches every usage.

### Why

The extension service worker already has:

```js
const DEFAULT_MAX_CHARS = 50_000;
```

Creating a second constant with the same value adds confusion. Renaming can create unnecessary diff churn.

For FIX10, the important behavior is that the extension validates optional `maxChars` against the same 50k web-page cap. The existing constant already represents that cap in the extension context.

### Required implementation

Add:

```js
function validateOptionalMaxChars(value) {
  return validateOptionalPositiveIntegerLimit(
    value,
    'maxChars',
    DEFAULT_MAX_CHARS,
  );
}
```

Then use it in:

```text
validateMessageSchema() for read_page
validateMessageSchema() for read_pages
handleReadPage() direct validation
handleReadPages() direct validation
```

### Optional comment

Add a comment near `DEFAULT_MAX_CHARS`:

```js
// Web page content cap. Mirrors MAX_WEB_PAGE_CHARS in src/webresearch/limits.ts.
const DEFAULT_MAX_CHARS = 50_000;
```

This gives the semantic link without duplicating constants inside the service worker.

---

## 4. `maxChars` validation structure in `pageReaderProvider.readPages()`

### Answer

Use the **second independent try/catch** approach.

Keep the existing `maxPages` validation flow intact, then validate `maxChars` in a separate block after `effectiveMaxPages` is known and before `transport.send`.

### Why

This is safer and less disruptive.

`expectedUrls` must be computed from a valid `effectiveMaxPages`. Combining `maxPages` and `maxChars` validation in one catch risks accidentally using the wrong URL subset when `maxPages` fails first.

The current structure already gets the `maxPages` behavior right. Preserve it.

### Required implementation shape

Use this ordering:

```ts
let effectiveMaxPages: number | undefined;

try {
  effectiveMaxPages = normalizeOptionalMaxPages(request.maxPages);
} catch (error) {
  const expectedUrls = expectedUrlsForReadPagesWithoutValidatedMaxPages(request);
  return failuresForUrls(
    expectedUrls,
    'invalid_request',
    error instanceof Error ? error.message : 'Invalid maxPages.',
  );
}

const expectedUrls = expectedUrlsForReadPages({
  ...request,
  maxPages: effectiveMaxPages,
});

let maxChars: number | undefined;

try {
  maxChars = normalizeOptionalMaxChars(request.maxChars);
} catch (error) {
  return failuresForUrls(
    expectedUrls,
    'invalid_request',
    error instanceof Error ? error.message : 'Invalid maxChars.',
  );
}

// Only now call transport.send(), using effectiveMaxPages and maxChars.
```

If the current code already has a clean helper for invalid `maxPages` failures, keep using that helper.

### Important behavior

For invalid `maxChars`:

```text
- do not call transport
- return one structured failure for each expected URL
- expected URL subset must respect the already-validated effectiveMaxPages
```

Example:

```ts
await readPages({
  urls: ['https://a.example', 'https://b.example', 'https://c.example'],
  maxPages: 2,
  maxChars: -1,
});
```

Expected result:

```text
2 failures, not 3
transport not called
error kind invalid_request
```

---

## 5. Extension test file location for E1/E2 (`read_page` maxChars tests)

### Answer

Use **Option A**: put the new tests in the existing `serviceWorkerReadPages.test.ts`.

### Why

That file already covers both `handleReadPage` and `handleReadPages`, despite the name. Keeping the new tests there is consistent with the existing test layout and avoids a new test file for a small incremental validation pass.

### Required action

Add new describe blocks in `serviceWorkerReadPages.test.ts`, for example:

```ts
describe('FIX10 read_page maxChars validation', () => {
  // central validateMessageSchema read_page maxChars tests
  // direct handleReadPage maxChars tests
});

describe('FIX10 read_pages maxChars validation', () => {
  // central validateMessageSchema read_pages maxChars tests
  // direct handleReadPages maxChars tests
});
```

### Required tests

For `read_page` central schema validation:

```text
maxChars: 0 -> invalid_request
maxChars: -1 -> invalid_request
maxChars: 1.5 -> invalid_request
maxChars: "1000" -> invalid_request
maxChars: 1000 -> accepted
```

For direct `handleReadPage()`:

```text
maxChars: 0 -> invalid_request
maxChars: -1 -> invalid_request
maxChars: 1.5 -> invalid_request
maxChars: 1000 -> works
```

For `read_pages` central/direct validation:

```text
maxChars: 0 -> invalid_request
maxChars: -1 -> invalid_request
maxChars: 1.5 -> invalid_request
maxChars: 1000 -> works
```

---

# Final decisions summary

| # | Decision |
|---|---|
| 1 | Keep existing two-arg `deps.web.readPage(url, request)` interface. Move `sanitizeReadOptions()` earlier; do not refactor service interface. |
| 2 | Use new dedicated `web.page_read_payload_invalid` event and a named `failInvalidPageReadPayload()` helper. |
| 3 | Use Option C in the service worker: keep `DEFAULT_MAX_CHARS` and reference it in `validateOptionalMaxChars()`. Add a clarifying comment if useful. |
| 4 | Use a second independent `maxChars` try/catch after existing `maxPages` validation in `pageReaderProvider.readPages()`. |
| 5 | Put E1/E2 read-page maxChars tests in existing `serviceWorkerReadPages.test.ts`. |
