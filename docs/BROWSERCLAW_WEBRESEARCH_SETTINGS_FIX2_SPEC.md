# BrowserClaw Web Research Settings & Integration FIX2 Spec

## Purpose

This document defines the **FIX2 correction and integration pass** for BrowserClaw's Web Research
settings, key management, approval UX, and extension protocol completeness.

FIX1 built the backend infrastructure:

- `checkSearchStatus()` probe (G3);
- `createExtensionSearchProvider()` with in-memory key forwarding (G2);
- `BRAVE_DIRECT_CORS_VERIFIED = false` guard (G1);
- `WebResearchStatus` component (G3);
- real `read_page` / `read_current_tab` service-worker handlers (A3/A4);
- all six approval resolvers wired in `main.tsx` (C1–C6);
- all nine effect ports wired in `main.tsx` (C7–C9).

However, the **live Settings UI is not wired to any of this**:

- `SettingsScreen.tsx` passes `searchProvider={{ name: 'Brave Search', configured: false }}`
  (hardcoded) to `WebResearchStatus`.
- There is no UI to enter, save, test, or clear the Brave Search API key.
- The `probe` and `researchPaths` props of `WebResearchStatus` are never populated.
- `read_pages` (batch) is defined in `protocol.ts` and validated by `parseExtensionRequest`,
  but `service-worker.js` has no handler for it — any call returns `unsupported_message_type`.
- `web_page_read` and `bulk_research` approval kinds fall through to the generic `ApprovalCard`
  with no URL/domain/host-permission context shown to the user.

FIX2 closes these gaps.

## Priority Definitions

```
P0 = security/correctness blocker
P1 = required for feature completeness
P2 = polish, robustness, or future-facing hardening
```

## FIX2 Themes

1. Wire `WebResearchStatus` in `SettingsScreen` to live data.
2. Add Brave Search API key entry, save, and probe flow.
3. Implement `read_pages` (batch) handler in `service-worker.js`.
4. Add a specialized `WebResearchApprovalCard` for `web_page_read` and `bulk_research` kinds.
5. Add unit tests for content extraction logic.
6. Run the final acceptance gate and document results.

## Non-Goals

Do not add in this pass:

- Firefox extension;
- proxy or server-side relay for Brave Search;
- arbitrary web automation (form fill, DOM actions, cookie extraction);
- multi-provider search (DuckDuckGo, Serper, etc.) — Brave is the only provider for v0.1;
- OAuth/PKCE key flow — raw API key entry is sufficient for v0.1;
- rate-limit retry logic beyond what already exists;
- real-network E2E fixture page tests — all local hostnames/IPs are blocked by URL safety
  and there is no plan to relax this constraint in v0.1.

## Security Invariants (must hold after FIX2)

```
The Brave Search API key MUST NOT appear in:
  - Redux state (any slice);
  - localStorage or sessionStorage;
  - IndexedDB in plaintext;
  - audit event details;
  - console.log or console.error output;
  - screenshots or UI text.

The key lives in SecretVault (in-memory) only.
It may be stored ENCRYPTED in db.encrypted_secrets (ciphertext + iv only).
It is forwarded to the Chrome extension in-memory via web_search messages only.
```

---

## Part A — Web Research Key Management

### A1 — Brave Search API key entry UI

#### Current Problem

There is no way for the user to enter a Brave Search API key. The `SettingsScreen` "Web research"
section only shows `WebResearchStatus` with hardcoded `configured: false`.

#### Required Behavior

Add a key entry form to the Settings "Web research" section:

- Text input (type `password`) for the Brave Search API key.
- "Save key" button: encrypts the key via `SecretVault` and stores the ciphertext in
  `db.encrypted_secrets` under a fixed label (e.g., `'brave_search_api_key'`).
- "Clear key" button: removes the entry from `db.encrypted_secrets` and from SecretVault.
- "Test connection" button: calls `checkSearchStatus()` with the current in-memory key and
  shows the result (connected / key_locked / provider_unavailable / extension_unavailable).

The vault must already be unlocked for saving/testing. If it is locked, show a "Vault is locked"
message instead.

#### Key Lifecycle

```
User enters key in Settings
  → SecretVault.set('brave_search_api_key', plaintextKey)   [in-memory only]
  → encrypt(plaintextKey) using vault's AES-GCM key
  → db.encrypted_secrets.put({ id: 'brave_search_api_key', ciphertext, iv, label })
  → dispatch secretMetadataUpserted({ id, label, storageMode: 'encrypted' })

App boot / vault unlock:
  → load ciphertext from db.encrypted_secrets
  → decrypt with vault key
  → SecretVault.set('brave_search_api_key', plaintext)

Vault lock:
  → SecretVault clears all in-memory keys (existing behavior)
  → UI shows 'key_locked' state

Key cleared:
  → db.encrypted_secrets.delete('brave_search_api_key')
  → SecretVault.delete('brave_search_api_key')
  → dispatch secretMetadataRemoved('brave_search_api_key')
```

#### Acceptance Criteria

- Key entry form renders in Settings "Web research" section.
- "Save key" stores ONLY ciphertext in Dexie, never plaintext.
- "Clear key" removes ciphertext from Dexie and key from SecretVault.
- `WebResearchStatus` shows `configured: true` after saving a key.
- Vault locked → saving disabled with visible message; status shows `key_locked`.
- Key value NEVER appears in Redux state, localStorage, console.log, or audit events.
- Entering a blank key is rejected (client-side validation).
- Tests assert: key never in Redux state JSON; encrypted_secrets row contains no plaintext.

### A2 — Wire WebResearchStatus to live data

#### Current Problem

```tsx
// SettingsScreen.tsx:499 — hardcoded, never updates
<WebResearchStatus searchProvider={{ name: 'Brave Search', configured: false }} />
```

#### Required Behavior

Replace with live data sources:

- `searchProvider.configured`: true when `SecretVault.has('brave_search_api_key')` and vault
  is unlocked. When vault is locked: show `configured: false` (key availability unknown).
- `probe`: wire to an extension ping via `checkSearchStatus()` (transport from the app's
  `ChromeExtensionTransport` instance). Omit when extension transport is not initialized.
- `researchPaths`: read from the most recent `audit_events` rows where `type` starts with
  `web.` and `detail` contains a workspace path, or an empty array if none.

The component already handles all these cases when props are correctly supplied.

#### Acceptance Criteria

- After saving a key, `WebResearchStatus` shows `configured: true` without page reload.
- Clicking "Check" runs the extension probe and updates the badge live.
- `researchPaths` shows paths from recent web research audit events.
- Tests cover: configured=true after vault key set, configured=false after clear, probe wired.

---

## Part B — Extension `read_pages` Handler

### B1 — Implement `read_pages` in service-worker.js

#### Current Problem

`src/extension/protocol.ts` defines `read_pages` as a valid `ExtensionRequest` type and
`parseExtensionRequest` validates it. However, `extension/chrome-web-research/service-worker.js`
has no `handleReadPages` handler — the message falls to the default `unsupported_message_type`
branch.

`pageReaderProvider.ts`'s `readPages()` currently loops individual `read_page` messages as a
workaround. The `read_pages` protocol message type should be supported for efficiency.

#### Required Behavior

Add `handleReadPages(message)` to `service-worker.js`:

- Validate `message.urls` is a non-empty string array (already guaranteed by
  `parseExtensionRequest` if called by the host, but re-validate defensively).
- Respect `message.maxPages` limit (default: `message.urls.length`, capped at 10).
- Call `handleReadPage` for each URL sequentially; collect results.
- Return `{ ok: true, requestId, results: PageReadResult[] }`.
- Partial failures (one URL fails) do not abort the batch — include the error result in
  the array with `ok: false`.
- Cap total output at `MAX_PAGE_OUTPUT_CHARS * maxPages` (using the existing per-page cap).

Add corresponding handler entry to the `handlers` registry object.

#### Acceptance Criteria

- `read_pages` with one URL returns an array of one result.
- `read_pages` with a blocked URL includes `{ ok: false, error: { kind: 'url_blocked' } }`
  in the results array without failing the whole batch.
- `read_pages` respects `maxPages` — extra URLs are not fetched.
- Existing `read_page` tests still pass.
- New unit tests in `protocol.test.ts` or a new `serviceWorkerMock.test.ts` cover batch behavior.

---

## Part C — Web Research Approval Card

### C1 — Add WebResearchApprovalCard component

#### Current Problem

The approval queue (`state.approvals.queue`) can contain `web_page_read` and `bulk_research`
kinds. `ChatScreen.tsx` routes `plan` and `sandbox_script` to `ScriptApprovalCard` and
everything else — including web research kinds — to the generic `ApprovalCard`.

The generic card shows `payloadPreview` as raw text with no URL context, risk explanation, or
host-permission information. The user cannot make an informed approval decision.

#### Required Behavior

Add `WebResearchApprovalCard` component:

- Shown for approval kinds: `web_page_read`, `bulk_research`.
- Displays:
  - Summary line: "Read 1 page" / "Read N pages" / "Search + read N pages".
  - URL list (or query + URLs for bulk research), one per row, truncated at 5 with "and N more".
  - Domain badges (extracted from URLs, deduped).
  - Risk badge: `low` / `med` / `high` from `approval.risk`.
  - Host permission note: if a URL requires a new host permission, show a yellow warning.
  - Max chars / output cap if present in `payloadPreview`.
- Approve / Reject buttons (same behavior as `ApprovalCard`).
- "Edit" is NOT supported on this card type for v0.1 (web reads are not safely editable at the
  URL level without re-validation).

Parse URL list from `approval.payloadPreview` (JSON string produced by `buildPlanProposal` /
`runApprovedWebPageRead`). Fall back to raw text if JSON parse fails.

Wire in `ChatScreen.tsx`:

```ts
const WEB_APPROVAL_KINDS = new Set(['web_page_read', 'bulk_research']);
```

Route these kinds to `WebResearchApprovalCard` before the generic `ApprovalCard` fallback.

#### Acceptance Criteria

- `web_page_read` approval renders `WebResearchApprovalCard` with URL shown.
- `bulk_research` approval renders with query and URL list.
- Risk badge shows the correct tone.
- Approve/Reject dispatches `approvalResolved`.
- Tests: render with one URL, render with 5+ URLs (truncation), risk badge tones, approve handler.

---

## Part D — Content Extraction Unit Tests

### D1 — Unit test extractPageContent

#### Current Problem

`extension/chrome-web-research/content-extract.js` implements `extractPageContent()`, the core
DOM extraction function. It is plain JavaScript with no tests. It is exercised only through
full Chrome extension E2E, which is deferred or manual.

#### Required Behavior

Add a Vitest unit test suite for the extraction logic:

- Copy / import the pure extraction function into a testable module, OR test it directly by
  loading it as a plain JS module in a jsdom environment.
- Tests must cover:
  - Title extraction: `og:title` preferred over `<h1>` over `<title>`.
  - Script and style tags removed from extracted text.
  - Whitespace normalization (multiple spaces/newlines collapsed).
  - Output capped at `MAX_CHARS` constant.
  - `finalUrl` returned correctly.
  - Non-HTML or empty body does not throw.
  - Hostile DOM (overridden `document.querySelectorAll`) — function still returns a result
    (may be degraded but must not throw).

The extraction function must be deterministic over a given DOM snapshot — no randomness, no
network calls, no timers.

#### Acceptance Criteria

- Vitest tests for `extractPageContent` in `extension/chrome-web-research/` or a mirrored
  file under `src/extension/`.
- All new tests pass.
- Function is importable by the test runner (Vitest / jsdom) without loading Chrome APIs.
- Tests cover title extraction, script stripping, length cap, hostile DOM.

---

## Part E — Final Acceptance Gate

### E1 — Run required commands and document results

Run and record all of:

- `pnpm run typecheck`
- `pnpm run lint`
- `pnpm run format:check`
- `pnpm run test`
- `pnpm run test:e2e` (chromium at minimum)
- `pnpm run build`
- `cargo test`
- `cargo clippy`

Document any failures and whether they block acceptance.

### E2 — Security acceptance

- Brave Search key NEVER in Redux state JSON — verified by a test that calls `store.getState()`
  after `secretMetadataUpserted` and asserts no key/secret/token field.
- Brave Search key NEVER in Dexie `encrypted_secrets.ciphertext` as plaintext — verified by
  test that reads the row and asserts it is not the raw key string.
- Audit events for web research contain no key material — verified by checking
  `store.getState().audit.recent` after a search attempt.

---

## Current State Summary

| Component | Built | Wired | Tested |
|---|---|---|---|
| `checkSearchStatus()` | ✓ | ✗ | ✓ |
| `createExtensionSearchProvider()` | ✓ | ✗ | ✓ |
| `BRAVE_DIRECT_CORS_VERIFIED = false` | ✓ | ✓ | ✓ |
| `WebResearchStatus` component | ✓ | ✗ (hardcoded) | ✓ |
| Brave Search key entry UI | ✗ | — | — |
| Brave Search key SecretVault flow | ✗ | — | — |
| Extension `read_pages` handler | ✗ | — | — |
| `WebResearchApprovalCard` | ✗ | — | — |
| Content extraction unit tests | ✗ | — | — |

## Completion Definition

FIX2 is complete only when:

- P0 tasks are implemented and tested;
- Brave Search key can be saved, tested, and cleared from the Settings UI;
- Key never appears in Redux/Dexie plaintext/console/audit;
- `WebResearchStatus` shows live configured/connected state;
- `read_pages` handler is implemented in `service-worker.js`;
- `WebResearchApprovalCard` renders for `web_page_read` and `bulk_research` kinds;
- Content extraction is unit-tested;
- All available gates pass.
