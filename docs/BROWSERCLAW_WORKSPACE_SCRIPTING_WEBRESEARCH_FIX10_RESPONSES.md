# FIX10 Spec/TODO Review — Responses

Covers: `BROWSERCLAW_WORKSPACE_SCRIPTING_WEBRESEARCH_FIX10_SPEC.md` /
`BROWSERCLAW_WORKSPACE_SCRIPTING_WEBRESEARCH_FIX10_TODO.md`

Fill in each `A:` line, then share this file back (or paste your answers).

---

## 1. `readPage` call-site signature in Part C1

Q: `WebResearchService.readPage` is typed as `readPage(url: string, options?: PageReadRequest)` — two
args. The spec's Part C suggested code shows `deps.web.readPage(request)` — one arg. The
single-arg form won't typecheck against the current interface. Should the C1 implementation keep
the existing two-arg call form `deps.web.readPage(url, sanitizeReadOptions(parsed.options, url))`
and simply move `sanitizeReadOptions` (with its new throwing validation) to before the
`web.page_read_started` audit? Or does the spec intend to also change the `WebResearchService`
interface to a single-arg form as part of FIX10?

A:

---

## 2. Audit event name for approved page-read invalid options (Part C1)

Q: When `runApprovedWebPageRead()` rejects invalid `options` (e.g. `maxChars: -1` in the approval
payload), what audit event should be emitted?

- Option A — reuse `web.effect_payload_invalid` via the existing `failInvalidWebEffect()` helper
  (no new event, no new helper needed).
- Option B — emit a new dedicated `web.page_read_payload_invalid` event, parallel to how the
  bulk-research path uses `web.bulk_research_payload_invalid`. This would require a new
  `failInvalidPageReadPayload()` helper.

Which should it be, and if Option B, should `failInvalidPageReadPayload` be a new named helper or
just inline the audit + submit calls?

A:

---

## 3. `DEFAULT_MAX_CHARS` vs `MAX_WEB_PAGE_CHARS` in the extension service worker (Part E)

Q: The extension service worker already defines `DEFAULT_MAX_CHARS = 50_000` (line 20). The spec
suggests adding `MAX_WEB_PAGE_CHARS = 50_000` for use in `validateOptionalMaxChars()`. This would
create two constants with the same value. What should FIX10 do?

- Option A — rename `DEFAULT_MAX_CHARS` to `MAX_WEB_PAGE_CHARS` everywhere in the service worker.
- Option B — add `MAX_WEB_PAGE_CHARS = 50_000` as a second constant alongside `DEFAULT_MAX_CHARS`.
- Option C — keep `DEFAULT_MAX_CHARS` as-is and just reference it inside `validateOptionalMaxChars()`
  without introducing a new constant name.

A:

---

## 4. `maxChars` validation structure in `pageReaderProvider.readPages()` (Part D2)

Q: The spec's suggested D2 code combines `maxPages` and `maxChars` validation in a single try/catch.
If `maxPages` throws first, `effectiveMaxPages` is `undefined`, and the `expectedUrls` calculation
would cover all URLs rather than the validated subset. The spec calls this out but leaves the
resolution open.

The current code already validates `maxPages` in its own earlier try/catch (before computing
`expectedUrls`). The safer approach for D2 is to add `maxChars` validation in a **second
independent try/catch** inserted after the existing `maxPages` try/catch but before
`transport.send` — so `expectedUrls` is always computed from a valid `effectiveMaxPages`.

Should D2 use a second independent try/catch (consistent with existing code structure), or follow
the spec's single combined try/catch (simpler but requires careful ordering)?

A:

---

## 5. Extension test file location for E1/E2 (`read_page` maxChars tests)

Q: Tests for `handleReadPage` already live in `serviceWorkerReadPages.test.ts` (despite the name —
see the C2, C4, D1, D2 describe blocks there). The E1 and E2 tests for `read_page` maxChars
validation could go in either:

- Option A — the existing `serviceWorkerReadPages.test.ts` (following the established pattern
  where that file covers both `handleReadPage` and `handleReadPages`).
- Option B — a new `serviceWorkerReadPage.test.ts` file to separate concerns.

Which do you prefer?

A:
