# FIX9 Review Questions — Claude Sonnet 4.6

Before implementing FIX9, I have the following questions and issues to resolve.

---

## 1. "Styling" vs. validation hardening

The FIX9 spec is entirely about validation hardening — options forwarding parity, `maxResults`/`maxChars`
validation, Rust redaction overlap. There is nothing about visual styling in it. The message from the
user indicated that the ChatGPT conversation was about "adding some more styling." Is this the correct
spec, or is there a different or additional document that covers styling?

---

## 2. Asset zip file

The user referred to "the asset zip file." The only zip in the repo is the existing
`docs/browserclaw_text_mockups_handoff.zip` (the original UI mockups and design tokens from the
start of the project). No new zip was found in the commit that added the FIX9 spec and TODO. Is there
a new zip file that should have been included, and if so, what does it contain?

---

## 3. `RuntimeProtocolError` does not exist

The suggested `validateRuntimeWebOptions` implementation in the TODO throws a `RuntimeProtocolError`:

```ts
throw new RuntimeProtocolError(
  'invalid_web_request',
  'web_request.options must be an object.',
);
```

This class does not exist in the codebase. The existing pattern for invalid web requests in
`referenceRuntime.ts` is to emit an inline `event_type: 'runtime.invalid_web_request'` effect
object rather than throwing an exception class. `LimitValidationError` exists in `limits.ts` and
is already used for limit validation.

**Question:** Should `validateRuntimeWebOptions` throw `LimitValidationError` (already exists),
a new `RuntimeProtocolError` class we create, or should it follow the existing inline-effect pattern
(which would mean it cannot be a pure throwing function)?

---

## 4. `MAX_PAGE_CHARS` cap for `maxChars`

There are two different page-chars caps in the codebase:

- `DEFAULT_MAX_PAGE_CHARS = 50_000` — in `src/webresearch/limits.ts`, used for web page reads
- `MAX_PAGE_CHARS = 200_000` — in `src/script/planSchema.ts`, used for workspace scripting file reads

The spec says to validate `options.maxChars` against `MAX_PAGE_CHARS`, but the web research path
uses `DEFAULT_MAX_PAGE_CHARS` (50k). Using the scripting cap (200k) would allow agents to request
4× the intended web page char limit.

**Question:** Which cap should be authoritative for `options.maxChars` in web research requests?
Should we add an explicit `MAX_WEB_PAGE_CHARS` constant to `limits.ts` set to 50,000, or use
`DEFAULT_MAX_PAGE_CHARS` directly?

---

## 5. `MAX_SEARCH_RESULTS` location

The suggested import in the TODO is:

```ts
import { MAX_SEARCH_RESULTS } from '../webresearch/limits';
```

But `MAX_SEARCH_RESULTS = 20` currently lives in `src/webresearch/braveSearch.ts`, not `limits.ts`.

**Question:** Should `MAX_SEARCH_RESULTS` be moved to `limits.ts` (alongside `MAX_BATCH_PAGE_READS`
and `DEFAULT_MAX_PAGE_CHARS`) before FIX9 validation is added, or should it be imported from
`braveSearch.ts` where it currently lives?

---

## 6. `site` and `format` options

The suggested `validateRuntimeWebOptions` includes validation for `site` (non-empty string) and
`format` (`'text' | 'markdown'`). Neither field is used anywhere in the current web research
execution path — no effect handler reads them, no extension protocol sends them, no provider
consumes them.

The spec itself says: "If `site` or `format` is not actually used downstream, remove it from the
supported set and reject it."

**Question:** Should `site` and `format` simply be excluded from `RUNTIME_WEB_OPTION_FIELDS`,
meaning any request containing these fields is rejected as an unknown option? Or is there a plan
to implement them soon enough that they should be accepted and silently passed through for now?

---

## 7. Phase 0 clerical items already done

Phase 0 items A and B say:

```
- [ ] P0 Add `docs/BROWSERCLAW_WORKSPACE_SCRIPTING_WEBRESEARCH_FIX9_SPEC.md`.
- [ ] P0 Add this file as `docs/BROWSERCLAW_WORKSPACE_SCRIPTING_WEBRESEARCH_FIX9_TODO.md`.
```

Both files were already committed in the same commit that added the spec (`b1b6c50`). These can be
ticked immediately with no additional work needed.

**No question here — just confirming these are pre-done.**

---

## Summary of decisions needed

| # | Decision needed |
|---|---|
| 1 | Is FIX9 the right spec, or is there a styling spec missing? |
| 2 | Is there a new asset zip file to include? |
| 3 | What error type should `validateRuntimeWebOptions` throw? |
| 4 | Which `maxChars` cap — `DEFAULT_MAX_PAGE_CHARS` (50k) or `MAX_PAGE_CHARS` (200k)? |
| 5 | Move `MAX_SEARCH_RESULTS` to `limits.ts`, or import from `braveSearch.ts`? |
| 6 | Exclude `site`/`format` from supported fields (reject as unknown)? |
| 7 | Phase 0 A/B items: confirm pre-done — no action needed. |
