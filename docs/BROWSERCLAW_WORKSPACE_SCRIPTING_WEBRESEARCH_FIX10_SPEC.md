# BrowserClaw Workspace/Scripting/WebResearch FIX10 Spec

## Purpose

This is a narrow hardening pass after the FIX9 review.

FIX9 fixed the main parser/runtime option-parity bugs:

- `validateRuntimeWebOptions()` exists.
- `referenceRuntime` forwards options for `search`, `readPage`, `research`, and `readPages`.
- `agentBlockParser` validates `maxResults` and `maxChars`.
- approved bulk-research invalid options are classified as payload-invalid.
- Rust `sk-ant` / `sk` redaction overlap was resolved with precise ownership.

However, the review found remaining host-boundary gaps:

1. `webRunner` still has permissive `sanitizeSearchOptions()` behavior:
   - string `maxResults` is silently dropped;
   - invalid numeric `maxResults` can be passed through;
   - unsupported fields can be silently ignored or accepted.

2. `webRunner` still has permissive `sanitizeReadOptions()` behavior:
   - string `maxChars` is silently dropped;
   - invalid numeric `maxChars` can be passed through;
   - unsupported fields such as `format` / `timeoutMs` can be accepted even though parser/runtime now reject them.

3. Approved single page-read payloads can classify invalid `options.maxChars` as page-read/provider failure instead of payload-invalid.

4. `pageReaderProvider` validates `maxPages` but not `maxChars`.

5. The Chrome extension service worker validates `maxPages` for `read_pages`, but does not defensively validate `maxChars` for `read_page` / `read_pages`.

6. FIX9 gate evidence marks required extension Docker E2E ambiguously even though it was not actually attempted.

FIX10 should be small and precise. Do not add broad new features.

## Priority Convention

```text
P0 = security/correctness blocker
P1 = required for feature completeness
P2 = polish, robustness, or future hardening
```

## Core Principle

Every boundary that accepts model/user-controlled web options must either:

1. validate and forward the option consistently; or
2. reject it explicitly with an audited failure.

It must not silently drop invalid fields, accept unsupported fields, or allow malformed limits to reach providers/extensions.

The following remain unacceptable:

```text
sanitizeSearchOptions({ maxResults: "1" }) returns {}.
sanitizeSearchOptions({ maxResults: -1 }) returns { maxResults: -1 }.
sanitizeReadOptions({ maxChars: "2000" }) returns { url }.
sanitizeReadOptions({ maxChars: -1 }) returns { url, maxChars: -1 }.
sanitizeReadOptions({ format: "markdown" }) accepts format even though runtime/parser reject format.
runApprovedWebPageRead() records web.page_read_started before rejecting malformed options.
pageReaderProvider forwards maxChars without validating it.
extension read_page accepts maxChars: -1 and slices/truncates oddly.
required Docker extension E2E is checked even when not attempted.
```

## Scope

### In scope

1. `webRunner` strict search option validation:
   - validate `maxResults`;
   - reject invalid values;
   - reject unsupported fields;
   - classify invalid search options as `web.effect_payload_invalid`, not search/provider failure.

2. `webRunner` strict page-read option validation:
   - validate `maxChars`;
   - reject invalid values;
   - reject unsupported fields;
   - classify invalid page-read approval payload options as payload-invalid before `web.page_read_started`.

3. `pageReaderProvider` `maxChars` defense-in-depth:
   - validate `maxChars` for `readPage`;
   - validate `maxChars` for `readPages`;
   - do not send invalid `maxChars` to the extension.

4. Chrome extension service-worker `maxChars` validation:
   - validate optional `maxChars` for `read_page`;
   - validate optional `maxChars` for `read_pages`;
   - validate in central schema and direct handlers where applicable;
   - reject invalid values as `invalid_request`.

5. Evidence cleanup:
   - update review notes;
   - record commands honestly;
   - if Docker extension E2E cannot run, do not present it as passed or checked-complete without explicit cannot-run language.

### Out of scope

- New search providers.
- New extension features.
- Styling/UI changes.
- Firefox extension.
- Hosted proxy.
- Local daemon.
- Sandbox scripting policy changes.
- Workspace FS changes.
- Broad WebResearch architecture rewrites.

## Required Behavior

## 1. `webRunner` search option validation

`sanitizeSearchOptions()` must validate strictly.

Valid:

```json
{ "maxResults": 5 }
```

Invalid:

```json
{ "maxResults": "5" }
{ "maxResults": 0 }
{ "maxResults": -1 }
{ "maxResults": 1.5 }
{ "maxResults": 999999 }
{ "site": "example.com" }
{ "unknown": true }
```

Invalid search options must not call the provider and must not be silently dropped.

For direct `web_search` effects, invalid options should be audited/resolved as an invalid effect payload.

## 2. `webRunner` page-read option validation

`sanitizeReadOptions()` must validate strictly.

Valid:

```json
{ "maxChars": 1000 }
```

Invalid:

```json
{ "maxChars": "1000" }
{ "maxChars": 0 }
{ "maxChars": -1 }
{ "maxChars": 1.5 }
{ "maxChars": 999999 }
{ "format": "markdown" }
{ "timeoutMs": 10000 }
{ "unknown": true }
```

If `format` or `timeoutMs` are not supported by parser/runtime and not fully wired through the extension/provider path, reject them.

## 3. Approved page-read invalid options are payload-invalid

`runApprovedWebPageRead()` must validate approval payload options before recording `web.page_read_started`.

Correct order:

```text
if approval rejected:
  user_rejected
  return

parse payload
validate URL
sanitize/validate options
if invalid:
  web.page_read_payload_invalid or existing invalid-payload equivalent
  resolve ok:false
  return

audit web.page_read_started
call provider
```

Invalid options are not provider/page-read failures.

## 4. Provider and extension maxChars validation

`maxChars` is a web content-size limit. Validate it at each boundary:

```text
parser/runtime -> webRunner -> pageReaderProvider -> extension central schema -> extension handler
```

`maxChars` should use the web cap:

```ts
MAX_WEB_PAGE_CHARS = 50_000
```

not the workspace/script file cap.

## 5. Gate evidence

If a command cannot run, record it as cannot-run and explain why.

Do not mark Docker extension E2E as passed if it was not attempted.

Acceptable evidence examples:

```md
- [x] P0 `pnpm run test:extension:e2e` — CANNOT RUN in local headless env: MV3 service worker requires Xvfb/Docker. Scoped only.
- [ ] P1 `pnpm run test:extension:e2e:docker` — NOT RUN: Docker unavailable in this environment. Extension E2E readiness not independently verified for FIX10.
```

or, if it actually runs:

```md
- [x] P1 `pnpm run test:extension:e2e:docker` — PASS: 5/5.
```

## Final Acceptance Criteria

FIX10 is complete only when:

- `sanitizeSearchOptions()` rejects invalid/unsupported search options.
- invalid search options are audited/resolved as invalid effect payloads.
- `sanitizeReadOptions()` rejects invalid/unsupported page-read options.
- approved page-read invalid options are classified as payload-invalid before `web.page_read_started`.
- `pageReaderProvider` validates `maxChars` for `readPage` and `readPages`.
- extension service worker validates `maxChars` for `read_page` and `read_pages`.
- extension handlers reject invalid direct-call `maxChars`.
- gate evidence is honest about Docker extension E2E status.
