# BrowserClaw Workspace/Scripting/WebResearch FIX8 Spec

## Purpose

This is a narrow hardening pass after the FIX7 review.

FIX7 fixed the large remaining issues around Rust failure redaction and `maxPages` validation in many paths. However, the latest review found a few still-loose schema and egress-control paths:

1. `browserclaw-web` blocks can carry top-level `maxPages`, but runtime/web effects expect nested `options.maxPages`.
2. `referenceRuntime` validates nested `options.maxPages`, but can drop `options` when emitting web effects.
3. `createWebEffectHandler()` can throw during option sanitization before auditing/resolving the runtime effect.
4. Extension `handleReadPages()` can still treat invalid direct-call `maxPages` as "read all" if bypassing central validation.
5. Rust redaction is now leak-safe for multiple secrets, but can over-redact ordinary words containing `sk-`.

FIX8 should be small and precise. Do not add broad new features.

## Priority Convention

Use the existing BrowserClaw convention:

```text
P0 = security/correctness blocker
P1 = required for feature completeness
P2 = polish, robustness, or future hardening
```

## Core Principle

Limits and safety checks must survive every representation boundary.

The following are not acceptable:

```text
browserclaw-web maxPages is accepted but silently ignored.
A runtime validates options.maxPages then drops options before the web effect.
An invalid maxPages causes an uncaught exception instead of an audited effect failure.
Central extension validation rejects bad maxPages, but direct handler calls read all URLs.
Secret redaction avoids leaks but mangles common non-secret words such as risk-level or task-id.
```

## Scope

### In scope

1. Canonical `browserclaw-web` option normalization:
   - validate top-level `maxPages`, `maxChars`, and `maxResults` where applicable;
   - convert top-level limit fields into `options`;
   - make runtime/web effect paths use one normalized shape;
   - reject invalid `maxPages` at parse time.

2. Reference runtime option forwarding:
   - after validating nested `options`, forward the normalized options into emitted web effects;
   - ensure `search`, `readPage`, `readPages`, and `research` preserve intended limits;
   - tests for option preservation.

3. Web runner failure handling:
   - wrap `sanitizeResearchOptions()` and related option sanitizers;
   - invalid `maxPages` should audit `web.effect_payload_invalid` or approval-payload-specific error;
   - resolve the runtime effect with `ok:false`;
   - never throw out of the effect handler for user/model-supplied malformed options.

4. Extension service-worker handler defense-in-depth:
   - `handleReadPages()` should validate `maxPages` itself, even if central validation also does;
   - invalid direct calls should return structured `invalid_request`, not read all URLs;
   - direct handler tests should verify this.

5. Rust redaction precision:
   - either switch Rust redaction to regex parity with TypeScript, or add boundary/min-length checks;
   - avoid redacting normal words containing `sk-`;
   - keep multi-secret leak protection.

6. Evidence:
   - rerun required commands;
   - rerun Docker extension E2E if possible;
   - record exact pass/fail status.

### Out of scope

- New browser automation features.
- Firefox extension.
- Hosted proxy.
- Local daemon.
- New search providers.
- Enabling sandbox scripting if policy remains disabled.
- Rewriting WebResearch architecture.
- Rewriting Workspace FS.

## Required Behavior

## 1. Canonical web request options

The app should accept model-authored `browserclaw-web` blocks with top-level convenience fields, but runtime effects should use a canonical nested `options` object.

Input example:

```json
{
  "type": "browserclaw_web_request",
  "version": 1,
  "op": "readPages",
  "urls": ["https://a.example", "https://b.example"],
  "maxPages": 1,
  "maxChars": 20000
}
```

Canonical internal shape:

```json
{
  "op": "readPages",
  "urls": ["https://a.example", "https://b.example"],
  "options": {
    "maxPages": 1,
    "maxChars": 20000
  }
}
```

Invalid examples:

```json
{ "op": "readPages", "urls": ["https://a.example"], "maxPages": 0 }
{ "op": "readPages", "urls": ["https://a.example"], "maxPages": -1 }
{ "op": "readPages", "urls": ["https://a.example"], "maxPages": 1.5 }
{ "op": "readPages", "urls": ["https://a.example"], "maxPages": "2" }
```

All must be malformed/protocol errors and must not emit a web effect.

## 2. Reference runtime must preserve validated options

If the runtime receives:

```json
{
  "web_request": {
    "op": "readPages",
    "urls": ["https://a.example", "https://b.example"],
    "options": { "maxPages": 1 }
  }
}
```

then the emitted effect must include:

```json
{
  "type": "web_research",
  "mode": "urls",
  "urls": ["https://a.example", "https://b.example"],
  "options": { "maxPages": 1 }
}
```

Do not validate and then discard the option.

## 3. Invalid options must fail visibly

`createWebEffectHandler()` must not throw due to malformed `effect.options`. It should:

```text
audit web.effect_payload_invalid
resolve the effect as ok:false
not dispatch approval cards
not call providers
```

## 4. Extension handler defense-in-depth

`validateMessageSchema()` should reject malformed `read_pages`, but `handleReadPages()` should also validate direct-call input because tests and future refactors may call it directly.

Invalid direct call:

```js
handleReadPages({
  type: "read_pages",
  requestId: "x",
  urls: ["https://a.example", "https://b.example"],
  maxPages: 0
})
```

must return:

```json
{ "ok": false, "error": { "kind": "invalid_request", ... } }
```

not read all pages.

## 5. Rust redaction precision

Rust redaction must keep the leak protection from FIX7 while avoiding obvious false positives.

Must not redact ordinary non-secret text like:

```text
risk-level
task-id
ask-for-help
disk-cache
```

Must still redact:

```text
sk-123456789012
sk-ant-123456789012
Bearer abc.def.ghi
Authorization: Bearer abc.def.ghi
```

Recommended implementation: use the `regex` crate if acceptable, or implement conservative boundary/minimum-length logic.

## Final Acceptance Criteria

FIX8 is complete only when:

- `browserclaw-web` top-level `maxPages` is validated and propagated into canonical `options`.
- Invalid top-level `maxPages` is rejected before a web effect is emitted.
- `referenceRuntime` forwards validated options into `web_search`, `web_page_read`, and `web_research` effects.
- `createWebEffectHandler()` catches invalid option errors and resolves/audits them.
- Direct `handleReadPages()` calls reject invalid `maxPages`.
- Rust redaction does not leak multiple secrets and does not mangle common safe words containing `sk-`.
- Docker extension E2E result is recorded after FIX8 changes, or explicitly marked unverified.
- TODO evidence comments accurately distinguish implemented, deferred, and externally unverified items.
