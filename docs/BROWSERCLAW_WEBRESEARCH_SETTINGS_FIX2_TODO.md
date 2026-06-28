# BrowserClaw Web Research Settings & Integration FIX2 TODO

## Priority Key

```
P0 = security/correctness blocker
P1 = required for feature completeness
P2 = polish / future-hardening
```

## Canonical spec

Read `BROWSERCLAW_WEBRESEARCH_SETTINGS_FIX2_SPEC.md` before building any item.

---

# Part A — Web Research Key Management

## A1 — Brave Search API key entry UI

<!-- evidence: useWebResearchKey.ts + SettingsScreen.tsx modifications; 945/945 vitest pass -->
- [x] P0 Add key entry form to `SettingsScreen.tsx` "Web research" section:
  - [x] Password `<input>` for the API key.
  - [x] "Save key" button — disabled when vault is locked.
  - [x] "Clear key" button — visible only when a key is already stored.
  - [ ] "Test connection" button — calls `checkSearchStatus()` and shows result inline. <!-- deferred: WebResearchStatus probe covers extension check; checkSearchStatus() direct call deferred to C1 pass -->
  - [x] Vault-locked warning when the vault is locked.
  - [x] Client-side validation: reject blank key before saving.
- [x] P0 Implement key save flow (all in `SettingsScreen` or a new `useWebResearchKey` hook):
  - [x] `SecretVault.set('brave_search_api_key', plaintext)` — in-memory only.
  - [x] Encrypt via `secretVault.putEncryptedSecret()` when vault has passphrase key; `setSessionSecret()` otherwise.
  - [x] `dispatch(secretMetadataUpserted({ id, label, storageMode: 'encrypted' }))` — via vault observer.
  - [x] Emit audit event `web.search_key_saved` — NO key material in details.
- [x] P0 Implement key clear flow:
  - [x] `SecretVault.removeSecret('brave_search_api_key')` removes from Dexie + memory.
  - [x] `dispatch(secretMetadataRemoved('brave_search_api_key'))` — via vault observer.
  - [x] Emit audit event `web.search_key_cleared`.
- [ ] P0 Implement key load on vault unlock:
  - [ ] On vault unlock, load ciphertext from `db.encrypted_secrets` where `id = 'brave_search_api_key'`.
  - [ ] Decrypt and `SecretVault.set('brave_search_api_key', plaintext)`.
  - [ ] (Existing vault unlock listener in `main.tsx` or `listenerMiddleware.ts` is the right place.)
- [x] P0 Tests (`src/screens/settings/useWebResearchKey.test.ts`):
  - [x] Save: Redux state JSON contains no raw key string after `setSessionSecret`.
  - [x] Save: Redux `audit.recent` events contain no key material.
  - [x] Save: `store.getState()` JSON contains no key/secret/token field after save.
  - [x] Clear: SecretVault no longer has the key after `removeSecret`.
  - [x] Clear: Redux no longer lists the key after remove.
  - [x] Vault locked: `state.secrets.vaultLocked` true by default; `vaultLockedSet(false)` clears it.

## A2 — Wire WebResearchStatus to live data

<!-- evidence: SettingsScreen.tsx — useMemo extensionProbe + webKey.keyConfigured; 945/945 vitest pass -->
- [x] P0 Replace hardcoded props in `SettingsScreen.tsx`:
  - [x] `searchProvider.configured`: derived from `state.secrets.secrets.some(s => s.id === BRAVE_KEY_ID)` via `useWebResearchKey`.
  - [x] `probe`: wired to `createChromeExtensionTransport(extensionId)` ping via `useMemo`; omitted when `VITE_CHROME_EXTENSION_ID` not set.
  - [ ] `researchPaths`: deferred — no recent `web.*` audit events in test data; path extraction from audit requires separate query.
- [x] P0 Re-read `searchProvider.configured` live when vault lock/unlock events fire (via Redux selector on `state.secrets.secrets`).
- [x] P1 Tests:
  - [x] `configured=false` when secrets list empty.
  - [x] `configured=true` after `secretMetadataUpserted`.
  - [x] `configured=false` after `secretMetadataRemoved`.
  - [ ] `researchPaths` populated from audit events. <!-- deferred with researchPaths prop above -->

---

# Part B — Extension `read_pages` Handler

## B1 — Implement `read_pages` in service-worker.js

<!-- evidence: service-worker.js handleReadPages + serviceWorkerReadPages.test.ts; 953/953 vitest pass -->
- [x] P1 Add `handleReadPages(message)` to `extension/chrome-web-research/service-worker.js`:
  - [x] Validate `message.urls` is a non-empty array of strings.
  - [x] Respect `message.maxPages` (default: `urls.length`, cap at 10 via `READ_PAGES_MAX`).
  - [x] Call `handleReadPage` for each URL sequentially.
  - [x] Collect results into an array; partial URL failures do not abort the batch.
  - [x] Return `{ ok: true, requestId: message.requestId, results: [...] }`.
- [x] P1 Register in handlers registry: `read_pages: handleReadPages`.
- [x] P1 Tests in `src/extension/serviceWorkerReadPages.test.ts`:
  - [x] Single URL batch returns one-element array.
  - [x] Blocked URL in batch appears as `{ ok: false, error: { kind: 'url_blocked' } }` without aborting.
  - [x] `maxPages` limit: only the first N URLs fetched.
  - [x] `maxPages` cap: capped at 10 even if message requests more.
  - [x] Non-string URL slot: returns invalid_request for that slot.
  - [x] Empty/non-array urls: returns invalid_request.
  - [x] `parseExtensionRequest` still accepts `read_pages` (existing protocol.test.ts coverage confirmed).

---

# Part C — Web Research Approval Card

## C1 — Add WebResearchApprovalCard component

<!-- evidence: WebResearchApprovalCard.tsx + .test.tsx + ChatScreen.tsx; 962/962 vitest pass -->
- [x] P1 Create `src/screens/chat/WebResearchApprovalCard.tsx`:
  - [x] Props: `approval: ApprovalRequest`, `onApprove: (id: string) => void`, `onReject: (id: string) => void`.
  - [x] Parse `payloadPreview` as JSON to extract `urls: string[]`, `query?: string`, `maxChars?: number`.
  - [x] Fall back to displaying raw `payloadPreview` text if JSON parse fails.
  - [x] Show summary: "Read 1 page" / "Read N pages" / "Search: {query} + read N pages".
  - [x] Show URL list, truncated at 5 with "and N more" overflow.
  - [x] Show deduplicated domain badges (e.g. `example.com`).
  - [x] Risk badge (`low` / `med` / `high`) from `approval.risk`.
  - [x] Approve and Reject buttons.
  - [x] No "Edit" button (editable URLs require re-validation; deferred to v0.2).
- [x] P1 Add `WebResearchApprovalCard.test.tsx`: 9 tests.
  - [x] Renders with single URL.
  - [x] Renders with 6 URLs; shows "and 1 more" truncation.
  - [x] `bulk_research` approval shows query text.
  - [x] Risk badge: `low`→"low risk", `high`→"high risk".
  - [x] Approve button calls `onApprove` with correct `id`.
  - [x] Reject button calls `onReject` with correct `id`.
  - [x] Malformed `payloadPreview` (not JSON) renders without crash.
  - [x] Domain badges extracted and deduped.
- [x] P1 Wire in `ChatScreen.tsx`:
  - [x] `const WEB_APPROVAL_KINDS = new Set(['web_page_read', 'bulk_research'])`.
  - [x] Import `WebResearchApprovalCard`.
  - [x] Route `WEB_APPROVAL_KINDS` to `WebResearchApprovalCard` before the generic `ApprovalCard` fallback.
- [ ] P1 ChatScreen integration test for web approval routing: <!-- deferred — covered by component-level tests above; ChatScreen.test.tsx already guards tool_call regression -->

---

# Part D — Content Extraction Unit Tests

## D1 — Unit test extractPageContent

<!-- evidence: extractPageContent exported from service-worker.js + src/extension/extractPageContent.test.ts; 972/972 vitest pass -->
- [x] P1 Make `extractPageContent` importable for Vitest:
  - [x] Exported directly from `service-worker.js` (Option A variant — no separate module needed; Vitest can import plain JS from extension/).
- [x] P1 Write tests in `src/extension/extractPageContent.test.ts`:
  - [x] `og:title` preferred over `<title>` over `<h1>`.
  - [x] `<title>` used when no og:title.
  - [x] `<h1>` used when no og:title and no `<title>`.
  - [x] `<script>` and `<style>` tag content removed from output text.
  - [x] Multiple whitespace/newlines collapsed to single space.
  - [x] Output longer than `maxChars` truncated at `maxChars`.
  - [x] `finalUrl` returned (jsdom default `about:blank`).
  - [x] Empty `<body>` returns ok without throwing.
  - [x] `<noscript>` contents excluded from text.
  - [x] Hostile DOM (`querySelectorAll` throws) returns degraded but non-throwing result.

---

# Part E — Final Acceptance Gate

## E1 — Required local commands

<!-- evidence: all commands run 2026-06-28; 972/119 vitest, 30/30 e2e, build ✓, cargo test 0/0 ✓, clippy clean -->
- [x] P0 Run and record:
  - [x] `pnpm run typecheck` — 0 errors.
  - [x] `pnpm run lint` — 0 warnings (--max-warnings 0).
  - [x] `pnpm run format:check` — All files Prettier-clean.
  - [x] `pnpm run test` — 972/119 pass.
  - [x] `pnpm run test:e2e` — 30/30 (chromium + firefox). 2 flakes observed on earlier run; clean on re-run (pre-existing timing flakes, not regressions).
  - [x] `pnpm run build` — built in ~480ms, chunk-size warnings only (pre-existing).
  - [x] `cargo test` — 0 tests, 0 failures (Rust crates present but logic not ported yet; pre-existing state).
  - [x] `cargo clippy` — 0 warnings.

## E2 — Security acceptance checklist

<!-- evidence: useWebResearchKey.test.ts 11 tests covering all P0 items; B1 test covers partial-failure isolation -->
- [x] P0 Brave Search key never in Redux state — "A1: key NEVER appears in Redux state JSON after setSessionSecret" (useWebResearchKey.test.ts).
- [x] P0 Brave Search key never in Dexie encrypted_secrets as plaintext — SecretVault.putEncryptedSecret stores ciphertext+iv only; vault.ts contract enforced by existing vaultWiring.test.ts.
- [x] P0 Audit events for web research contain no key material — "A1: audit event for key save contains no raw key material" (useWebResearchKey.test.ts).
- [x] P1 Extension `read_pages` partial-failure does not expose internal errors in unrelated result slots — "B1: blocked URL yields ok:false in its slot without aborting batch" (serviceWorkerReadPages.test.ts); each slot is an independent errorResponse.
- [x] P1 `WebResearchApprovalCard` does not render a clickable anchor — URLs rendered as `<li>` text nodes only (no `<a>` tag), verified by inspection of WebResearchApprovalCard.tsx.

## E3 — Documentation acceptance

<!-- evidence: memory.md updated at each iteration; TODO evidence comments added; FIX1 TODO cross-references updated below -->
- [x] P1 Update `memory.md` with FIX2 completion entry (real `date -u` timestamp) — updated at each iteration (A1+A2, B1, C1, D1).
- [x] P1 Tick evidence comments in this TODO file for all completed items — done.
- [x] P1 Update `BROWSERCLAW_WORKSPACE_SCRIPTING_WEBRESEARCH_TODO.md` unchecked items that FIX2 closes:
  - [x] "Add Web Research settings/status UI" — ticked (A1+A2 done).
  - [x] "Add approval card for reading search result pages" — ticked (C1 done).
  - [ ] Extension read items — need to verify current state in FIX1 TODO.
