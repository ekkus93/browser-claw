# BrowserClaw Workspace/Scripting/WebResearch FIX9 Spec

## Purpose

This is a small follow-up hardening pass after the FIX8 review.

FIX8 fixed the highest-risk `maxPages` issues for `readPages`, direct extension handler validation, and Rust safe-word redaction. However, the review found one remaining options-parity class of bugs:

- `referenceRuntime` forwards `options` for `readPages`, but not consistently for `search`, `readPage`, or `research`.
- `maxResults` and `maxChars` are not validated with the same rigor as `maxPages`.
- Some malformed option values can still be silently dropped.
- Approved bulk-research payloads with invalid options can be misclassified as provider failures instead of payload-invalid.
- Rust `sk-ant-*` / generic `sk-*` redaction overlap should either be documented or made precise.

FIX9 should be narrow and should not add broad new product features.

## Priority Convention

Use the existing BrowserClaw priority convention:

```text
P0 = security/correctness blocker
P1 = required for feature completeness
P2 = polish, robustness, or future hardening
```

## Core Principle

If BrowserClaw accepts an option from a model-authored request, it must either:

1. validate and forward it consistently; or
2. reject it explicitly.

It must not silently drop malformed or unsupported options.

The following are not acceptable:

```text
search accepts options.maxResults but emits a web_search effect without maxResults.
readPage accepts options.maxChars but emits a web_page_read effect without maxChars.
research accepts options.maxPages/maxResults but emits a web_research effect without options.
maxChars: "2000" is silently ignored.
maxResults: 0 is accepted or silently ignored.
Unknown options are accepted from a model-authored request and then dropped.
Approved bulk research with invalid options is audited as web.research_failed instead of payload-invalid.
```

## Scope

### In scope

1. Shared runtime web-options validation:
   - validate `maxPages`;
   - validate `maxResults`;
   - validate `maxChars`;
   - reject unknown fields for model-authored runtime requests unless explicitly documented;
   - reject non-object `options`.

2. Reference runtime forwarding:
   - `search` forwards validated `maxResults`;
   - `readPage` forwards validated `maxChars`;
   - `research` forwards validated `maxPages` and `maxResults`;
   - `readPages` forwards validated `maxPages` and `maxChars`;
   - no web op validates and drops options.

3. Parser/canonical options validation:
   - top-level and nested `maxResults` are validated;
   - top-level and nested `maxChars` are validated;
   - string/zero/negative/non-integer/too-large values are rejected;
   - unknown nested options are rejected or explicitly handled.

4. Approved bulk-research payload classification:
   - malformed or invalid options in approved payloads are treated as payload-invalid;
   - do not audit them as provider execution failures;
   - rejection still happens before payload parsing.

5. Rust redaction overlap cleanup:
   - generic `sk-` pass should not accidentally own `sk-ant-` tokens after the `sk-ant-` pass declined them; or
   - document and test the conservative overlap policy.

6. Evidence:
   - update review notes;
   - run and record gate commands;
   - rerun Docker extension E2E if possible.

### Out of scope

- New browser automation features.
- Firefox extension.
- Hosted proxy.
- Local daemon.
- New search providers.
- Enabling sandbox scripting.
- Rewriting WebResearch architecture.
- Rewriting Workspace FS.

## Required Behavior

## 1. Runtime web options must have a single validator

`referenceRuntime` should have one validator for model-authored `web_request.options`.

Recommended behavior:

```text
undefined options => undefined
non-object options => invalid_web_request
array options => invalid_web_request
unknown option field => invalid_web_request
maxPages => positive integer within MAX_BATCH_PAGE_READS
maxResults => positive integer within MAX_SEARCH_RESULTS
maxChars => positive integer within MAX_PAGE_CHARS
site => optional non-empty string, if supported
format => optional enum, if supported
```

If `site` or `format` are not supported by the runtime effect path, reject them instead of preserving and dropping them.

## 2. All web ops must forward validated options

Examples:

### Search

Input:

```json
{
  "web_request": {
    "op": "search",
    "query": "browser wasm",
    "options": { "maxResults": 1 }
  }
}
```

Emitted effect:

```json
{
  "type": "web_search",
  "query": "browser wasm",
  "options": { "maxResults": 1 }
}
```

### Read page

Input:

```json
{
  "web_request": {
    "op": "readPage",
    "url": "https://example.com",
    "options": { "maxChars": 1000 }
  }
}
```

Emitted effect:

```json
{
  "type": "web_page_read",
  "url": "https://example.com",
  "options": { "maxChars": 1000 }
}
```

### Research

Input:

```json
{
  "web_request": {
    "op": "research",
    "query": "webassembly browser agents",
    "options": { "maxPages": 2, "maxResults": 5 }
  }
}
```

Emitted effect:

```json
{
  "type": "web_research",
  "mode": "query",
  "query": "webassembly browser agents",
  "options": { "maxPages": 2, "maxResults": 5 }
}
```

### Read pages

Input:

```json
{
  "web_request": {
    "op": "readPages",
    "urls": ["https://a.example", "https://b.example"],
    "options": { "maxPages": 1, "maxChars": 20000 }
  }
}
```

Emitted effect:

```json
{
  "type": "web_research",
  "mode": "urls",
  "urls": ["https://a.example", "https://b.example"],
  "options": { "maxPages": 1, "maxChars": 20000 }
}
```

## 3. Invalid option values must not be silently dropped

Invalid examples:

```json
{ "options": { "maxResults": "1" } }
{ "options": { "maxResults": 0 } }
{ "options": { "maxResults": -1 } }
{ "options": { "maxResults": 1.5 } }
{ "options": { "maxChars": "2000" } }
{ "options": { "maxChars": 0 } }
{ "options": { "maxChars": -1 } }
{ "options": { "maxChars": 1.5 } }
{ "options": { "unknown": true } }
```

All should produce explicit malformed/protocol errors, not best-effort omission.

## 4. Approved bulk-research invalid options are payload-invalid

Approved payload path order:

```text
if approval rejected:
  user_rejected
  return

parse payload
sanitize/validate payload options
validate query/urls
if invalid:
  web.bulk_research_payload_invalid
  resolve ok:false
  return

audit web.research_started
call provider
```

Invalid options are not provider failures.

## 5. Rust redaction overlap must be explicit

If Rust redaction uses prefix-based no-dependency logic:

- `sk-ant-*` should be handled by the `sk-ant-` rule.
- generic `sk-` should not accidentally redact an `sk-ant-*` token that the `sk-ant-` rule rejected for length.
- Safe words must remain safe.

Alternatively, document the conservative overlap and test it explicitly.

## Final Acceptance Criteria

FIX9 is complete only when:

- `referenceRuntime` validates `web_request.options` with one shared helper.
- `referenceRuntime` forwards validated options for all web ops that accept options.
- `maxResults` and `maxChars` are validated, not silently dropped.
- Parser/canonical options reject invalid `maxResults` and `maxChars`.
- Approved bulk-research invalid options are classified as payload-invalid.
- Rust `sk-ant` / `sk` overlap is fixed or explicitly documented and tested.
- Gate results are recorded honestly.
