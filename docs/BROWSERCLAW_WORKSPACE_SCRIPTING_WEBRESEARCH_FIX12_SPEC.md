# BrowserClaw Workspace/Scripting/WebResearch FIX12 Spec

## Purpose

This is a final focused cleanup pass after the FIX11 review.

FIX11 fixed the main high-risk quiet-fallback issue:

- `sanitizeResearchOptions()` is now strict.
- `site` and `format` are rejected.
- trusted `ResearchOptions` no longer carries unsupported fields.
- direct invalid `web_research.options` fails before approval.
- approved bulk-research invalid options are payload-invalid.
- direct extension `web_search.maxResults` no longer silently defaults.

The remaining issues are small but worth fixing before calling the WebResearch hardening series complete:

1. `pageReaderProvider.readPages()` still maps top-level extension `invalid_request` errors to `internal_error`.
2. Chrome service-worker central schema does not validate `web_search.maxResults`; only `handleWebSearch()` does.
3. BrowserClaw-side `src/extension/protocol.ts` accepts `web_search.maxResults` above cap, while the service worker rejects it.
4. TODO evidence overclaims some explicit tests that were not actually present.
5. Gate evidence did not run every required command, especially build/build:wasm/cargo commands.

FIX12 must be narrow. Do not add new product features.

## Priority Convention

```text
P0 = security/correctness blocker
P1 = required for feature completeness
P2 = polish, robustness, or future hardening
```

## Core Principle

Protocol boundaries and provider error mapping must agree.

The following are not acceptable:

```text
extension returns invalid_request for read_pages, but pageReaderProvider reports internal_error.
service-worker handleWebSearch rejects maxResults: 21, but validateMessageSchema accepts it.
BrowserClaw protocol parser accepts maxResults: 21, but service worker rejects it.
TODO says string/non-integer maxChars tests exist when they do not.
Required gate commands are skipped without exact cannot-run evidence.
```

## Scope

### In scope

1. Batch read-pages error-kind mapping:
   - top-level extension `invalid_request` should map to `PageReadResult.error.kind === 'invalid_request'`;
   - malformed extension responses should still map to `internal_error`.

2. Service-worker central `web_search.maxResults` validation:
   - `validateMessageSchema()` should validate optional `maxResults`;
   - direct `handleWebSearch()` validation should remain.

3. BrowserClaw-side protocol `web_search.maxResults` cap validation:
   - `parseExtensionRequest()` should reject `maxResults > 20`;
   - protocol.ts and service-worker should agree.

4. Test/evidence cleanup:
   - add explicit tests for cases previously claimed but not directly tested;
   - or correct TODO evidence comments if a case is intentionally covered indirectly.

5. Gate evidence cleanup:
   - run required commands where possible;
   - otherwise record exact command, exact error, environment reason, and acceptance impact.

### Out of scope

- New search providers.
- New extension features.
- `site` support.
- `format` support.
- UI styling.
- Firefox extension.
- Hosted proxy.
- Local daemon.
- Workspace FS changes.
- Sandbox scripting changes.
- Broad WebResearch rewrites.

## Required Behavior

## 1. `readPages()` top-level extension invalid_request mapping

When the extension returns a top-level error response:

```json
{
  "ok": false,
  "error": {
    "kind": "invalid_request",
    "message": "maxChars must be a positive integer"
  }
}
```

`pageReaderProvider.readPages()` should return one failure per expected URL:

```ts
{
  ok: false,
  url,
  error: {
    kind: 'invalid_request',
    message: 'maxChars must be a positive integer',
    retryable: false
  }
}
```

It must not hardcode this path to `internal_error`.

Malformed extension responses should still be `internal_error`.

## 2. Central service-worker web_search maxResults validation

`validateMessageSchema()` should validate optional `web_search.maxResults`.

Invalid:

```json
{ "type": "web_search", "query": "browser", "maxResults": "5" }
{ "type": "web_search", "query": "browser", "maxResults": 0 }
{ "type": "web_search", "query": "browser", "maxResults": -1 }
{ "type": "web_search", "query": "browser", "maxResults": 1.5 }
{ "type": "web_search", "query": "browser", "maxResults": 21 }
```

Valid:

```json
{ "type": "web_search", "query": "browser" }
{ "type": "web_search", "query": "browser", "maxResults": 5 }
{ "type": "web_search", "query": "browser", "maxResults": 20 }
```

The direct handler should still validate defensively.

## 3. BrowserClaw protocol maxResults cap parity

`src/extension/protocol.ts` should reject `web_search.maxResults > 20`.

Protocol parser and service worker must agree on:

```text
web_search.maxResults => optional positive integer <= 20
read_page.maxChars => optional positive integer <= 50_000
read_pages.maxChars => optional positive integer <= 50_000
```

## 4. Evidence honesty

If the TODO says a named test exists, the test should exist.

If a behavior is only indirectly covered by a type guard or a nearby test, either:

1. add the explicit test; or
2. change the evidence comment to say it is covered by implementation, not by a named test.

For this project, explicit tests are preferred.

## 5. Gate commands

Required commands should be attempted where possible:

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

If a command cannot run, record exact failure details. Do not say “not needed” for required commands unless the command is truly irrelevant because the repo does not contain that tool/workspace.

## Final Acceptance Criteria

FIX12 is complete only when:

- `pageReaderProvider.readPages()` maps top-level extension `invalid_request` to `invalid_request`, not `internal_error`.
- malformed batch extension responses still map to `internal_error`.
- service-worker `validateMessageSchema()` validates `web_search.maxResults`.
- service-worker `handleWebSearch()` still validates `maxResults` defensively.
- `src/extension/protocol.ts` rejects `web_search.maxResults > 20`.
- protocol and service-worker agree on `maxResults` / `maxChars` limits.
- explicit tests exist for previously overclaimed `maxChars` and `maxResults` cases.
- TODO evidence comments accurately match the tests and commands that actually ran.
- gate evidence is honest.
