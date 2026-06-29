# FIX10 Review Notes

Generated: 2026-06-29T23:52:47Z — Claude Sonnet 4.6

---

## Scope

Narrow hardening pass — strict `webRunner` search and page-read sanitizers; approved
single-page-read invalid options classified as `web.page_read_payload_invalid`;
`pageReaderProvider` validates `maxChars` for `readPage` + `readPages`; Chrome
extension validates `maxChars` for `read_page` + `read_pages`; gate evidence hygiene.

---

## Part A — Strict search option sanitizers (webRunner)

`sanitizeSearchOptions()` now uses two shared helpers:

- `assertPlainOptionsObject(input, label)` — returns `{}` for `undefined`, throws
  `WebEffectPayloadError` for non-objects or arrays.
- `rejectUnknownOptionFields(input, allowed, label)` — throws for any key not in
  the allowed set.
- `SEARCH_OPTION_FIELDS = new Set(['maxResults'])` — only `maxResults` is allowed;
  `site` and all other fields are rejected.

Invalid `web_search` options are now resolved/audited as `web.effect_payload_invalid`
before `web.search_started`. 8 tests added (A1/A2).

---

## Part B — Strict page-read option sanitizers (webRunner)

`sanitizeReadOptions()` now uses the same helpers:

- `PAGE_READ_OPTION_FIELDS = new Set(['maxChars'])` — only `maxChars` is allowed;
  `format`, `timeoutMs`, and all other fields are rejected.

For **direct** (pre-approval) `web_page_read` effects, options are now validated in a
dedicated try/catch before `approvalRequested` is dispatched. Invalid options are
resolved/audited as `web.effect_payload_invalid` and do not queue an approval. 10
tests added (B1/B2).

---

## Part C — Approved page-read payload validated before web.page_read_started

New helper `failInvalidPageReadPayload(deps, approval, error)`:

- Audits `web.page_read_payload_invalid` (dedicated event, distinct from
  `web.effect_payload_invalid` used by the direct-effect path).
- Resolves effect as `ok: false` with `kind: 'web_invalid_payload'`.

`runApprovedWebPageRead()` restructured — one consolidated try/catch covers:
1. `parseApprovalPayloadObject()` — parse the stored JSON
2. `requireStringField(parsed, 'url')` — extract URL
3. `classifyFetchUrl(url).ok` check — reject blocked URLs
4. `sanitizeReadOptions(parsed.options, url)` — validate `maxChars`

The `web.page_read_started` audit now fires only after all payload validation passes.
5 new C1 tests; 4 existing G1+F1 tests updated to check the new
`web.page_read_payload_invalid` event (they previously expected
`web.effect_payload_invalid`).

---

## Part D — pageReaderProvider maxChars validation

New helper `normalizeOptionalMaxChars(value)` wraps `normalizeOptionalPositiveIntegerLimit`
with `max: MAX_WEB_PAGE_CHARS`.

- **`readPage()`** — validates `maxChars` before `exchange()`. Invalid `maxChars`
  returns `{ ok: false, url, error: { kind: 'internal_error', ... } }` without
  calling the transport. 4 tests (D1).
- **`readPages()`** — second independent try/catch for `maxChars` after the existing
  `maxPages` try/catch and `expectedUrls` computation. Invalid `maxChars` maps
  `expectedUrls` to `ok:false` without calling transport. 5 tests (D2).

---

## Part E — Extension service-worker maxChars validation

New helper `validateOptionalMaxChars(value)` wraps `validateOptionalPositiveIntegerLimit`
with `DEFAULT_MAX_CHARS` as the cap.

- **Central (`validateMessageSchema`)** — validates `maxChars` for both `read_page`
  and `read_pages` message types. Rejects zero, negative, non-integer, above-cap,
  and string values. (E1/E2)
- **Direct (`handleReadPage`)** — defense-in-depth check after URL validation, before
  safety/permission/tab logic. (E3)
- **Direct (`handleReadPages`)** — defense-in-depth check after `maxPages` validation,
  before per-URL loop. (E3)

`validateOptionalMaxChars` exported from `service-worker.js` and declared in
`service-worker.d.ts`. 20 tests added (E1/E2/E3) in `serviceWorkerReadPages.test.ts`.

---

## Gate results

| Command | Result |
|---|---|
| `pnpm run typecheck` | PASS |
| `pnpm run lint` | PASS (0 warnings) |
| `pnpm run format:check` | PASS |
| `pnpm test -- --no-file-parallelism` | PASS — 1388 tests, 127 files |
| `pnpm run test:e2e` | PASS — 30/30 |
| `pnpm run test:extension:e2e` | FAIL — 5 Chromium extension tests fail in this environment (Chromium extension API unavailable); passes in Docker |
| `pnpm run test:extension:e2e:docker` | PASS — 5/5 |
| `pnpm run build` | PASS (chunk size warning only — pre-existing) |
| `pnpm run build:wasm` | PASS |
| `cargo test --workspace` | PASS (0 tests — Rust workspace has no tests yet) |
| `cargo clippy --workspace --all-targets -- -D warnings` | PASS |

The 5 chromium extension E2E failures in `test:extension:e2e` are a pre-existing
environment issue (Chromium headless extension API not available); the same 5 tests
pass in Docker (`test:extension:e2e:docker`). This is unchanged from prior FIX9
gate runs — no regression.
