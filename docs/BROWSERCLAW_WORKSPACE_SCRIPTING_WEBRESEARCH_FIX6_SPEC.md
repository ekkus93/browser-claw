# BrowserClaw Workspace/Scripting/WebResearch FIX6 Spec

## Purpose

This is a focused follow-up pass after the FIX5 review.

FIX5 fixed most of the targeted live-path gaps:

- Plan Runtime `web.readPages` now validates URL arrays strictly.
- Plan Runtime `web.readPages` calls the batch `ctx.web.readPages()` path.
- Sandbox `memory.search` now uses shaped/capped memory snippets.
- Settings now wires capability-specific WebResearch status.
- `readPages(maxPages)` no longer treats intentionally skipped success-path URLs as missing failures.
- `web_page_read` invalid payloads now audit `web.effect_payload_invalid`.
- TypeScript reference runtime now serializes structured effect failures.
- Extension E2E scaffolding and Docker evidence are much stronger.

However, the FIX5 review found a few remaining issues. These are smaller than previous rounds, but they are still important because they follow the same pattern: one path was hardened while another path remains loose, stale, or opaque.

FIX6 should close those remaining gaps without adding broad new features.

## Priority Convention

Use the existing BrowserClaw priority convention:

```text
P0 = security/correctness blocker
P1 = required for feature completeness
P2 = polish, robustness, or future hardening
```

## Core Principle

Do not leave a second runtime or alternate path with older, looser behavior.

The following are not acceptable:

```text
TypeScript runtime gives structured failure content, but Rust/WASM stores "Operation was not completed."
Plan Runtime validates readPages URLs, but TypeScript reference runtime raw web_request readPages accepts invalid slots.
Settings computes capability status only when probing extension, then shows stale live search readiness after key/vault changes.
Rejected bulk-research approval is reported as malformed payload because payload is parsed before rejection handling.
readPages success path honors maxPages, but top-level extension error path reports failures for URLs that were intentionally skipped.
TODO says Docker E2E passed, but the exact command/result is not reproducible or easy to rerun.
```

## Scope

### In scope

1. Rust/WASM structured failure serialization:
   - add Rust equivalent of `toolContentFromEffectFailure`;
   - replace generic failure messages;
   - redact token-like strings;
   - add Rust tests.

2. TypeScript reference runtime raw `readPages` validation:
   - validate every URL slot;
   - reject missing/non-array/empty/non-string/empty URL slots;
   - reject unsafe URLs;
   - do not emit `web_research` with invalid URLs.

3. Settings WebResearch capability status freshness:
   - store raw extension status separately;
   - derive normalized capability status from raw status + current key/vault state;
   - update automatically when key configured/cleared or vault locks/unlocks.

4. Bulk research rejection ordering:
   - if approval is rejected, handle rejection before parsing payload;
   - a rejected malformed approval must be `user_rejected`, not `payload_invalid`.

5. `readPages(maxPages)` top-level failure consistency:
   - compute `expectedUrls` once;
   - use it for success mapping, invalid top-level response, transport failure, extension unavailable, and missing slots;
   - intentionally skipped URLs must not appear as failures.

6. Minor cleanup:
   - remove duplicate `script_request` union entry if present;
   - ensure TODO evidence comments do not mark deferred Rust/WASM work complete.

7. Gate/evidence:
   - record exact Docker extension E2E command/result again after changes;
   - if command cannot run, say exactly what remains unverified.

### Out of scope

- Firefox extension.
- Hosted proxy.
- Local daemon.
- New search providers.
- New browser automation features.
- Enabling sandboxed scripting if product policy remains disabled-by-default.
- Re-architecting the Workspace FS or WebResearch provider stack.

## Required Behavior by Area

## 1. Rust/WASM structured failure serialization

The Rust/WASM runtime must produce structured, sanitized, non-empty failure content, equivalent to the TypeScript helper.

Bad content:

```text
Operation was not completed.
Tool call was not completed.
```

Good content:

```json
{
  "type": "effect_failure",
  "kind": "host_permission_missing",
  "message": "Page read could not run because host permission is missing.",
  "retryable": false
}
```

Rules:

- `type` must be `"effect_failure"`;
- `kind` must be safe and non-empty, defaulting to `"effect_failed"`;
- `message` must be safe and non-empty, defaulting to `"The requested operation failed."`;
- token-like strings must be redacted;
- raw stack traces must not be included;
- no empty failure content should be stored or sent to follow-up LLM calls.

## 2. TypeScript reference runtime raw `readPages` validation

The reference runtime must not rely on upstream parser validation.

Invalid raw LLM result examples:

```json
{ "web_request": { "op": "readPages", "urls": [] } }
{ "web_request": { "op": "readPages", "urls": ["https://good.example", 42] } }
{ "web_request": { "op": "readPages", "urls": [""] } }
{ "web_request": { "op": "readPages", "urls": ["http://localhost/private"] } }
```

Each must emit an invalid web request audit/protocol error and must not emit a `web_research` effect.

## 3. Settings capability status freshness

The live Settings UI should not store a normalized capability snapshot that can go stale after key/vault changes.

Preferred model:

```text
rawExtensionStatus = last extension probe response
webKey state = live key/vault state
capabilityStatus = derived via useMemo(rawExtensionStatus, webKey.keyConfigured, webKey.vaultLocked)
```

If the user clears the Brave key, `liveSearchReady` must update to false without requiring another extension probe.

If the vault locks, `liveSearchReady` must update to false without requiring another extension probe.

## 4. Rejected approvals should not require valid payloads

For approval handlers, the order should be:

```text
if approval.status !== "approved":
  audit rejection
  resolve user_rejected
  return

parse/validate payload only for approved approvals
```

A rejected malformed payload should not become a payload-invalid error.

## 5. `readPages(maxPages)` should use `expectedUrls` everywhere

Compute once:

```ts
const expectedUrls = request.urls.slice(
  0,
  typeof request.maxPages === 'number'
    ? Math.min(request.maxPages, request.urls.length)
    : request.urls.length,
);
```

Use `expectedUrls` for:

- successful slot mapping;
- missing slot detection;
- top-level extension error fallback;
- invalid top-level response fallback;
- extension unavailable fallback.

Example:

```text
urls = [a, b, c, d]
maxPages = 2
transport failure occurs
failures should be for [a, b], not [a, b, c, d]
```

## 6. Evidence must be reproducible

If FIX5 claimed Docker extension E2E passed, FIX6 should keep that evidence reproducible and current.

Record:

```text
exact command
environment
pass/fail result
test count
whether extension readiness is accepted
```

## Final Acceptance Criteria

FIX6 is complete only when:

- Rust/WASM structured failure serialization is implemented and tested.
- TypeScript reference runtime raw `readPages` rejects invalid slots and unsafe URLs.
- Settings capability status updates when key/vault state changes without requiring a new extension probe.
- Rejected bulk-research approval is handled before payload parsing.
- `readPages(maxPages)` top-level failures use `expectedUrls`.
- Duplicate `script_request` union entry is removed if present.
- Docker extension E2E result is recorded after the changes.
- TODO evidence comments accurately distinguish implemented, deferred, and externally unverified items.
- No remaining targeted quiet fallback paths are found.
