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

- [ ] P1 Add `handleReadPages(message)` to `extension/chrome-web-research/service-worker.js`:
  - [ ] Validate `message.urls` is a non-empty array of strings (defensive, already validated by host parser).
  - [ ] Respect `message.maxPages` (default: `urls.length`, cap at 10).
  - [ ] Call `handleReadPage` for each URL sequentially.
  - [ ] Collect results into an array; partial URL failures do not abort the batch.
  - [ ] Return `{ ok: true, requestId: message.requestId, results: [...] }`.
- [ ] P1 Register in handlers registry: `read_pages: handleReadPages`.
- [ ] P1 Tests in `src/extension/protocol.test.ts` or new file:
  - [ ] Single URL batch returns one-element array.
  - [ ] Blocked URL in batch appears as `{ ok: false, error: { kind: 'url_blocked' } }` without aborting.
  - [ ] `maxPages` limit: only the first N URLs fetched.
  - [ ] `parseExtensionRequest` still accepts `read_pages` (existing coverage confirmed).

---

# Part C — Web Research Approval Card

## C1 — Add WebResearchApprovalCard component

- [ ] P1 Create `src/screens/chat/WebResearchApprovalCard.tsx`:
  - [ ] Props: `approval: ApprovalRequest`, `onApprove: (id: string) => void`, `onReject: (id: string) => void`.
  - [ ] Parse `payloadPreview` as JSON to extract `urls: string[]`, `query?: string`, `maxChars?: number`.
  - [ ] Fall back to displaying raw `payloadPreview` text if JSON parse fails.
  - [ ] Show summary: "Read 1 page" / "Read N pages" / "Search: {query} + read N pages".
  - [ ] Show URL list, truncated at 5 with "and N more" overflow.
  - [ ] Show deduplicated domain badges (e.g. `example.com`).
  - [ ] Risk badge (`low` / `med` / `high`) from `approval.risk`.
  - [ ] Approve and Reject buttons.
  - [ ] No "Edit" button (editable URLs require re-validation; defer to v0.2).
- [ ] P1 Add `WebResearchApprovalCard.test.tsx`:
  - [ ] Renders with single URL.
  - [ ] Renders with 6 URLs; shows "and 1 more" truncation.
  - [ ] `bulk_research` approval shows query text.
  - [ ] Risk badge: `low`→neutral tone, `high`→danger tone.
  - [ ] Approve button calls `onApprove` with correct `id`.
  - [ ] Reject button calls `onReject` with correct `id`.
  - [ ] Malformed `payloadPreview` (not JSON) renders without crash.
- [ ] P1 Wire in `ChatScreen.tsx`:
  - [ ] Add `const WEB_APPROVAL_KINDS = new Set(['web_page_read', 'bulk_research'])`.
  - [ ] Import `WebResearchApprovalCard`.
  - [ ] Route `WEB_APPROVAL_KINDS` to `WebResearchApprovalCard` before the generic `ApprovalCard` fallback.
- [ ] P1 Add `WebResearchApprovalCard` to `ChatScreen.test.tsx` (if it exists) or a focused integration test:
  - [ ] `web_page_read` approval in queue renders `WebResearchApprovalCard`.
  - [ ] `bulk_research` approval in queue renders `WebResearchApprovalCard`.
  - [ ] `tool_call` approval still renders `ApprovalCard` (regression guard).

---

# Part D — Content Extraction Unit Tests

## D1 — Unit test extractPageContent

- [ ] P1 Make `extractPageContent` importable for Vitest:
  - [ ] Option A: extract the function to a shared ES module `extension/chrome-web-research/extractPageContent.mjs` (or `.js`); import it in both `service-worker.js` and the test.
  - [ ] Option B: duplicate a pure version under `src/extension/extractPageContent.ts` for testing. Choose A if the build pipeline allows `type: module` in the extension; choose B otherwise.
- [ ] P1 Write tests (`src/extension/extractPageContent.test.ts` or `extension/chrome-web-research/extractPageContent.test.js`):
  - [ ] `og:title` preferred over `<h1>` over `<title>`.
  - [ ] `<script>` and `<style>` tag content removed from output text.
  - [ ] Multiple whitespace/newlines collapsed to single space.
  - [ ] Output longer than `MAX_CHARS` truncated at `MAX_CHARS`.
  - [ ] `finalUrl` returned as passed in.
  - [ ] Empty `<body>` returns result without throwing.
  - [ ] Hostile DOM (`document.querySelectorAll = () => []`) returns degraded but non-throwing result.
  - [ ] `<noscript>` contents excluded from text.

---

# Part E — Final Acceptance Gate

## E1 — Required local commands

- [ ] P0 Run and record:
  - [ ] `pnpm run typecheck`;
  - [ ] `pnpm run lint`;
  - [ ] `pnpm run format:check`;
  - [ ] `pnpm run test`;
  - [ ] `pnpm run test:e2e` (chromium at minimum);
  - [ ] `pnpm run build`;
  - [ ] `cargo test`;
  - [ ] `cargo clippy`.
- [ ] P0 If any command cannot run, document: exact command, exact reason, whether it blocks acceptance, follow-up needed.

## E2 — Security acceptance checklist

- [ ] P0 Brave Search key never in Redux state — verified by test: `store.getState()` JSON after key save contains no `apiKey` / `key` / `secret` / `token` / `plaintext` field.
- [ ] P0 Brave Search key never in Dexie encrypted_secrets as plaintext — verified by test: `db.encrypted_secrets.get('brave_search_api_key')` row `.ciphertext` is not equal to the raw key string.
- [ ] P0 Audit events for web research contain no key material — verified by test: `store.getState().audit.recent` after `web.search_key_saved` event has no key value in any `detail` field.
- [ ] P1 Extension `read_pages` partial-failure does not expose internal errors in unrelated result slots.
- [ ] P1 `WebResearchApprovalCard` does not render the full URL in a way that could be exploited for open-redirect phishing (show domain + path, not a clickable anchor in the approval card).

## E3 — Documentation acceptance

- [ ] P1 Update `memory.md` with FIX2 completion entry (real `date -u` timestamp).
- [ ] P1 Tick evidence comments in this TODO file for all completed items.
- [ ] P1 Update `BROWSERCLAW_WORKSPACE_SCRIPTING_WEBRESEARCH_TODO.md` unchecked items that FIX2 closes:
  - [ ] Line 900 "Add Web Research settings/status UI" → tick after A1+A2 done.
  - [ ] Line 935 "Add approval card for reading search result pages" → tick after C1 done.
  - [ ] Lines 1196-1199 extension read items (if not already ticked) → verify current state.
