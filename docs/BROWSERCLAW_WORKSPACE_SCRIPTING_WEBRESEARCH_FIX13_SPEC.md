# BrowserClaw Workspace/Scripting/WebResearch FIX13 Spec

## Purpose

This is a tiny final cleanup pass after the FIX12 review.

FIX12 is functionally acceptable. The last remaining issue is a validation-order inconsistency in the Chrome Web Research extension service worker:

```text
validateMessageSchema() validates web_search.apiKey before web_search.maxResults.
```

That means a malformed message with both a missing/empty `apiKey` and invalid `maxResults` returns `permission_denied` instead of `invalid_request`.

Example:

```json
{
  "type": "web_search",
  "requestId": "r1",
  "query": "browser",
  "maxResults": -1
}
```

Current likely result:

```text
permission_denied: web_search requires a non-empty string apiKey
```

Desired result:

```text
invalid_request: maxResults must be a positive integer...
```

This is not a silent success path. It fails closed. But the central schema validator should classify malformed request shape before credential/permission checks.

Do not broaden this pass.

## Priority Convention

```text
P0 = security/correctness blocker
P1 = required for feature completeness
P2 = polish, robustness, or future hardening
```

## Core Principle

Schema validation should reject malformed request fields before checking credentials or permissions.

In other words:

```text
bad request shape => invalid_request
valid request shape but missing/invalid credential => permission_denied
```

This ordering makes errors deterministic and prevents malformed payloads from being hidden behind authentication/permission failures.

## Scope

### In scope

1. Reorder `web_search` validation in `extension/chrome-web-research/service-worker.js`:
   - validate `query`;
   - validate optional `maxResults`;
   - then validate `apiKey`.

2. Add regression tests:
   - missing `apiKey` + invalid `maxResults` must return `invalid_request`;
   - valid/missing `maxResults` + missing `apiKey` should still return `permission_denied`;
   - invalid query should still return `invalid_request`.

3. Update docs/review notes/gate evidence.

### Out of scope

- New WebResearch features.
- Search provider changes.
- `site` support.
- `format` support.
- Extension protocol redesign.
- Page-read changes.
- Workspace FS changes.
- UI/styling changes.
- Any broad hardening pass beyond this validation-order cleanup.

## Required Behavior

## 1. `web_search` central schema validation order

In `validateMessageSchema()` for `type === 'web_search'`, validation order should be:

```text
1. query shape
2. maxResults shape/range
3. apiKey presence
```

Invalid examples that should return `invalid_request`:

```json
{ "type": "web_search", "query": "", "apiKey": "key", "maxResults": 5 }
{ "type": "web_search", "query": "browser", "maxResults": -1 }
{ "type": "web_search", "query": "browser", "maxResults": 0 }
{ "type": "web_search", "query": "browser", "maxResults": 1.5 }
{ "type": "web_search", "query": "browser", "maxResults": "5" }
{ "type": "web_search", "query": "browser", "maxResults": 21 }
```

Missing `apiKey` should return `permission_denied` only when the request shape is otherwise valid:

```json
{ "type": "web_search", "query": "browser" }
{ "type": "web_search", "query": "browser", "maxResults": 5 }
```

## 2. Direct handler validation remains

Do not remove or weaken direct `handleWebSearch()` validation.

The service worker should continue to validate `maxResults` both centrally and defensively in the direct handler.

## 3. Gate evidence

Run and record the usual gate commands where possible. If a command cannot run, record exact error and environment reason.

## Final Acceptance Criteria

FIX13 is complete only when:

- central `web_search` schema validation checks `maxResults` before `apiKey`;
- missing `apiKey` plus invalid `maxResults` returns `invalid_request`;
- missing `apiKey` plus valid/missing `maxResults` still returns `permission_denied`;
- direct `handleWebSearch()` still validates `maxResults`;
- tests cover the validation-order regression;
- gate evidence is honest.
