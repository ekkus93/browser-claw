# BrowserClaw Workspace/Scripting/WebResearch FIX3 TODO

## Priority key

```text
P0 = security/correctness blocker
P1 = required for feature completeness
P2 = polish, robustness, or future hardening
```

## Phase 0 — Scope lock

- [ ] P0 Add `docs/BROWSERCLAW_WORKSPACE_SCRIPTING_WEBRESEARCH_FIX3_SPEC.md`.
- [ ] P0 Add this file as `docs/BROWSERCLAW_WORKSPACE_SCRIPTING_WEBRESEARCH_FIX3_TODO.md`.
- [ ] P0 Update `docs/WORKSPACE_SCRIPTING_WEBRESEARCH_DESIGN_NOTES.md` with a short FIX3 section:
  - [ ] FIX3 fixes remaining live-path quiet failures from FIX2 review.
  - [ ] Search provider must use the saved Brave key at request time.
  - [ ] Structured web results must not become empty tool messages.
  - [ ] Rust/WASM and TypeScript web-request validation must match.
  - [ ] Extension async handlers must go through central validation.
  - [ ] Status UI must be capability-specific.
- [ ] P0 Do not add broad new features in this pass.
- [ ] P0 Update `memory.md` with a real `date -u` timestamp, model name, and concise summary.

---

# Part A — Live Brave Search Key Wiring

## A1 — Resolve Brave key at search time

### Problem

The live app creates an extension-backed search provider, but the provider does not receive the saved Brave key. The extension `web_search` handler requires an API key per request, so search fails even when Settings says the key is configured.

### Required behavior

- [ ] P0 `createConfiguredSearchProvider()` must receive the dependencies needed to resolve the canonical Brave key:
  - [ ] `secretVault`;
  - [ ] `db` if the resolver needs Dexie/encrypted metadata;
  - [ ] audit callback;
  - [ ] extension transport.
- [ ] P0 The actual search call must resolve the key immediately before sending the extension request.
- [ ] P0 Missing key must fail visibly as `secret_missing` or equivalent.
- [ ] P0 Locked vault must fail visibly as `secret_locked` or equivalent.
- [ ] P0 Raw key material must not enter Redux, audit, logs, status, or thrown error messages.
- [ ] P0 Tests:
  - [ ] saved key is read by live extension search provider;
  - [ ] extension request includes the key only inside the outbound extension message;
  - [ ] missing key does not call extension search;
  - [ ] locked vault does not call extension search;
  - [ ] audit contains no raw key.

### Suggested TypeScript shape

Adapt names to the current repo APIs.

```ts
// src/webresearch/configuredSearchProvider.ts
import { createExtensionSearchProvider } from '../extension/searchProvider';
import { BRAVE_PROFILE_ID, resolveSearchProviderKey } from './braveSearch';

export function createConfiguredSearchProvider(deps: {
  extensionTransport: ChromeExtensionTransport;
  secretVault: SecretVault;
  onAudit?: (event: AuditEventInput) => void;
}): SearchProvider {
  const extensionProvider = createExtensionSearchProvider({
    transport: deps.extensionTransport,
    onAudit: deps.onAudit,
    resolveApiKey: async () => {
      const key = await resolveSearchProviderKey({
        secretVault: deps.secretVault,
        profileId: BRAVE_PROFILE_ID,
      });

      if (!key || key.trim() === '') {
        throw new WebResearchError(
          'secret_missing',
          'Brave Search API key is not configured.',
        );
      }

      return key;
    },
  });

  return extensionProvider;
}
```

If the existing extension provider accepts `apiKey` instead of `resolveApiKey`, change it. Static boot-time `apiKey` is not acceptable.

```ts
// src/extension/searchProvider.ts
export function createExtensionSearchProvider(deps: {
  transport: ChromeExtensionTransport;
  resolveApiKey: () => Promise<string>;
  onAudit?: (event: AuditEventInput) => void;
}): SearchProvider {
  return {
    async search(query, options) {
      const apiKey = await deps.resolveApiKey();
      const requestId = newRequestId();

      const response = await deps.transport.send({
        type: 'web_search',
        requestId,
        query,
        apiKey,
        maxResults: options?.maxResults,
      });

      return mapExtensionSearchResponse(response);
    },
  };
}
```

## A2 — Wire the configured provider from `main.tsx`

- [ ] P0 Update `main.tsx` so the configured search provider receives `secretVault`.
- [ ] P0 `createWebResearchService()` must receive both:
  - [ ] `searchProvider` when extension search is usable;
  - [ ] `pageReaderProvider`.
- [ ] P0 If the extension transport is missing, search must fail as visibly unavailable.
- [ ] P0 Do not silently create a no-op search provider.
- [ ] P0 Tests:
  - [ ] boot wiring passes `secretVault` into configured search provider;
  - [ ] search effect succeeds when key + extension mock are present;
  - [ ] search effect fails visibly when key is missing;
  - [ ] search effect fails visibly when extension is unavailable.

---

# Part B — Runtime Effect-Result Serialization

## B1 — Add shared TypeScript serializer for structured tool results

### Problem

The host resolves web effects with structured shapes like `{ results }`, `{ content }`, and `{ bundle }`. The runtime currently looks for `text`, so successful results can become empty tool messages.

### Required behavior

- [ ] P0 Add `toolContentFromEffectResult(result)` in the TypeScript runtime layer.
- [ ] P0 It must return non-empty string content for:
  - [ ] `{ ok: true, text: string }`;
  - [ ] `{ ok: true, results: [...] }`;
  - [ ] `{ ok: true, content: {...} }`;
  - [ ] `{ ok: true, contents: [...] }`;
  - [ ] `{ ok: true, bundle: {...} }`;
  - [ ] `{ ok: true, response: {...} }`.
- [ ] P0 It must return an error/null for empty/unrecognized success results.
- [ ] P0 The TypeScript reference runtime must use this serializer before storing tool messages or issuing follow-up LLM requests.
- [ ] P0 Tests:
  - [ ] web search `{ results }` becomes non-empty tool content;
  - [ ] page read `{ content }` becomes non-empty tool content;
  - [ ] research `{ bundle }` becomes non-empty tool content;
  - [ ] extension `{ response }` becomes non-empty tool content;
  - [ ] empty success result fails visibly and audits;
  - [ ] no empty tool message is stored.

### Suggested TypeScript code

```ts
// src/runtime/effectResultSerialization.ts
export type ToolContentSerializationResult =
  | { ok: true; content: string }
  | { ok: false; kind: 'empty_effect_result' | 'unsupported_effect_result'; message: string };

function compactJson(value: unknown): string {
  return JSON.stringify(value);
}

function nonEmpty(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function toolContentFromEffectResult(result: unknown): ToolContentSerializationResult {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return {
      ok: false,
      kind: 'unsupported_effect_result',
      message: 'Effect result must be an object.',
    };
  }

  const r = result as Record<string, unknown>;

  if (typeof r.text === 'string') {
    const text = nonEmpty(r.text);
    if (text) return { ok: true, content: text };
  }

  if (Array.isArray(r.results)) {
    return {
      ok: true,
      content: compactJson({ type: 'web_search_results', results: r.results }),
    };
  }

  if (r.content && typeof r.content === 'object' && !Array.isArray(r.content)) {
    return {
      ok: true,
      content: compactJson({ type: 'web_page_content', content: r.content }),
    };
  }

  if (Array.isArray(r.contents)) {
    return {
      ok: true,
      content: compactJson({ type: 'web_pages_content', contents: r.contents }),
    };
  }

  if (r.bundle && typeof r.bundle === 'object' && !Array.isArray(r.bundle)) {
    return {
      ok: true,
      content: compactJson({ type: 'web_research_bundle', bundle: r.bundle }),
    };
  }

  if (r.response && typeof r.response === 'object' && !Array.isArray(r.response)) {
    return {
      ok: true,
      content: compactJson({ type: 'extension_response', response: r.response }),
    };
  }

  return {
    ok: false,
    kind: 'empty_effect_result',
    message: 'Effect resolved successfully but did not contain usable tool content.',
  };
}
```

## B2 — Add equivalent Rust serializer

- [ ] P0 Add Rust-side serializer in `crates/claw-core` or the appropriate runtime module.
- [ ] P0 Use it when resolving web/search/page/research/extension effects.
- [ ] P0 Remove `unwrap_or_default()` / empty-string fallback for resolved effect content.
- [ ] P0 Empty/unrecognized success results must emit audit/protocol error.
- [ ] P0 Tests:
  - [ ] `{ "ok": true, "results": [...] }` stores non-empty tool message;
  - [ ] `{ "ok": true, "content": {...} }` stores non-empty tool message;
  - [ ] `{ "ok": true, "bundle": {...} }` stores non-empty tool message;
  - [ ] `{ "ok": true }` emits audit/protocol error and does not store empty content.

### Suggested Rust-ish code

```rust
fn non_empty_string(value: Option<&serde_json::Value>) -> Option<String> {
    value
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(ToOwned::to_owned)
}

fn serialize_tool_content(result: &serde_json::Value) -> Result<String, RuntimeProtocolError> {
    if let Some(text) = non_empty_string(result.get("text")) {
        return Ok(text);
    }

    if let Some(results) = result.get("results").filter(|v| v.is_array()) {
        return serde_json::to_string(&json!({
            "type": "web_search_results",
            "results": results,
        }))
        .map_err(|err| RuntimeProtocolError::serialization(err.to_string()));
    }

    if let Some(content) = result.get("content").filter(|v| v.is_object()) {
        return serde_json::to_string(&json!({
            "type": "web_page_content",
            "content": content,
        }))
        .map_err(|err| RuntimeProtocolError::serialization(err.to_string()));
    }

    if let Some(contents) = result.get("contents").filter(|v| v.is_array()) {
        return serde_json::to_string(&json!({
            "type": "web_pages_content",
            "contents": contents,
        }))
        .map_err(|err| RuntimeProtocolError::serialization(err.to_string()));
    }

    if let Some(bundle) = result.get("bundle").filter(|v| v.is_object()) {
        return serde_json::to_string(&json!({
            "type": "web_research_bundle",
            "bundle": bundle,
        }))
        .map_err(|err| RuntimeProtocolError::serialization(err.to_string()));
    }

    if let Some(response) = result.get("response").filter(|v| v.is_object()) {
        return serde_json::to_string(&json!({
            "type": "extension_response",
            "response": response,
        }))
        .map_err(|err| RuntimeProtocolError::serialization(err.to_string()));
    }

    Err(RuntimeProtocolError::invalid_result(
        "Effect result did not contain non-empty text or supported structured content",
    ))
}
```

## B3 — Add no-empty-tool-message regression tests

- [ ] P0 Add a TypeScript regression test that simulates a successful `web_search` effect resolution and asserts stored tool content is not empty.
- [ ] P0 Add a TypeScript regression test for `web_page_read` and `web_research` effect resolution.
- [ ] P0 Add a Rust/WASM regression test for the same shapes.
- [ ] P0 Assert no follow-up `llm_request` uses an empty tool/result prompt.

---

# Part C — Web Request Contract and Validation Parity

## C1 — Decide and document supported web ops

FIX3 decision: support these v0.1 ops end-to-end:

```text
search
readPage
readPages
research
readCurrentTab
```

- [ ] P0 Update `agentBlockParser.ts` to accept `readPages` and `research`.
- [ ] P0 Update the web request validator to validate all five ops.
- [ ] P0 Update docs/design notes with the exact schema.
- [ ] P0 Unknown ops must remain malformed/protocol errors.
- [ ] P0 Tests:
  - [ ] valid `research` block parses;
  - [ ] valid `readPages` block parses;
  - [ ] empty `research.query` is malformed;
  - [ ] empty `readPages.urls` is malformed;
  - [ ] non-string URL slot is malformed;
  - [ ] unknown op is malformed.

### Suggested TypeScript validator

```ts
type WebRequestValidationResult =
  | { ok: true; request: BrowserClawWebRequest }
  | { ok: false; message: string };

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return value.trim();
}

function requireUrlArray(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('urls must be a non-empty array.');
  }
  return value.map((url, index) => {
    if (typeof url !== 'string' || url.trim() === '') {
      throw new Error(`urls[${index}] must be a non-empty string.`);
    }
    return url.trim();
  });
}

export function validateWebRequest(raw: unknown): WebRequestValidationResult {
  try {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('browserclaw-web body must be an object.');
    }
    const obj = raw as Record<string, unknown>;
    const op = requireNonEmptyString(obj.op, 'op');

    switch (op) {
      case 'search':
        return { ok: true, request: { ...(obj as any), op, query: requireNonEmptyString(obj.query, 'query') } };
      case 'readPage':
        return { ok: true, request: { ...(obj as any), op, url: requireNonEmptyString(obj.url, 'url') } };
      case 'readPages':
        return { ok: true, request: { ...(obj as any), op, urls: requireUrlArray(obj.urls) } };
      case 'research':
        return { ok: true, request: { ...(obj as any), op, query: requireNonEmptyString(obj.query, 'query') } };
      case 'readCurrentTab':
        return { ok: true, request: { ...(obj as any), op } as BrowserClawWebRequest };
      default:
        throw new Error(`Unsupported web request op: ${op}`);
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
```

## C2 — Fail-closed Rust web request validation

- [ ] P0 Replace `unwrap_or("")` / `unwrap_or_default()` field fallback in Rust web request mapping.
- [ ] P0 Add helper functions:
  - [ ] required non-empty string field;
  - [ ] required non-empty URL array;
  - [ ] safe options extraction.
- [ ] P0 Invalid requests must emit `audit_append` / protocol error, not a web effect.
- [ ] P0 Tests:
  - [ ] missing `op` emits invalid web request audit;
  - [ ] missing `query` for search emits invalid web request audit;
  - [ ] empty `query` for research emits invalid web request audit;
  - [ ] missing `url` for readPage emits invalid web request audit;
  - [ ] empty `urls` for readPages emits invalid web request audit;
  - [ ] valid ops still emit expected effects.

### Suggested Rust-ish helpers

```rust
fn required_string<'a>(obj: &'a Value, field: &str) -> Result<&'a str, RuntimeProtocolError> {
    obj.get(field)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| RuntimeProtocolError::invalid_web_request(
            format!("web_request.{field} must be a non-empty string")
        ))
}

fn required_string_array(obj: &Value, field: &str) -> Result<Vec<String>, RuntimeProtocolError> {
    let arr = obj.get(field)
        .and_then(Value::as_array)
        .filter(|items| !items.is_empty())
        .ok_or_else(|| RuntimeProtocolError::invalid_web_request(
            format!("web_request.{field} must be a non-empty array")
        ))?;

    arr.iter()
        .enumerate()
        .map(|(idx, value)| {
            value.as_str()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(ToOwned::to_owned)
                .ok_or_else(|| RuntimeProtocolError::invalid_web_request(
                    format!("web_request.{field}[{idx}] must be a non-empty string")
                ))
        })
        .collect()
}
```

## C3 — Runtime effect mapping for `readPages` and `research`

- [ ] P0 Do not collapse explicit URL-array reads into `query: ''`.
- [ ] P0 Choose implementation:
  - [ ] Preferred: add `web_pages_read` effect for explicit URL arrays; or
  - [ ] Acceptable: make `web_research` a discriminated effect with `mode: 'urls' | 'query'`.
- [ ] P0 Update TypeScript effect types.
- [ ] P0 Update Rust schema.
- [ ] P0 Update effect executor and web runner.
- [ ] P0 Tests:
  - [ ] `readPages` emits URL-array preserving effect;
  - [ ] `research` emits query-preserving effect;
  - [ ] neither emits empty query/url fallback.

### Suggested discriminated effect shape

```ts
export type WebResearchEffect =
  | {
      type: 'web_research';
      id: string;
      mode: 'query';
      query: string;
      options?: WebResearchOptions;
    }
  | {
      type: 'web_research';
      id: string;
      mode: 'urls';
      urls: string[];
      options?: WebResearchOptions;
    };
```

---

# Part D — Extension Message Validation

## D1 — Route async handlers through central `handle()`

### Problem

`onMessageExternal` bypasses central validation for async handlers. That means malformed async requests can reach handlers before standard validation.

### Required behavior

- [ ] P0 `onMessageExternal` must always call central `handle(message, sender)`.
- [ ] P0 Central handler must support async and sync handlers.
- [ ] P0 Sender/origin validation must happen before dispatch.
- [ ] P0 Unknown handlers must return `unsupported_message_type`.
- [ ] P0 Missing/invalid `requestId` must return `invalid_request`.
- [ ] P0 Thrown errors must return structured `internal_error`.
- [ ] P0 Tests:
  - [ ] malformed `read_page` missing requestId is rejected before handler logic;
  - [ ] malformed `web_search` missing requestId is rejected before handler logic;
  - [ ] unknown async-looking type is rejected;
  - [ ] handler throw returns structured `internal_error`;
  - [ ] valid async request still works.

### Suggested service-worker code

```js
async function handle(message, sender) {
  if (!isAllowedSender(sender)) {
    return errorResponse('origin_not_allowed', 'Sender origin is not allowed.');
  }

  const baseValidation = validateBaseMessage(message);
  if (!baseValidation.ok) {
    return errorResponse(
      'invalid_request',
      baseValidation.message,
      baseValidation.requestId,
    );
  }

  const handler = handlers[baseValidation.type];
  if (typeof handler !== 'function') {
    return errorResponse(
      'unsupported_message_type',
      `Unsupported extension message type: ${baseValidation.type}`,
      baseValidation.requestId,
    );
  }

  try {
    return await handler(message, sender);
  } catch (error) {
    return errorResponse(
      'internal_error',
      error instanceof Error ? error.message : String(error),
      baseValidation.requestId,
      false,
    );
  }
}

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  handle(message, sender).then(sendResponse);
  return true;
});
```

## D2 — Add per-message schema checks inside central dispatch

- [ ] P1 Validate payload schema before calling the handler body:
  - [ ] `read_page` requires URL string;
  - [ ] `read_pages` requires non-empty URL array;
  - [ ] `web_search` requires query and API key;
  - [ ] `request_host_permission` requires URL/origin;
  - [ ] `read_current_tab` is allowed but returns unavailable in v0.1.
- [ ] P1 Tests for each invalid payload.

---

# Part E — Capability-Specific Status UI

## E1 — Normalize extension status into capability facts

- [ ] P1 Add `normalizeExtensionStatus(raw, keyState)` helper.
- [ ] P1 It must compute separate fields:
  - [ ] extension connected;
  - [ ] page reading supported;
  - [ ] host permission flow supported;
  - [ ] current-tab support;
  - [ ] web search handler supported;
  - [ ] Brave key configured;
  - [ ] vault locked;
  - [ ] live search usable.
- [ ] P1 Tests:
  - [ ] connected extension but no key => live search not ready;
  - [ ] key configured but extension missing => live search not ready;
  - [ ] handler + key => live search ready;
  - [ ] current-tab unsupported shows unsupported, not connected failure;
  - [ ] page-reading unavailable shows separate status.

### Suggested TypeScript helper

```ts
export type WebResearchCapabilityStatus = {
  extensionConnected: boolean;
  pageReadingSupported: boolean;
  hostPermissionFlowSupported: boolean;
  currentTabSupported: boolean;
  webSearchHandlerSupported: boolean;
  braveKeyConfigured: boolean;
  vaultLocked: boolean;
  liveSearchReady: boolean;
};

export function normalizeExtensionStatus(args: {
  rawStatus: unknown;
  braveKeyConfigured: boolean;
  vaultLocked: boolean;
}): WebResearchCapabilityStatus {
  const raw = args.rawStatus as any;
  const extensionConnected = raw?.ok === true;
  const caps = raw?.capabilities ?? {};

  const pageReadingSupported = caps.readPage?.supported === true || raw?.pageReadingAvailable === true;
  const hostPermissionFlowSupported = caps.readPage?.permissionRequestSupported === true;
  const currentTabSupported = caps.readCurrentTab?.supported === true || raw?.currentTabReadingAvailable === true;
  const webSearchHandlerSupported = caps.webSearch?.supported === true || raw?.webSearchAvailable === true;

  return {
    extensionConnected,
    pageReadingSupported,
    hostPermissionFlowSupported,
    currentTabSupported,
    webSearchHandlerSupported,
    braveKeyConfigured: args.braveKeyConfigured,
    vaultLocked: args.vaultLocked,
    liveSearchReady:
      extensionConnected && webSearchHandlerSupported && args.braveKeyConfigured && !args.vaultLocked,
  };
}
```

## E2 — Update Settings UI copy

- [ ] P1 Replace single ambiguous “Connected” style status with separate rows/badges:
  - [ ] Extension: Connected / Not detected;
  - [ ] Page reading: Available / Unavailable / Permission required;
  - [ ] Current tab: Unsupported in v0.1;
  - [ ] Web search handler: Available / Unavailable;
  - [ ] Brave key: Configured / Missing / Vault locked;
  - [ ] Live web search: Ready / Not ready.
- [ ] P1 Do not imply direct Brave browser CORS is production-ready.
- [ ] P1 Tests for status rendering.

---

# Part F — Use `read_pages` or Downgrade It Honestly

## F1 — Wire provider `readPages()` to extension `read_pages`

FIX3 decision: use the extension batch handler from the app provider.

- [ ] P1 Update `pageReaderProvider.readPages()` to send one `read_pages` message.
- [ ] P1 Preserve per-slot failures from the extension response.
- [ ] P1 Do not loop over `readPage()` unless the extension lacks `read_pages` capability and the fallback is explicitly audited.
- [ ] P1 Tests:
  - [ ] provider sends `read_pages` for multiple URLs;
  - [ ] partial slot failure is preserved;
  - [ ] maxPages is passed through;
  - [ ] no silent fallback to sequential reads unless explicitly configured/audited.

### Suggested TypeScript code

```ts
async readPages(request: { urls: string[]; maxPages?: number; maxChars?: number }) {
  const requestId = newRequestId();
  const response = await transport.send({
    type: 'read_pages',
    requestId,
    urls: request.urls,
    maxPages: request.maxPages,
    maxChars: request.maxChars,
  });

  if (!response.ok) {
    return mapPageReadError(response);
  }

  return {
    ok: true,
    contents: response.results.filter((item) => item.ok).map((item) => item.content ?? item),
    failures: response.results
      .filter((item) => !item.ok)
      .map((item) => ({
        url: item.url,
        kind: item.error?.kind ?? 'unknown_error',
        message: item.error?.message ?? 'Page read failed.',
      })),
  };
}
```

---

# Part G — Strict Approval Payload Parsing Everywhere

## G1 — Replace lenient web page read approval parsing

- [ ] P1 `runApprovedWebPageRead()` must use strict `parseApprovalPayloadObject()`.
- [ ] P1 It must use `requireStringField(payload, 'url', 'web_page_read')`.
- [ ] P1 Malformed/missing URL:
  - [ ] does not call page reader;
  - [ ] audits `web.page_read_payload_invalid`;
  - [ ] resolves runtime effect as failure.
- [ ] P1 Tests:
  - [ ] malformed JSON does not read page;
  - [ ] missing URL does not read page;
  - [ ] empty URL does not read page;
  - [ ] audit includes failure kind but no sensitive content.

### Suggested TypeScript snippet

```ts
try {
  const payload = parseApprovalPayloadObject(approval.payloadPreview, 'web_page_read');
  const url = requireStringField(payload, 'url', 'web_page_read');
  // continue with validated url
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  await deps.recordAudit({
    type: 'web.page_read_payload_invalid',
    source: 'web',
    status: 'failure',
    risk: 'medium',
    summary: 'Web page read approval payload was invalid.',
    details: { approvalId: approval.id, message },
  });
  await deps.resolveEffect(approval.effectId, {
    ok: false,
    error: { kind: 'approval_payload_invalid', message, retryable: false },
  });
  return;
}
```

## G2 — Replace lenient extension permission approval parsing

- [ ] P1 `runApprovedExtensionPermission()` must use strict parsing.
- [ ] P1 Missing/malformed URL/origin must fail before extension call.
- [ ] P1 Audit `extension.permission_payload_invalid`.
- [ ] P1 Tests for malformed, missing, empty payload.

---

# Part H — Brave Key Clear Error Handling

## H1 — Do not swallow all clear errors

- [ ] P1 Replace broad catch in `useWebResearchKey.clearKey()`.
- [ ] P1 Only ignore a documented known-not-found case, if one exists.
- [ ] P1 On unexpected error:
  - [ ] show visible error in Settings;
  - [ ] audit `web.search_key_clear_failed`;
  - [ ] do not claim success.
- [ ] P1 Tests:
  - [ ] missing key clear succeeds if vault explicitly reports not found;
  - [ ] Dexie/vault failure shows error;
  - [ ] failure audited without key material;
  - [ ] metadata is not falsely removed on failure.

### Suggested TypeScript snippet

```ts
async function clearKey() {
  setError(null);
  try {
    await secretVault.removeSecret(BRAVE_KEY_ID);
    dispatch(recordAudit({
      type: 'web.search_key_cleared',
      source: 'settings',
      status: 'success',
      risk: 'low',
      summary: 'Brave Search key was cleared.',
    }));
  } catch (error) {
    if (isSecretNotFoundError(error)) {
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    setError('Could not clear Brave Search key. Try again.');
    dispatch(recordAudit({
      type: 'web.search_key_clear_failed',
      source: 'settings',
      status: 'failure',
      risk: 'medium',
      summary: 'Failed to clear Brave Search key.',
      details: { message },
    }));
  }
}
```

---

# Part I — `waitForTabComplete()` Race Fix

## I1 — Check existing tab status before waiting only on future updates

- [ ] P2 Update `waitForTabComplete(tabId, timeoutMs)`.
- [ ] P2 It should resolve immediately if `chrome.tabs.get(tabId).status === 'complete'`.
- [ ] P2 It should still listen for future `onUpdated` events.
- [ ] P2 It must always remove listeners on resolve/reject.
- [ ] P2 Tests:
  - [ ] already-complete tab resolves without timeout;
  - [ ] future complete event resolves;
  - [ ] timeout rejects with `page_load_timeout`;
  - [ ] listener cleanup happens in all paths.

### Suggested service-worker code

```js
function waitForTabComplete(tabId, timeoutMs) {
  return new Promise((resolve, reject) => {
    let done = false;
    let timeoutId;

    const cleanup = () => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    };

    const finish = (fn, value) => {
      if (done) return;
      done = true;
      cleanup();
      fn(value);
    };

    const onUpdated = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        finish(resolve);
      }
    };

    chrome.tabs.onUpdated.addListener(onUpdated);

    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError) {
        finish(reject, new Error(chrome.runtime.lastError.message));
        return;
      }
      if (tab && tab.status === 'complete') {
        finish(resolve);
      }
    });

    timeoutId = setTimeout(() => {
      finish(reject, new Error('page_load_timeout'));
    }, timeoutMs);
  });
}
```

---

# Part J — Optional Memory Snippet Limit

## J1 — Cap automated memory search snippets

This is P2 because sensitive memories are already excluded, but it is still safer to avoid dumping unlimited memory text into automated code paths.

- [ ] P2 Add `maxSnippetChars` to automated memory search policy.
- [ ] P2 Apply to sandbox and plan memory search results.
- [ ] P2 Default max: 1,000 to 2,000 chars.
- [ ] P2 Tests:
  - [ ] long non-sensitive memory is truncated;
  - [ ] short memory unchanged;
  - [ ] audit does not contain full text.

---

# Part K — Regression Tests and Acceptance Gate

## K1 — Silent failure regression tests

Add a dedicated regression test file or clearly named test blocks for these cases:

- [ ] P0 saved Brave key reaches extension web search request.
- [ ] P0 missing Brave key prevents extension request and fails visibly.
- [ ] P0 structured `{ results }` effect result produces non-empty tool message.
- [ ] P0 structured `{ content }` effect result produces non-empty tool message.
- [ ] P0 structured `{ bundle }` effect result produces non-empty tool message.
- [ ] P0 empty success result is protocol error/audit.
- [ ] P0 Rust invalid web request does not emit empty-query effect.
- [ ] P0 TypeScript invalid web request does not emit empty-query effect.
- [ ] P0 extension async message missing `requestId` is rejected centrally.
- [ ] P1 status UI shows live search not ready when key missing.
- [ ] P1 `read_pages` provider uses extension batch handler.
- [ ] P1 strict approval payload parsing blocks malformed web page read approval.

## K2 — Required commands

Run and record:

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

- [ ] P0 Record actual results in this TODO evidence comments.
- [ ] P0 If a command cannot run, record:
  - [ ] exact command;
  - [ ] reason;
  - [ ] required environment fix;
  - [ ] whether it blocks acceptance.
- [ ] P0 Do not mark cannot-run commands as passed.

## K3 — Final acceptance checklist

FIX3 is complete only when:

- [ ] P0 live web search uses the saved canonical Brave key;
- [ ] P0 structured web effect results become non-empty tool content;
- [ ] P0 Rust/WASM and TypeScript web-request validation are fail-closed and equivalent;
- [ ] P0 `research` and `readPages` are supported end-to-end or removed everywhere;
- [ ] P0 async extension handlers go through central validation;
- [ ] P1 Settings status is capability-specific and truthful;
- [ ] P1 `read_pages` is live through the provider or honestly downgraded;
- [ ] P1 web page read and extension permission approvals use strict payload parsing;
- [ ] P1 Brave key clear failures are visible and audited;
- [ ] P2 tab-load race is fixed;
- [ ] P0 no TODO evidence comment overstates completion.

