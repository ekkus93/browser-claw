# FIX11 Review Notes

## Scope

FIX11 is a hardening pass on the web research plumbing after a code review of
FIX10. No new features were added.

---

## Behavior summary

### Strict `sanitizeResearchOptions()`

`sanitizeResearchOptions()` in `src/runtime/webRunner.ts` now uses
`assertPlainOptionsObject` and `rejectUnknownOptionFields` (already present from
FIX10). The function:

- returns `{}` for `undefined` options;
- throws `WebEffectPayloadError` for non-object, array, or unknown-field inputs;
- explicitly rejects `site` and `format` (not in `RESEARCH_OPTION_FIELDS`);
- validates `maxPages`, `maxResults`, and `maxChars` with
  `normalizeOptionalPositiveIntegerLimit`.

`ResearchOptions` is now a standalone interface (no longer extends
`SearchOptions`); `site` and `format` fields were removed from the type.

### Direct invalid `web_research.options`

When a direct `web_research` effect carries invalid options, the strict
sanitizer throws `WebEffectPayloadError` before any approval is dispatched.
`failInvalidWebEffect` emits `web.effect_payload_invalid` and resolves
`ok: false`. No approval card is shown; no search or read occurs.

### Approved bulk-research invalid options

When an approved bulk-research card carries invalid options in its
`payloadPreview`, the `runApprovedBulkResearch` payload-validation `try` block
catches the thrown `WebEffectPayloadError` and emits
`web.bulk_research_payload_invalid` before `web.research_started`. No provider
is called.

### `pageReaderProvider` `invalid_request` kind

`ERROR_KIND_MAP` now maps extension `invalid_request` → `invalid_request`
(not `internal_error`). The `readPage()` and `readPages()` local `maxChars`
validation paths also return `kind: 'invalid_request'`. Same fix applied to
the `maxPages` validation path. `internal_error` is now reserved for unexpected
failures and malformed extension responses.

`PageReadErrorKind` in `src/webresearch/types.ts` gained the `'invalid_request'`
variant.

### Extension protocol `maxChars` validation

`parseExtensionRequest()` in `src/extension/protocol.ts` now validates optional
`maxChars` for both `read_page` and `read_pages`. Cap: 50,000 (same as the
service-worker `MAX_CHARS`). Invalid values return `{ ok: false, reason }`.

### Extension `web_search.maxResults` rejection

`handleWebSearch()` in the Chrome extension service worker now calls
`validateOptionalMaxResults()` before computing `count`. Invalid `maxResults`
values return `invalid_request` immediately. The hardcoded default `10` was
replaced by `DEFAULT_SEARCH_RESULTS = 10` constant.

---

## Gate evidence (2026-06-30)

| Command | Result |
|---|---|
| `pnpm run typecheck` | PASS |
| `pnpm run lint` | PASS (0 warnings) |
| `pnpm run format:check` | PASS |
| `pnpm test -- --no-file-parallelism` | PASS — 127 test files, 1425 tests |
| `pnpm run test:e2e` | CANNOT RUN — no display/browser in this env; deferred |
| `pnpm run test:extension:e2e` | CANNOT RUN — extension E2E deferred |
| `pnpm run test:extension:e2e:docker` | CANNOT RUN — Docker not available |
| `pnpm run build` | not run — no code-gen changes |
| `cargo test` / `cargo clippy` | not run — no Rust changes |

---

## Extension E2E status

Extension E2E tests cannot run in the current CI/dev environment (no Chrome,
no display). No extension E2E changes were introduced in FIX11 (only JS-level
handler logic). The existing manual QA notes from FIX10 remain the last known
extension state.
