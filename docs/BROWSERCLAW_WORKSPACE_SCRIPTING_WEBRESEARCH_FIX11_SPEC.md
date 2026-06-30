# BrowserClaw Workspace/Scripting/WebResearch FIX11 Spec

## Purpose

This is a narrow cleanup/hardening pass after the FIX10 review.

FIX10 successfully hardened the explicit search and page-read option paths:

- `sanitizeSearchOptions()` is strict.
- `sanitizeReadOptions()` is strict.
- invalid approved page-read options are payload-invalid.
- `pageReaderProvider` validates `maxChars`.
- the Chrome extension validates `read_page` / `read_pages` `maxChars`.

However, the FIX10 review found one remaining quiet-fallback cluster:

1. `sanitizeResearchOptions()` is still permissive:
   - non-object options are accepted as `{}`;
   - unknown fields are silently ignored;
   - `site` is accepted even though the extension-backed search path does not actually apply it;
   - `format` is accepted even though it is not consistently honored by the research/page-read path.

2. `pageReaderProvider` rejects invalid `maxChars`, but reports it as `internal_error` rather than `invalid_request`.

3. `src/extension/protocol.ts` does not validate `read_page.maxChars` / `read_pages.maxChars`, even though the service worker now does.

4. The Chrome extension direct `web_search` handler still defaults invalid `maxResults` to 10 instead of rejecting it.

FIX11 should close those remaining quiet-fallback paths. Do not add broad new features.

## Priority Convention

```text
P0 = security/correctness blocker
P1 = required for feature completeness
P2 = polish, robustness, or future hardening
```

## Core Principle

Every WebResearch option boundary must be explicit:

```text
accepted option => validate and honor it end-to-end
unsupported option => reject it loudly
malformed option => reject it loudly
provider/extension-local validation failure => invalid_request, not internal_error
```

The following are not acceptable:

```text
sanitizeResearchOptions("bad") returns {}.
sanitizeResearchOptions({ unknown: true }) silently ignores unknown.
sanitizeResearchOptions({ site: "example.com" }) makes approval text look site-limited when the provider ignores site.
sanitizeResearchOptions({ format: "markdown" }) accepts format even though the read path does not consistently honor it.
pageReaderProvider returns internal_error for invalid caller-supplied maxChars.
parseExtensionRequest accepts read_page/read_pages maxChars without validation.
handleWebSearch({ maxResults: -1 }) silently defaults to 10.
```

## Scope

### In scope

1. Strict `web_research.options` validation in `webRunner`:
   - reject non-object options;
   - reject array options;
   - reject unknown fields;
   - reject `site` and `format` for FIX11;
   - validate `maxPages`;
   - validate `maxResults`;
   - validate `maxChars`.

2. Direct `web_research` invalid-option behavior:
   - invalid direct `web_research.options` must audit/resolve as `web.effect_payload_invalid`;
   - invalid direct research options must not request approval;
   - invalid direct research options must not call search/page-read providers.

3. Approved bulk-research invalid-option behavior:
   - invalid approved bulk-research options must audit as `web.bulk_research_payload_invalid`;
   - invalid approved options must not audit `web.research_started`;
   - invalid approved options must not call providers.

4. `pageReaderProvider` error-kind cleanup:
   - add or use `invalid_request` error kind for local invalid input;
   - invalid `maxChars` should not be reported as `internal_error`.

5. Extension protocol validation parity:
   - `src/extension/protocol.ts` should validate optional `maxChars` for `read_page`;
   - `src/extension/protocol.ts` should validate optional `maxChars` for `read_pages`.

6. Extension direct `web_search.maxResults` validation:
   - central schema and direct handler should reject invalid `maxResults`;
   - invalid `maxResults` must not default to 10.

7. Evidence:
   - update design notes, memory, review notes, TODO evidence;
   - record gate commands honestly.

### Out of scope

- Implementing `site` filtering.
- Implementing `format` conversion.
- New search providers.
- New extension features.
- UI styling.
- Firefox extension.
- Hosted proxy.
- Local daemon.
- Workspace FS changes.
- Sandbox scripting policy changes.
- Broad WebResearch rewrites.

## Required Behavior

## 1. Strict `sanitizeResearchOptions()`

For FIX11, only these research option fields are supported:

```ts
maxPages
maxResults
maxChars
```

Valid:

```json
{ "maxPages": 2, "maxResults": 5, "maxChars": 20000 }
```

Invalid:

```json
"bad"
[]
{ "maxPages": 0 }
{ "maxResults": "5" }
{ "maxChars": -1 }
{ "site": "example.com" }
{ "format": "markdown" }
{ "unknown": true }
```

Invalid options must throw an invalid effect/payload error from the sanitizer so the caller can classify it correctly.

## 2. Reject `site` and `format`

Reject both for FIX11.

Rationale:

- `site` is not implemented end-to-end. Accepting it creates false assurance that research is scoped to a domain.
- `format` is not consistently implemented end-to-end for research page reads.
- FIX11 should not implement new feature semantics. It should reject unsupported options.

A future feature pass may reintroduce either field only with provider/extension support, UI/approval copy, and tests.

## 3. Approved bulk research invalid options

Invalid approved bulk-research options should follow this path:

```text
parse payload
sanitize/validate parsed.options
validate query/urls
if invalid:
  audit web.bulk_research_payload_invalid
  resolve ok:false
  return

audit web.research_started
call providers
```

Invalid options are not provider failures.

## 4. Provider invalid input error kind

If `pageReaderProvider` detects invalid local caller input such as `maxChars: -1`, the error kind should be:

```text
invalid_request
```

not:

```text
internal_error
```

If the existing error union lacks `invalid_request`, extend it.

## 5. Extension protocol and handler validation

The BrowserClaw-side extension protocol validator and the Chrome service worker should agree on limits:

```text
read_page.maxChars => optional positive integer <= 50_000
read_pages.maxChars => optional positive integer <= 50_000
web_search.maxResults => optional positive integer <= 20
```

Invalid extension messages should return `invalid_request`, not silently default.

## Final Acceptance Criteria

FIX11 is complete only when:

- `sanitizeResearchOptions()` is strict and rejects unsupported/malformed fields.
- direct invalid `web_research.options` resolves/audits as invalid effect payload and does not request approval.
- approved bulk-research invalid options resolve/audit as payload-invalid before `web.research_started`.
- `site` and `format` are rejected in `web_research.options`.
- `pageReaderProvider` uses `invalid_request` for invalid local `maxChars`.
- `src/extension/protocol.ts` validates `read_page/read_pages maxChars`.
- extension direct `web_search.maxResults` validation rejects invalid values instead of defaulting.
- gate evidence is honest.
