# BrowserClaw Workspace/Scripting/WebResearch FIX5 Spec

## Purpose

This is a focused follow-up pass after the FIX4 review.

FIX4 fixed many important protocol-boundary and quiet-fallback problems:

- Rust `readPages.urls` now rejects invalid slots instead of filtering them.
- Rust `tool_call.name` is now required.
- Host `webRunner` has fail-closed validation helpers.
- Bulk research approval parsing is stricter.
- `WebResearchService.readPages()` delegates to provider batch reads.
- Page reader provider rejects `ok:true` empty page content.
- Extension permission status is more honest.
- `waitForTabComplete()` handles already-complete tabs.

However, the latest review found remaining live-path and evidence gaps. FIX5 should close those gaps without adding broad new features.

## Priority Convention

Use the existing project convention:

```text
P0 = security/correctness blocker
P1 = required for feature completeness
P2 = polish, robustness, or future hardening
```

## Core Principle

A fix is not complete if it only fixes one execution path while another live path still has the old quiet fallback.

The following are not acceptable:

```text
Rust rejects invalid readPages.urls, but Plan Runtime filters invalid URL slots.
WebResearchService uses provider.readPages, but Plan Runtime loops over readPage.
Plan memory.search caps snippets, but sandbox memory.search returns full text.
A capability status helper exists, but Settings UI does not use it.
E2E tests exist, but the recorded extension E2E command fails and no Docker pass is recorded.
readPages maxPages intentionally skips URLs but reports them as missing failures.
web_search invalid payload audits web.effect_payload_invalid, but web_page_read uses a different quieter path.
Effect failures become generic "Operation was not completed" content that hides recoverable error kinds.
```

## Scope

### In scope

1. Plan Runtime `web.readPages`:
   - strict URL-array validation;
   - no filtering invalid slots;
   - call `ctx.web.readPages()` once;
   - do not loop over `ctx.web.readPage()` when batch read is available;
   - tests for malformed slots and batch call.

2. Sandbox automated memory search:
   - use the same memory shaping/truncation helper as Plan Runtime;
   - cap non-sensitive memory text;
   - continue excluding sensitive memory;
   - tests for truncation and privacy.

3. Live Settings WebResearch status:
   - wire `normalizeExtensionStatus()` into the actual Settings screen;
   - pass capability-specific status into `WebResearchStatus`;
   - remove misleading host-permission copy;
   - accurately show extension/page/current-tab/search/key readiness.

4. Extension E2E evidence:
   - remove or justify symlinked service worker fixture;
   - use robust service-worker helper everywhere;
   - update all status-schema expectations;
   - run and record Docker extension E2E result;
   - do not claim extension readiness unless a real successful read-page E2E passes.

5. `readPages` `maxPages` behavior:
   - expected result slots should be based on the URLs actually requested/read after maxPages is applied;
   - do not mark intentionally skipped URLs as `missing_result`.

6. Host invalid-effect audit consistency:
   - `web_page_read` invalid URL/payload should audit `web.effect_payload_invalid` consistently.

7. Sanitized failure serialization:
   - failure effect results should produce non-empty structured failure content for the model/user;
   - content must include safe `kind`/`message` fields;
   - content must not leak secrets/raw exception dumps.

8. TODO/evidence reconciliation:
   - update FIX4/FIX5 docs so acceptance does not overstate extension readiness or memory cap coverage.

### Out of scope

- Firefox extension.
- Hosted proxy.
- Local daemon.
- New search providers.
- New broad browser automation.
- Enabling sandboxed scripting if the selected product policy remains "engine present but user-facing disabled".
- Re-architecting Workspace FS.

## Required Behavior by Area

## 1. Plan Runtime `web.readPages` strictness

The Plan Runtime must not silently drop invalid URL slots.

Invalid examples:

```json
{ "op": "web.readPages", "urls": [] }
{ "op": "web.readPages", "urls": ["https://good.example", 42] }
{ "op": "web.readPages", "urls": [""] }
{ "op": "web.readPages", "urls": ["https://good.example", null] }
```

All of these must fail as `PlanOpError` or equivalent before any web provider is called.

Valid `web.readPages` should call the batch web API:

```text
ctx.web.readPages(urls, options)
```

not:

```text
for each url -> ctx.web.readPage(url)
```

## 2. Sandbox memory snippets

Automated memory retrieval must be consistent across:

- LLM context retrieval where applicable;
- Plan Runtime `memory.search`;
- Sandboxed JS Runtime `memory.search`;
- shared memory helpers.

Default behavior:

```text
exclude sensitive memories
cap non-sensitive text to a bounded snippet, recommended 1500 chars
do not include full memory text in audit
```

## 3. Settings status must use the capability model

It is not enough for `normalizeExtensionStatus()` to exist in tests. The live Settings UI must render it.

The UI should distinguish:

```text
Extension: Connected / Not detected
Page reading: Available / Requires pre-granted site access / Unavailable
Host permission request flow: Not available in v0.1, if no extension popup flow exists
Current tab read: Unsupported in v0.1, unless actually implemented and tested
Web search handler: Available / Unavailable
Brave key: Configured / Missing / Vault locked
Live web search: Ready / Not ready
```

Avoid misleading copy such as:

```text
"Each new site asks for host permission first."
```

if BrowserClaw cannot actually complete that permission request flow from v0.1.

## 4. Extension E2E must be proven or scoped out

Extension E2E tests are not accepted merely because test files exist.

A valid acceptance record must include:

```text
exact command
environment
pass/fail
whether extension readiness is accepted or blocked
```

If local headless Chromium fails and Docker is required, then run and record the Docker command. If Docker cannot run, mark extension/page-reader readiness as blocked or explicitly out of acceptance scope.

## 5. `readPages` and `maxPages`

When `maxPages` is used, only the actually requested/read URL subset should be expected in the extension response.

Example:

```text
urls = [a, b, c, d]
maxPages = 2
expected response slots = [a, b]
c and d are intentionally skipped, not missing failures
```

## 6. Failure content must be useful but safe

When an effect fails, the model/user should receive enough sanitized information to recover.

Bad:

```text
Operation was not completed.
```

Better:

```json
{
  "type": "effect_failure",
  "kind": "host_permission_missing",
  "message": "Page read could not run because host permission is missing."
}
```

Rules:

- include safe kind/message;
- omit raw secrets;
- redact token-like strings;
- avoid raw stack traces;
- do not store empty failure content.

## Final Acceptance Criteria

FIX5 is complete only when:

- Plan Runtime `web.readPages` validates URL arrays strictly and calls batch `ctx.web.readPages`.
- Sandbox memory search uses the shared automated memory shaping/truncation helper.
- Settings UI uses capability-specific WebResearch status.
- Misleading host-permission copy is removed.
- Extension E2E uses a real/valid service worker setup and records a successful `read_page` run, or extension readiness is explicitly blocked.
- `readPages(maxPages)` does not report intentionally skipped URLs as missing failures.
- `web_page_read` invalid payloads audit consistently as invalid web effects.
- Failure result content is structured, non-empty, sanitized, and useful.
- TODO evidence comments do not overstate completion.
- No remaining quiet fallback is found in the targeted paths.
