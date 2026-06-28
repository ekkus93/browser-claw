# BrowserClaw Workspace/Scripting/WebResearch FIX3 Spec

## Purpose

This FIX3 pass corrects the remaining live-path and silent-failure issues found after reviewing the latest BrowserClaw implementation against `BROWSERCLAW_WORKSPACE_SCRIPTING_WEBRESEARCH_FIX2_TODO(1).md`.

FIX2 made substantial progress: Rust/WASM effect variants now exist, sandbox scripting is policy-gated, extension `read_page` is mostly real, research bundles expose page failures, sandbox tool calls are safer, missing tool descriptors deny by default, and grep/range/skill transaction hardening is present.

However, several checked items still have live-path gaps or dangerous fallbacks. FIX3 is intentionally narrow: do not add broad new features until these correctness issues are fixed.

## Non-negotiable outcomes

1. **Live web search must actually use the saved Brave key.**
   - Settings already saves a canonical search key.
   - Runtime search must resolve that key at request time and pass it to the extension search provider.
   - A configured key in Settings must correspond to a usable live provider, or the UI must say why it is unusable.

2. **Successful web/search/page/research results must never become empty tool messages.**
   - The Rust/WASM runtime and TypeScript reference runtime must serialize structured host results into non-empty tool content.
   - `{ ok: true, results }`, `{ ok: true, content }`, `{ ok: true, bundle }`, and extension success payloads must produce meaningful text/JSON for the follow-up LLM call.
   - Missing or unserializable success results must fail visibly with audit, not `""`.

3. **Rust/WASM and TypeScript web-request validation must be identical and fail-closed.**
   - Missing/empty `op`, `query`, `url`, or `urls` must produce `runtime.invalid_web_request` / protocol failure.
   - No runtime path may emit `web_search(query="")`, `web_page_read(url="")`, or `web_research(query="")`.

4. **The model-facing web block contract must match the runtime.**
   - Either `research` and `readPages` are supported end-to-end, or they are removed from runtime result handling and documented as unsupported.
   - This spec chooses to support them end-to-end.

5. **All extension external messages must go through one validation path.**
   - Async service-worker handlers must not bypass central validation.
   - Sender/origin, message object shape, `type`, `requestId`, handler existence, and payload schema must be enforced consistently.

6. **Extension/web-research status must be capability-specific and truthful.**
   - “Extension connected” must not imply page reading, web search, or current-tab read are available.
   - Show separate status for installed/connected, page-reading support, host-permission flow, web-search handler support, key configured, and live search usable.

7. **Remaining silent fallbacks must be removed.**
   - Strict approval payload parsing must be used for web page read and extension permission approvals.
   - Brave key clear failures must be visible/audited.
   - `read_pages` must either be used by the app provider or marked extension-only.
   - `waitForTabComplete()` must not false-timeout if a tab completes before listener attachment.

## Current known problems to fix

### Problem 1 — Search provider is wired without the Brave key

`main.tsx` constructs `createConfiguredSearchProvider(...)`, but the live provider does not pass `secretVault`, `db`, or a resolved `apiKey` into extension search. The extension handler requires an API key per request, so live web search fails with `permission_denied: no API key provided` even when Settings shows the key as configured.

### Problem 2 — Structured web effect results become empty tool messages

The host resolves web effects with structured shapes such as:

```ts
{ ok: true, results }
{ ok: true, content }
{ ok: true, bundle }
```

The Rust and TypeScript runtimes currently look for a top-level `text` field. If none exists, they store an empty tool message and continue with an empty LLM prompt. This is a severe quiet failure.

### Problem 3 — Web-request validation is incomplete in Rust/WASM

Rust still uses `unwrap_or("")` / `unwrap_or_default()` style fallback for web request fields. That violates the FIX2 requirement that malformed web requests fail closed.

### Problem 4 — `research` / `readPages` are inconsistent

Runtime code claims to support `research` and `readPages`, but the model-facing `browserclaw-web` parser rejects those ops. Also, runtime routing collapses `readPages` and `research` into `web_research` with only a `query`, losing explicit URL arrays.

### Problem 5 — Extension async handlers bypass central validation

`onMessageExternal` manually dispatches async handlers before calling the central `handle(message)` validator. This creates two validation paths and allows malformed messages to reach handlers directly.

### Problem 6 — Status UI is too optimistic

Settings treats any successful `get_status` response as “available/connected.” It does not check page-reading capability, host-permission flow, web-search handler support, or key configuration together.

### Problem 7 — Remaining lenient parsing and broad catches

`runApprovedWebPageRead()` and `runApprovedExtensionPermission()` still use lenient `tryParseApprovalPayload()` patterns. `useWebResearchKey.clearKey()` catches all errors and treats them as harmless.

## Desired model-facing web block contract

`browserclaw-web` blocks support exactly these operations in v0.1:

```ts
type BrowserClawWebRequest =
  | {
      type: 'browserclaw_web_request';
      version: 1;
      op: 'search';
      query: string;
      maxResults?: number;
    }
  | {
      type: 'browserclaw_web_request';
      version: 1;
      op: 'readPage';
      url: string;
      maxChars?: number;
    }
  | {
      type: 'browserclaw_web_request';
      version: 1;
      op: 'readPages';
      urls: string[];
      maxPages?: number;
      maxChars?: number;
    }
  | {
      type: 'browserclaw_web_request';
      version: 1;
      op: 'research';
      query: string;
      maxResults?: number;
      maxPages?: number;
      maxChars?: number;
    }
  | {
      type: 'browserclaw_web_request';
      version: 1;
      op: 'readCurrentTab';
      maxChars?: number;
    };
```

Validation rules:

- `query` must be a non-empty string for `search` and `research`.
- `url` must be a non-empty URL string for `readPage` and must pass existing URL safety classification.
- `urls` must be a non-empty string array for `readPages`; each URL must pass URL safety classification.
- `readCurrentTab` is allowed as a request shape, but v0.1 may route to an explicit `current_tab_read_unavailable` extension result.
- Unknown ops must be malformed/protocol errors, not normal assistant text.

## Desired runtime effect mapping

Both Rust/WASM and TypeScript reference runtime must map validated web requests as follows:

```text
op: search         -> web_search
op: readPage       -> web_page_read
op: readPages      -> web_research with mode/readPages OR dedicated web_pages_read effect
op: research       -> web_research
op: readCurrentTab -> extension_request { op: 'read_current_tab' }
invalid request    -> audit_append runtime.invalid_web_request
unknown op         -> audit_append runtime.unknown_web_request
```

Prefer adding a distinct `web_pages_read` effect if that fits the existing architecture cleanly. If that is too invasive, `web_research` may carry a discriminated payload:

```ts
type WebResearchEffect =
  | { type: 'web_research'; id: string; mode: 'query'; query: string; options?: WebResearchOptions }
  | { type: 'web_research'; id: string; mode: 'urls'; urls: string[]; options?: WebResearchOptions };
```

Do not map explicit URL arrays to `query: ''`.

## Desired effect-result serialization

After the host resolves a web/search/page/research/extension effect, the runtime must serialize success results into useful tool content before storing the tool message and issuing the next LLM request.

Required success input shapes:

```ts
{ ok: true, text: string }
{ ok: true, results: SearchResult[] }
{ ok: true, content: PageContent }
{ ok: true, contents: PageContent[] }
{ ok: true, bundle: ResearchBundle }
{ ok: true, response: ExtensionResponse }
```

Required behavior:

- If `text` is present and non-empty, use it.
- If structured data is present, serialize a compact JSON envelope with a `type` field.
- If all candidate fields are absent or empty, emit a protocol error/audit and do not store an empty tool message.
- The same serializer semantics must exist in Rust and TypeScript.

Suggested JSON envelopes:

```json
{ "type": "web_search_results", "results": [...] }
{ "type": "web_page_content", "content": {...} }
{ "type": "web_pages_content", "contents": [...] }
{ "type": "web_research_bundle", "bundle": {...} }
{ "type": "extension_response", "response": {...} }
```

## Desired web search key lifecycle

The canonical key ID remains:

```text
search_provider:brave
```

Search provider behavior:

- On each search request, resolve the Brave key from `SecretVault` / encrypted secret state.
- Do not capture a key at app boot and keep it forever.
- Do not send search requests if vault is locked or key is missing.
- Return `secret_missing`, `secret_locked`, or `search_unavailable` visibly.
- Never write raw key material to Redux, audit, logs, extension status, or test snapshots.

## Desired extension validation path

`chrome.runtime.onMessageExternal` must always call central `handle(message, sender)`.

The central handler must:

1. Validate sender/origin.
2. Validate message is an object.
3. Validate `type` is a non-empty string.
4. Validate `requestId` is a non-empty string for all request/response-correlated messages.
5. Reject unknown message types.
6. Run per-type payload validation.
7. Await sync or async handlers through the same path.
8. Convert thrown exceptions into structured `internal_error` responses.

## Desired status model

Settings should display separate facts:

```text
Extension: Connected / Not detected
Page reading: Available / Unavailable / Permission required
Host permission flow: Available / Requires extension popup / Unavailable
Current-tab reading: Unsupported in v0.1
Web search handler: Available / Unavailable
Brave key: Configured / Missing / Vault locked
Live web search: Ready / Not ready
```

Do not collapse these into a single “Connected” badge.

## Testing requirements

FIX3 is complete only when tests prove the corrected live behavior:

- Rust tests for invalid web request fields.
- Rust tests for structured effect-result serialization.
- TypeScript reference runtime tests for the same cases.
- Parser tests for `research` and `readPages` if they remain supported.
- Provider tests proving saved Brave key is passed to extension search.
- Tests proving missing/locked key fails visibly.
- Service-worker tests proving every async handler goes through central validation.
- Settings/status tests proving capability-specific output.
- Tests proving no empty tool message is stored for successful structured web results.

## Acceptance gate

Run and record, with honest cannot-run notes if environment is missing tools:

```bash
pnpm run typecheck
pnpm run lint
pnpm run format:check
pnpm run test
pnpm run test:e2e
pnpm run test:extension:e2e
pnpm run build
pnpm run build:wasm
cargo test
cargo clippy
```

A command that cannot run due to missing `wasm-pack`, `/etc/hosts`, Docker, Playwright, or system dependencies must be documented as cannot-run. Do not mark it as passed.

