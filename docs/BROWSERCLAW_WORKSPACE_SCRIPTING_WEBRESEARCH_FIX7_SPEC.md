# BrowserClaw Workspace/Scripting/WebResearch FIX7 Spec

## Purpose

This is a small, targeted hardening pass after the FIX6 review.

FIX6 mostly closed the remaining alternate-path issues:

- Rust/WASM now emits structured failure content.
- TypeScript reference runtime validates raw `readPages` web requests.
- Settings capability status derives from current key/vault state.
- Bulk research approval rejection happens before payload parsing.
- `readPages(maxPages)` uses the expected URL subset in top-level failure paths.
- Extension E2E Docker evidence is recorded.

The FIX6 review found two meaningful remaining hardening gaps:

1. Rust failure redaction is weaker than TypeScript redaction and may miss multiple token-like secrets in one message.
2. `maxPages` is not validated consistently and can desynchronize what BrowserClaw thinks will be read from what the extension actually reads.

This FIX7 pass should be narrow. Do not add broad new features.

## Priority Convention

Use the existing BrowserClaw priority convention:

```text
P0 = security/correctness blocker
P1 = required for feature completeness
P2 = polish, robustness, or future hardening
```

## Core Principle

Security and egress-control fields must be validated consistently at every protocol boundary.

The following are not acceptable:

```text
Rust redacts the first secret-like token but leaves the second one.
TypeScript redacts with regex globally, but Rust uses weaker one-shot marker replacement.
maxPages=0 causes the provider to expect zero URLs but the extension reads all URLs.
maxPages=-1 causes expectedUrls to slice differently from what the extension reads.
maxPages=NaN, Infinity, or 1.5 crosses a boundary without explicit rejection.
The extension central validator accepts read_pages urls with empty/non-string slots and relies on later handler cleanup.
Docker E2E pass is claimed, but the command/result is not reproducible in review notes.
```

## Scope

### In scope

1. Rust failure redaction completeness:
   - redact all occurrences of secret-like markers;
   - handle multiple `sk-` and `sk-ant-` tokens;
   - handle `Bearer ...`;
   - handle `Authorization: ...`;
   - preserve useful human-readable context;
   - add tests for multiple secrets in one message.

2. `maxPages` validation and normalization:
   - create a shared TypeScript helper for positive integer page limits;
   - reject or clamp invalid values consistently;
   - apply at protocol boundaries:
     - Plan Runtime;
     - TypeScript reference runtime raw web requests;
     - web runner approval/options sanitization;
     - WebResearchService;
     - extension page reader provider;
     - extension service worker message validation.
   - ensure provider and extension agree on the same effective URL subset.

3. Extension `read_pages` central validation:
   - reject missing/non-array/empty URL arrays;
   - reject non-string/empty URL slots in central validation;
   - validate `maxPages` in central validation;
   - do not rely on handler-level best effort for schema errors.

4. Evidence:
   - record exact commands;
   - record Docker extension E2E result after changes;
   - if Docker cannot run, mark extension-readiness evidence incomplete.

### Out of scope

- Firefox extension.
- Hosted proxy.
- Local daemon.
- New browser automation.
- New search providers.
- Enabling sandbox scripting if product policy remains disabled.
- Rewriting WebResearch architecture.
- Rewriting Workspace FS.

## Required Behavior

## 1. Rust failure redaction

Rust must be semantically equivalent to TypeScript failure redaction.

Examples:

```text
input:
  "failed with sk-firstSECRET123 and sk-secondSECRET456"

output:
  must not contain "sk-firstSECRET123"
  must not contain "sk-secondSECRET456"
  should retain "failed with" and "and"
```

```text
input:
  "Authorization: Bearer abc.def.ghi failed"

output:
  must not contain "Authorization:"
  must not contain "Bearer"
  must not contain "abc.def.ghi"
  should retain "failed"
```

```text
input:
  "sk-ant-one and sk-two and Bearer three"

output:
  must redact all three.
```

The redaction helper must not stop after the first token-like marker.

## 2. `maxPages` validation

`maxPages` controls web egress volume. Treat it as a security-sensitive limit.

Invalid values:

```text
0
negative numbers
NaN
Infinity
non-integers like 1.5
strings like "2"
null if null is not part of the schema
```

Each boundary must either:

```text
reject invalid maxPages with explicit validation error
```

or:

```text
normalize it through one shared helper with documented behavior
```

Recommended behavior:

```text
undefined => no explicit maxPages limit at that layer
positive integer => allowed, optionally clamped to configured max
anything else => reject
```

Do not treat `0` or negative values as "read all".

## 3. Expected URL subset consistency

For `read_pages`, the app and extension must agree on the same effective URL subset.

Recommended helper:

```ts
const effectiveMaxPages = normalizeOptionalPositiveIntegerLimit(request.maxPages, 'maxPages', {
  max: MAX_BATCH_PAGE_READS,
});

const expectedUrls = request.urls.slice(0, effectiveMaxPages ?? request.urls.length);
```

Use the same normalized value in the extension request payload.

## 4. Extension central validation

`validateMessageSchema()` should reject bad `read_pages` requests before they reach the handler.

Invalid:

```json
{ "type": "read_pages", "urls": [] }
{ "type": "read_pages", "urls": ["https://ok.example", 42] }
{ "type": "read_pages", "urls": [""] }
{ "type": "read_pages", "urls": ["https://ok.example"], "maxPages": 0 }
{ "type": "read_pages", "urls": ["https://ok.example"], "maxPages": -1 }
{ "type": "read_pages", "urls": ["https://ok.example"], "maxPages": 1.5 }
```

All should return structured `invalid_request`.

## Final Acceptance Criteria

FIX7 is complete only when:

- Rust failure redaction removes all token-like secrets, not just the first occurrence.
- Rust tests cover multiple `sk-`, `sk-ant-`, `Bearer`, and `Authorization:` secrets.
- `maxPages` is validated or normalized consistently across app/runtime/extension boundaries.
- Invalid `maxPages` cannot expand the number of pages read.
- Extension central validation rejects bad `read_pages.urls` slots and bad `maxPages`.
- Provider and extension use the same effective URL subset for `readPages`.
- Docker extension E2E is rerun or explicitly marked unverified for this pass.
- TODO evidence comments accurately describe pass/fail/deferred status.
