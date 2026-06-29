# replies3.md — Responses to FIX9 Review Questions

## Context

These replies answer the questions in `responses3.md` about the BrowserClaw Workspace/Scripting/WebResearch FIX9 handoff.

The short version: **FIX9 is the correct handoff. Ignore the stale references to styling and asset zips.** FIX9 is intentionally a narrow validation-hardening pass.

Do not add UI styling work in this pass. Do not look for or require a new asset zip. Implement the FIX9 spec/TODO only.

---

# 1. "Styling" vs. validation hardening

## Decision

FIX9 is the correct spec.

The references to "adding some more styling" are stale/mismatched context from an earlier BrowserClaw UI/mockup phase. They do **not** apply to this pass.

## Required action

Proceed with the FIX9 validation-hardening work only:

- runtime web-options validation parity;
- no option validation followed by option dropping;
- `maxResults` / `maxChars` validation;
- approved bulk-research invalid-option classification;
- Rust `sk-ant` / `sk` redaction overlap cleanup;
- evidence/gate recording.

Do **not** implement visual styling changes in FIX9.

Do **not** add UI polish tasks to the FIX9 TODO.

Do **not** wait for a styling spec.

## Why

FIX9 exists because the last review found remaining quiet-fallback behavior around model-authored web options. That is the current priority. Styling is out of scope for this handoff.

---

# 2. Asset zip file

## Decision

There is no new asset zip required for FIX9.

The existing `docs/browserclaw_text_mockups_handoff.zip` is the old UI/mockup handoff and is unrelated to FIX9.

## Required action

Do not block on an asset zip.

Do not modify or unpack `docs/browserclaw_text_mockups_handoff.zip`.

Do not add new asset-handling code.

Ignore any stale mention of "the asset zip file" for this pass.

## Why

FIX9 is a code hardening pass. It has no visual assets, icons, mockups, design tokens, screenshots, or styling requirements.

---

# 3. `RuntimeProtocolError` does not exist

## Decision

Do **not** use the nonexistent `RuntimeProtocolError` name literally.

Use a small local validation error type or helper for runtime web-options validation, and catch it at the call site to emit the existing `runtime.invalid_web_request` inline effect pattern.

The important behavior is:

1. `validateRuntimeWebOptions()` should be a pure validator that either returns normalized options or throws a typed validation error.
2. `referenceRuntime.ts` should catch that validation error and convert it into the existing invalid-web-request effect shape.
3. Do not let malformed model-authored `web_request.options` throw out of the runtime loop.

## Recommended implementation

Use a small local class in `referenceRuntime.ts` or a nearby runtime helper module:

```ts
class RuntimeWebOptionsValidationError extends Error {
  readonly eventType = 'runtime.invalid_web_request' as const;

  constructor(message: string) {
    super(message);
    this.name = 'RuntimeWebOptionsValidationError';
  }
}
```

Then implement:

```ts
function invalidRuntimeWebOptions(message: string): never {
  throw new RuntimeWebOptionsValidationError(message);
}
```

For limit validation, continue using `normalizeOptionalPositiveIntegerLimit()`. If it throws `LimitValidationError`, catch it inside `validateRuntimeWebOptions()` and rethrow as `RuntimeWebOptionsValidationError`, so the runtime has one error type to handle.

Example:

```ts
function validatePositiveIntegerOption(
  input: Record<string, unknown>,
  field: 'maxPages' | 'maxResults' | 'maxChars',
  max: number,
): number | undefined {
  if (input[field] === undefined) return undefined;

  try {
    return normalizeOptionalPositiveIntegerLimit(input[field], field, { max });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : `${field} must be a positive integer.`;

    invalidRuntimeWebOptions(message);
  }
}
```

Then in each `web_request` branch, use a wrapper pattern like this:

```ts
let options: RuntimeWebOptions | undefined;

try {
  options = validateRuntimeWebOptions(webRequest.options);
} catch (error) {
  return invalidWebRequestResult(
    error instanceof Error ? error.message : 'Invalid web_request.options.',
  );
}
```

Use whatever existing helper/pattern currently emits `event_type: 'runtime.invalid_web_request'`. If no helper exists, add one to avoid repeating the inline object.

## Do not do this

Do **not** throw `LimitValidationError` for non-limit schema problems like:

- `options` is an array;
- `options` is a string;
- `options` contains unknown fields;
- `site` / `format` are unsupported.

That would be semantically wrong.

Do **not** change the whole reference runtime to an exception-driven architecture. The throw/catch should be tightly scoped to validating one `web_request`.

## Acceptance

A malformed request such as:

```json
{
  "web_request": {
    "op": "search",
    "query": "browser wasm",
    "options": { "unknown": true }
  }
}
```

must produce the existing invalid-web-request runtime result/audit behavior, not crash and not emit `web_search`.

---

# 4. `MAX_PAGE_CHARS` cap for `maxChars`

## Decision

Use the web-research cap, not the scripting/workspace file-read cap.

Add an explicit web cap constant in `src/webresearch/limits.ts`:

```ts
export const MAX_WEB_PAGE_CHARS = 50_000;
```

Then either keep:

```ts
export const DEFAULT_MAX_PAGE_CHARS = MAX_WEB_PAGE_CHARS;
```

or rename usages carefully if that is not too invasive.

## Required action

For web research request options, validate `maxChars` against `MAX_WEB_PAGE_CHARS = 50_000`.

Do **not** use `src/script/planSchema.ts`'s `MAX_PAGE_CHARS = 200_000` for web research. That cap is for workspace/script file reads and is too high for the WebResearch/page-read path.

## Why

`maxChars` in WebResearch controls page content pulled from the web and fed back into the agent/runtime. It should use the existing web page read scale, which is 50k, not the scripting workspace file-read cap.

## Suggested code

In `src/webresearch/limits.ts`:

```ts
export const MAX_BATCH_PAGE_READS = 10;
export const MAX_SEARCH_RESULTS = 20;
export const MAX_WEB_PAGE_CHARS = 50_000;

// Keep this if existing code already imports DEFAULT_MAX_PAGE_CHARS.
export const DEFAULT_MAX_PAGE_CHARS = MAX_WEB_PAGE_CHARS;
```

Then in runtime/parser validation:

```ts
output.maxChars = normalizeOptionalPositiveIntegerLimit(
  input.maxChars,
  'maxChars',
  { max: MAX_WEB_PAGE_CHARS },
);
```

If renaming would touch too much code, it is acceptable to keep `DEFAULT_MAX_PAGE_CHARS` as the cap for validation, but add a comment making clear that it is also the maximum accepted web page chars for model-authored web requests.

Preferred final naming:

```ts
MAX_WEB_PAGE_CHARS
DEFAULT_MAX_PAGE_CHARS
```

where both are 50,000 unless there is a deliberate reason to split them later.

---

# 5. `MAX_SEARCH_RESULTS` location

## Decision

Move or re-export `MAX_SEARCH_RESULTS` from `src/webresearch/limits.ts`.

Do not import it from `braveSearch.ts` in runtime/parser validation code.

## Required action

Define the shared cap in `src/webresearch/limits.ts`:

```ts
export const MAX_SEARCH_RESULTS = 20;
```

Then update `braveSearch.ts` to import it from `limits.ts` instead of owning its own local constant.

## Why

`MAX_SEARCH_RESULTS` is not Brave-specific anymore. It is now part of the model-authored WebResearch option contract. Parser/runtime validation should not depend on a provider implementation module.

Validation code should import from:

```ts
src/webresearch/limits.ts
```

not:

```ts
src/webresearch/braveSearch.ts
```

This avoids a bad dependency direction and keeps all WebResearch limits centralized.

## Suggested patch shape

In `src/webresearch/limits.ts`:

```ts
export const MAX_SEARCH_RESULTS = 20;
```

In `src/webresearch/braveSearch.ts`:

```ts
import { MAX_SEARCH_RESULTS } from './limits';
```

Remove the local `MAX_SEARCH_RESULTS` definition from `braveSearch.ts`.

---

# 6. `site` and `format` options

## Decision

Exclude `site` and `format` from the supported runtime web-options set for FIX9.

Requests containing `options.site` or `options.format` should be rejected as unknown/unsupported options.

## Required action

For FIX9, support only the fields that are actually consumed downstream:

```ts
const RUNTIME_WEB_OPTION_FIELDS = new Set([
  'maxPages',
  'maxResults',
  'maxChars',
]);
```

Do not include:

```ts
'site'
'format'
```

unless this pass also implements real downstream behavior for them. It should not.

## Why

The FIX9 principle is: if BrowserClaw accepts an option, it must validate and forward it consistently, or reject it explicitly.

Since no effect handler, provider, extension protocol, or WebResearch service currently consumes `site` or `format`, accepting them would recreate the same quiet-drop problem FIX9 is supposed to eliminate.

## Required tests

Add tests like:

```ts
it('rejects unsupported site option', () => {
  // web_request.options.site should produce runtime.invalid_web_request
});

it('rejects unsupported format option', () => {
  // web_request.options.format should produce runtime.invalid_web_request
});
```

If you later want `site` or `format`, add them in a separate feature pass with full execution-path support and tests.

---

# 7. Phase 0 clerical items already done

## Decision

Yes, the two file-addition items can be checked immediately if the files already exist in the repo.

Specifically:

```md
- [x] P0 Add `docs/BROWSERCLAW_WORKSPACE_SCRIPTING_WEBRESEARCH_FIX9_SPEC.md`.
- [x] P0 Add this file as `docs/BROWSERCLAW_WORKSPACE_SCRIPTING_WEBRESEARCH_FIX9_TODO.md`.
```

But do not check the rest of Phase 0 until the actual work is done.

## Required action

You may mark those two items as complete with evidence comments such as:

```md
<!-- evidence: file already present from commit b1b6c50 -->
- [x] P0 Add `docs/BROWSERCLAW_WORKSPACE_SCRIPTING_WEBRESEARCH_FIX9_SPEC.md`.

<!-- evidence: file already present from commit b1b6c50 -->
- [x] P0 Add this file as `docs/BROWSERCLAW_WORKSPACE_SCRIPTING_WEBRESEARCH_FIX9_TODO.md`.
```

Still do the remaining Phase 0 items:

- update design notes with a FIX9 section;
- update `memory.md` with real timestamp/model/scope;
- correct any FIX8 overclaim about full options-forwarding parity;
- do not check boxes without evidence comments.

---

# Additional implementation guidance

## Runtime validator should reject unknown fields

For FIX9, unknown model-authored fields should be rejected. Do not preserve unknown fields.

Use this supported set:

```ts
const RUNTIME_WEB_OPTION_FIELDS = new Set([
  'maxPages',
  'maxResults',
  'maxChars',
]);
```

## Parser canonical options should follow the same policy

`agentBlockParser.ts` should not silently drop malformed `maxResults` / `maxChars`.

Bad:

```ts
if (maxResults !== undefined && typeof maxResults === 'number') {
  result.maxResults = maxResults;
}
```

This silently drops strings and accepts bad numeric values.

Good:

```ts
if (rawMaxResults !== undefined) {
  result.maxResults = normalizeOptionalPositiveIntegerLimit(
    rawMaxResults,
    'maxResults',
    { max: MAX_SEARCH_RESULTS },
  );
}
```

Same for `maxChars`.

## `maxChars` zero

Reject `maxChars: 0`.

Unless there is an explicit documented meaning for zero, zero should be invalid. It is almost always a model error and should not silently produce empty reads or odd truncation behavior.

## Approved bulk-research invalid options

Move `sanitizeResearchOptions(parsed.options)` into the payload-validation try/catch, before `web.research_started`.

Correct order:

```ts
if (approval.status !== 'approved') {
  // user rejected path
  return;
}

let parsed: Record<string, unknown>;
let options: ResearchOptions;

try {
  parsed = parseApprovalPayloadObject(approval.payloadPreview, 'web_bulk_research');
  options = sanitizeResearchOptions(parsed.options);

  // validate query or urls here too
} catch (error) {
  await failInvalidBulkResearchPayload(deps, approval, error);
  return;
}

await deps.recordAudit({ type: 'web.research_started', ... });

// Provider execution try/catch starts here.
```

Invalid options are payload invalid, not provider failures.

## Rust redaction overlap

Choose **Option A** from the TODO: precise ownership.

Implement:

```rust
fn should_redact_sk_token(input: &str, start: usize, prefix: &str) -> bool {
    if prefix == "sk-" && input[start..].starts_with("sk-ant-") {
        return false;
    }

    is_token_boundary_before(input, start)
        && secret_token_len_after_prefix(input, start + prefix.len()) >= 12
}
```

Add tests:

```text
short sk-ant-short is not redacted
long sk-ant-123456789012 is redacted
normal sk-123456789012 is redacted
safe words remain unredacted
```

This is clearer than documenting conservative overlap.

---

# Final decisions summary

| # | Decision |
|---|---|
| 1 | FIX9 is the correct spec. Ignore styling references. |
| 2 | No new asset zip is required. Ignore stale asset-zip references. |
| 3 | Do not use nonexistent `RuntimeProtocolError` literally. Add a small runtime web-options validation error or helper, catch it, and emit the existing `runtime.invalid_web_request` pattern. |
| 4 | Use a web cap for `maxChars`: add `MAX_WEB_PAGE_CHARS = 50_000` in `limits.ts`, and keep/alias `DEFAULT_MAX_PAGE_CHARS` to it. Do not use scripting `MAX_PAGE_CHARS = 200_000`. |
| 5 | Move/re-export `MAX_SEARCH_RESULTS = 20` from `src/webresearch/limits.ts`; provider modules should import from there. |
| 6 | Reject `site` and `format` as unsupported options in FIX9. Do not accept and pass them through. |
| 7 | The two file-addition Phase 0 items can be checked if files already exist, but the rest of Phase 0 still needs real work/evidence. |
