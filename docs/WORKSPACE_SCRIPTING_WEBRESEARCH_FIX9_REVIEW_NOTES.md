# FIX9 Review Notes

Generated 2026-06-29. Summarises what changed and why. Not a spec.

## A — validateRuntimeWebOptions

`src/runtime/runtimeWebOptions.ts` is the single source of truth for
model-authored web request options in the reference runtime. It validates:

- `maxPages` → cap `MAX_BATCH_PAGE_READS = 10`
- `maxResults` → cap `MAX_SEARCH_RESULTS = 20`
- `maxChars` → cap `MAX_WEB_PAGE_CHARS = 50_000`

Unknown fields (including `site`, `format`) throw
`RuntimeWebOptionsValidationError` with `eventType = 'runtime.invalid_web_request'`.
Non-objects (array, null, string, number) are also rejected.
`undefined` returns `undefined` (no options provided → defaults apply).

`MAX_SEARCH_RESULTS` and `MAX_WEB_PAGE_CHARS` were added to
`src/webresearch/limits.ts`. `braveSearch.ts` re-exports `MAX_SEARCH_RESULTS`
for backward compatibility.

## B — referenceRuntime option forwarding

All four web op branches in `src/runtime/referenceRuntime.ts` now call
`validateRuntimeWebOptions(webRequest.options)`. Valid options are spread into
the emitted effect (`web_search`, `web_page_read`, `web_research`). Invalid
options produce an `audit_append` with `event_type: 'runtime.invalid_web_request'`
and halt the branch — the provider is never called.

The FIX8 `readPages` branch had ad-hoc `maxPages`-only validation via
`normalizeOptionalPositiveIntegerLimit`. That is replaced by the shared
`validateRuntimeWebOptions` call which also covers `maxChars`.

## C — agentBlockParser canonical options

`canonicalizeWebRequestOptions` in `src/script/agentBlockParser.ts` now:

1. Validates `maxChars` with `normalizeOptionalPositiveIntegerLimit` and cap
   `MAX_WEB_PAGE_CHARS`. Invalid values push an error (→ malformed).
2. Validates `maxResults` with `normalizeOptionalPositiveIntegerLimit` and cap
   `MAX_SEARCH_RESULTS`. Invalid values push an error (→ malformed).
3. Rejects unknown fields in `options` object via `KNOWN_WEB_OPTION_FIELDS`
   set — `site`, `format`, or any other unknown field → malformed.
4. Rejects non-object `options` (array, null) → malformed.

Result fields are now only set if validation passes (not `typeof === 'number'`).

## D — Approved bulk-research payload classification

`sanitizeResearchOptions` in `src/runtime/webRunner.ts` was updated to validate
`maxResults` and `maxChars` with `normalizeOptionalPositiveIntegerLimit`
(previously only type-checked `typeof === 'number'` without range check).

`sanitizeResearchOptions(parsed.options)` was moved to the top of the
payload-validation try/catch in `runApprovedBulkResearch()`, before the
url/query validation. Any validation error now audits
`web.bulk_research_payload_invalid` and resolves `ok: false` — the
`web.research_started` event is never emitted and the provider is never called.

## E — Rust sk-ant / sk- precise ownership (Option A)

`redact_sk_tokens` in `crates/claw-core/src/lib.rs` was updated: when called
with `prefix == "sk-"`, it skips any match that starts with `"sk-ant-"`. The
`sk-ant-` specific pass (called first) is the sole owner of Anthropic tokens.
This prevents the generic `sk-` rule from double-counting the prefix when the
`sk-ant-` pass chose not to redact (e.g. below min-suffix threshold).

Existing test `a1_fix7_sk_ant_and_sk_both_redacted` was updated to use a
token with ≥ 12 chars after `sk-ant-` (`sk-ant-apiKey12345678`) so it correctly
passes under Option A semantics.

## Extension E2E

`pnpm run test:extension:e2e` and `test:extension:e2e:docker` cannot run in
this headless environment (`ui/aura/env.cc: The platform failed to initialize`,
no X display / Docker). This is a pre-existing infrastructure constraint, not a
FIX9 regression. Extension E2E is deferred to a display-capable environment.
Extension logic changes (none in FIX9) would require Docker E2E verification.
