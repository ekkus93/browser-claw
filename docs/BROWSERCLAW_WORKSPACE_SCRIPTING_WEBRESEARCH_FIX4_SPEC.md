# BrowserClaw Workspace/Scripting/WebResearch FIX4 Spec

## Purpose

This is a focused follow-up pass after the FIX3 review.

FIX3 substantially improved the live BrowserClaw implementation:

- live Brave Search key resolution now uses SecretVault;
- structured effect-result serialization exists in TypeScript and Rust;
- Rust/WASM now understands the main web request operations;
- extension async message handling goes through a central validator;
- Settings status is more capability-specific;
- web page read / extension permission approvals use strict payload parsing;
- Brave key clear failures are visible and audited.

However, the latest review found remaining correctness, reliability, and "quiet fallback" issues. FIX4 should not add broad new product features. It should close the remaining gaps that make the WebResearch/extension/runtime path less reliable than the TODO implies.

## Priority Convention

Use the existing project convention:

```text
P0 = security/correctness blocker
P1 = required for feature completeness
P2 = polish, robustness, or future hardening
```

## Core Principle

BrowserClaw must not silently coerce malformed protocol data into "best effort" defaults.

The following are not acceptable:

```text
missing tool name -> ""
invalid URL slot -> silently dropped
malformed query -> ""
ok:true empty page -> successful read
missing extension service worker -> E2E marked non-blocking
permission flow unsupported -> status says supported
batch read requested -> sequential fallback with no audit
```

Every protocol boundary must either validate and proceed, or fail visibly and audit.

## Scope

### In scope

1. Rust/WASM strict validation parity:
   - `readPages.urls` must reject invalid slots, not filter them.
   - `tool_call.name` must be required and non-empty.
   - invalid/malformed result/request shapes must produce explicit audit/error effects.

2. Host-side fail-closed validation:
   - `webRunner` must not default malformed `query`, `url`, or `urls` to empty values.
   - bulk research approval payloads must validate all URL slots.
   - page reader provider must reject empty/malformed successful page responses.

3. Live `read_pages` behavior:
   - `WebResearchService.readPages()` must delegate to provider-level batch `readPages()` when available.
   - Sequential fallback, if retained, must be explicit and audited.

4. Extension E2E repair:
   - the E2E extension fixture must actually contain/load the service worker.
   - E2E expectations must match the current status schema.
   - E2E must prove successful `read_page` against a fixture page.
   - A failing/missing extension E2E lane must not be counted as extension readiness.

5. Permission/status truthfulness:
   - `permissionRequestSupported` must mean the permission flow can actually complete, not just that a handler exists.
   - If Chrome requires a popup/action/user gesture, implement that flow or mark it unavailable.
   - current-tab read support must be honest.

6. Product policy clarity:
   - decide whether sandboxed scripting is enabled in v0.1 or implemented-but-disabled.
   - Settings/docs/UI must reflect the real policy.

7. Remaining P2 robustness:
   - fix `waitForTabComplete()` race.
   - cap automated memory snippets.

### Out of scope

- Firefox extension.
- Hosted proxy.
- Local daemon.
- Generic browser automation.
- Paywall bypassing.
- Form filling/submission.
- Broad crawling.
- New search providers beyond fixing the current Brave/extension path.
- Rewriting Workspace FS architecture.

## Required Behavior by Area

## 1. Rust/WASM validation must be fail-closed

The Rust runtime must not "fix up" malformed input by filtering, defaulting, or coercing.

### `readPages.urls`

Invalid examples:

```json
{ "op": "readPages", "urls": [] }
{ "op": "readPages", "urls": ["https://good.example", 42] }
{ "op": "readPages", "urls": [""] }
{ "op": "readPages", "urls": ["https://good.example", null] }
```

All of these must emit an invalid-web-request audit/protocol error and must not emit a web effect.

### `tool_call.name`

Invalid examples:

```json
{ "tool_call": { "args": {} } }
{ "tool_call": { "name": "", "args": {} } }
{ "tool_call": { "name": "   ", "args": {} } }
```

All of these must emit `runtime.invalid_tool_call` or equivalent, and must not emit a `tool_call_proposal`.

## 2. Host runners must still validate

Even if the runtime validates, host runners are still security boundaries. `webRunner` must validate effects before calling providers.

Invalid effect payloads must:

```text
audit web.effect_payload_invalid or a more specific event
resolve the runtime effect as failure
not call search/page-reader/research provider
not use empty default values
```

## 3. Batch page reads must be live or explicitly downgraded

If extension provider supports `read_pages`, the live `WebResearchService.readPages()` path must call it.

Sequential fallback is allowed only if:

```text
provider has no batch read capability
fallback is documented
fallback is audited
partial failures are preserved
```

Do not claim `read_pages` is live through the provider if the service loops over `readPage()`.

## 4. Extension successful-read E2E is required for readiness

FIX3's extension E2E lane could not run because of service worker timeout / port issues. FIX4 must resolve this.

Extension E2E must prove:

```text
unpacked extension loads
service worker is present
status schema matches current implementation
read_page succeeds against fixture page
script/style content is not returned as page text
blocked URL still fails
```

If this cannot run in the local environment, document it, but do not mark extension/page-reader readiness complete.

## 5. Permission flow must not overpromise

Chrome host permission requests may require a user gesture from extension UI.

BrowserClaw must distinguish:

```text
read_page handler exists
host permission already granted
host permission missing
host permission request can be completed automatically
host permission request requires extension UI
host permission flow unavailable
```

`permissionRequestSupported` should be true only when BrowserClaw has a working tested path to complete the permission grant.

## 6. Page responses must have usable content

The extension page reader provider must not accept:

```json
{ "ok": true }
{ "ok": true, "text": "" }
{ "ok": true, "content": {} }
{ "ok": true, "results": [{ "ok": true, "url": "x" }] }
```

as successful page content.

If a response is `ok:true`, it must contain non-empty readable text or markdown after trimming. Batch responses must account for every requested URL slot, either success or failure.

## 7. Sandbox product policy must be explicit

The codebase currently has a real QuickJS sandbox, but if the default policy disables it and no Settings/UI path enables it, the product is "engine implemented but user-facing sandbox disabled."

That can be acceptable, but docs/UI/TODO must say so honestly.

Acceptable options:

```text
Option A:
  v0.1 ships sandboxed scripting enabled by default,
  always approval-gated,
  network denied by default,
  secrets denied.

Option B:
  v0.1 includes sandbox engine,
  but user-facing sandbox scripting is disabled behind Settings/Advanced Mode.
```

Pick one and make the code, Settings UI, and TODO match.

## Final Acceptance Criteria

FIX4 is complete when:

- Rust rejects invalid `readPages.urls` slots instead of filtering them.
- Rust rejects missing/empty `tool_call.name`.
- Host web runners reject invalid effects instead of using empty defaults.
- Bulk research approval validates every URL slot.
- `WebResearchService.readPages()` uses provider batch `readPages()` or audits fallback.
- Page reader provider rejects `ok:true` empty/malformed content.
- Extension E2E loads a real service worker and passes successful `read_page`.
- Extension status schema in E2E matches the real implementation.
- Permission support status is truthful.
- Sandbox product policy is explicit and reflected in code/UI/docs.
- `waitForTabComplete()` race is fixed.
- automated memory snippets are capped.
- required gates are run or honestly documented as blocked.

