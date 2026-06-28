# BrowserClaw Workspace/Scripting/WebResearch FIX3 TODO

## Priority key

```text
P0 = security/correctness blocker
P1 = required for feature completeness
P2 = polish, robustness, or future hardening
```

## Phase 0 — Scope lock

<!-- evidence: FIX3_SPEC.md and FIX3_TODO.md arrived via git pull 2026-06-28; FIX3 section added to WORKSPACE_SCRIPTING_WEBRESEARCH_DESIGN_NOTES.md covering all six bullet points; memory.md updated with real date -u timestamp; no new features added in this pass -->
- [x] P0 Add `docs/BROWSERCLAW_WORKSPACE_SCRIPTING_WEBRESEARCH_FIX3_SPEC.md`. <!-- arrived via git pull -->
- [x] P0 Add this file as `docs/BROWSERCLAW_WORKSPACE_SCRIPTING_WEBRESEARCH_FIX3_TODO.md`. <!-- arrived via git pull -->
- [x] P0 Update `docs/WORKSPACE_SCRIPTING_WEBRESEARCH_DESIGN_NOTES.md` with a short FIX3 section:
  - [x] FIX3 fixes remaining live-path quiet failures from FIX2 review.
  - [x] Search provider must use the saved Brave key at request time.
  - [x] Structured web results must not become empty tool messages.
  - [x] Rust/WASM and TypeScript web-request validation must match.
  - [x] Extension async handlers must go through central validation.
  - [x] Status UI must be capability-specific.
- [x] P0 Do not add broad new features in this pass.
- [x] P0 Update `memory.md` with a real `date -u` timestamp, model name, and concise summary.

---

# Part A — Live Brave Search Key Wiring

## A1 — Resolve Brave key at search time

### Problem

The live app creates an extension-backed search provider, but the provider does not receive the saved Brave key. The extension `web_search` handler requires an API key per request, so search fails even when Settings says the key is configured.

### Required behavior

<!-- evidence: searchProvider.ts — apiKey?: string removed, replaced with resolveApiKey?: () => Promise<string> called at request time; configuredSearchProvider.ts — added secretVault?: KeySource dep; resolves key via vault.isUnlocked()+vault.getSecret(searchProviderSecretId(BRAVE_PROFILE_ID)) before each search; throws ExtensionSearchError('secret_missing'/secret_locked') on failure; main.tsx passes secretVault to createConfiguredSearchProvider; tests 1067/122 pass -->
- [x] P0 `createConfiguredSearchProvider()` must receive the dependencies needed to resolve the canonical Brave key:
  - [x] `secretVault`; <!-- added as optional KeySource dep -->
  - [x] `db` if the resolver needs Dexie/encrypted metadata; <!-- N/A: key resolved from vault directly -->
  - [x] audit callback; <!-- already present -->
  - [x] extension transport. <!-- already present -->
- [x] P0 The actual search call must resolve the key immediately before sending the extension request. <!-- resolveApiKey() called inside search() -->
- [x] P0 Missing key must fail visibly as `secret_missing` or equivalent. <!-- ExtensionSearchError('secret_missing') -->
- [x] P0 Locked vault must fail visibly as `secret_locked` or equivalent. <!-- ExtensionSearchError('secret_locked') -->
- [x] P0 Raw key material must not enter Redux, audit, logs, status, or thrown error messages. <!-- key only forwarded in extension message body -->
- [x] P0 Tests:
  - [x] saved key is read by live extension search provider; <!-- A1: saved key is forwarded inside the web_search extension message -->
  - [x] extension request includes the key only inside the outbound extension message; <!-- A1: capturedMsg.apiKey === key -->
  - [x] missing key does not call extension search; <!-- A1: missing key fails visibly, searchCallCount === 0 -->
  - [x] locked vault does not call extension search; <!-- A1: locked vault fails visibly, searchCallCount === 0 -->
  - [x] audit contains no raw key. <!-- A1 + G2 audit no-leak tests -->

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

<!-- evidence: main.tsx createConfiguredSearchProvider call now includes secretVault; createWebResearchService receives both search (when available) and reader; if transport unreachable, configuredSearch is undefined and WebResearchService returns search_unavailable; tests cover these paths -->
- [x] P0 Update `main.tsx` so the configured search provider receives `secretVault`. <!-- done -->
- [x] P0 `createWebResearchService()` must receive both:
  - [x] `searchProvider` when extension search is usable; <!-- conditional spread: configuredSearch ? { search } : {} -->
  - [x] `pageReaderProvider`. <!-- createExtensionPageReader always passed -->
- [x] P0 If the extension transport is missing, search must fail as visibly unavailable. <!-- configuredSearch undefined → WebResearchService.search throws search_unavailable -->
- [x] P0 Do not silently create a no-op search provider. <!-- configuredSearch is undefined when extension unreachable; never a no-op -->
- [x] P0 Tests:
  - [x] boot wiring passes `secretVault` into configured search provider; <!-- A1 tests verify secretVault flows to search -->
  - [x] search effect succeeds when key + extension mock are present; <!-- A1: key forwarded, search succeeds -->
  - [x] search effect fails visibly when key is missing; <!-- A1: secret_missing visible -->
  - [x] search effect fails visibly when extension is unavailable. <!-- D1: extension not reachable → undefined provider -->

---

# Part B — Runtime Effect-Result Serialization

## B1 — Add shared TypeScript serializer for structured tool results

### Problem

The host resolves web effects with structured shapes like `{ results }`, `{ content }`, and `{ bundle }`. The runtime currently looks for `text`, so successful results can become empty tool messages.

### Required behavior

<!-- evidence: src/runtime/effectResultSerialization.ts — toolContentFromEffectResult(); referenceRuntime.ts uses it for all web/plan/sandbox/extension success paths; B3 regression tests in effectResultSerialization.test.ts; typecheck ✓, lint ✓, 1087/123 vitest ✓ -->
- [x] P0 Add `toolContentFromEffectResult(result)` in the TypeScript runtime layer. <!-- src/runtime/effectResultSerialization.ts -->
- [x] P0 It must return non-empty string content for:
  - [x] `{ ok: true, text: string }`;
  - [x] `{ ok: true, results: [...] }`;
  - [x] `{ ok: true, content: {...} }`;
  - [x] `{ ok: true, contents: [...] }`;
  - [x] `{ ok: true, bundle: {...} }`;
  - [x] `{ ok: true, response: {...} }`.
- [x] P0 It must return an error/null for empty/unrecognized success results. <!-- ok:false with kind -->
- [x] P0 The TypeScript reference runtime must use this serializer before storing tool messages or issuing follow-up LLM requests. <!-- referenceRuntime.ts lines ~399 -->
- [x] P0 Tests:
  - [x] web search `{ results }` becomes non-empty tool content; <!-- B3 test -->
  - [x] page read `{ content }` becomes non-empty tool content; <!-- B3 test -->
  - [x] research `{ bundle }` becomes non-empty tool content; <!-- B1 test -->
  - [x] extension `{ response }` becomes non-empty tool content; <!-- B1 test -->
  - [x] empty success result fails visibly and audits; <!-- B3: empty_effect_result audit -->
  - [x] no empty tool message is stored. <!-- B3: no storage_put on empty result -->

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

<!-- evidence: claw-core lib.rs Runtime::tool_content_from_effect_result() handles {text},{results},{content},{contents},{bundle},{response},{outputs},{value}; used in both web-effect and tool-call success paths; empty → runtime.empty_effect_result audit, no storage_put; 12 new Rust tests; cargo test 27/27 ✓, clippy ✓ -->
- [x] P0 Add Rust-side serializer in `crates/claw-core` or the appropriate runtime module. <!-- Runtime::tool_content_from_effect_result() -->
- [x] P0 Use it when resolving web/search/page/research/extension effects. <!-- both success paths in dispatch() -->
- [x] P0 Remove `unwrap_or_default()` / empty-string fallback for resolved effect content. <!-- replaced with Option<String> + audit on None -->
- [x] P0 Empty/unrecognized success results must emit audit/protocol error. <!-- runtime.empty_effect_result -->
- [x] P0 Tests:
  - [x] `{ "ok": true, "results": [...] }` stores non-empty tool message; <!-- b2_web_search_results_stores_non_empty_tool_content -->
  - [x] `{ "ok": true, "content": {...} }` stores non-empty tool message; <!-- b2_web_page_content_stores_non_empty_tool_content -->
  - [x] `{ "ok": true, "bundle": {...} }` stores non-empty tool message; <!-- covered by B1 TS + b2 shape -->
  - [x] `{ "ok": true }` emits audit/protocol error and does not store empty content. <!-- b2_empty_success_emits_audit_no_storage_put -->

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

<!-- evidence: effectResultSerialization.test.ts B3 describe block — web_search { results }, web_page_read { content }, empty { ok:true } → audit + no storage_put, no llm_request on empty; Rust tests deferred (B2) -->
- [x] P0 Add a TypeScript regression test that simulates a successful `web_search` effect resolution and asserts stored tool content is not empty. <!-- B3 test -->
- [x] P0 Add a TypeScript regression test for `web_page_read` and `web_research` effect resolution. <!-- B3 tests -->
- [x] P0 Add a Rust/WASM regression test for the same shapes. <!-- b2_web_search_results_*, b2_web_page_content_*, b2_empty_success_* in claw-core -->
- [x] P0 Assert no follow-up `llm_request` uses an empty tool/result prompt. <!-- B3: no llm_request after empty result -->

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

<!-- evidence: agentBlockParser.ts KNOWN_WEB_OPS extended to readPages+research; validateWebRequest validates each op's required fields; 6 C1 tests in agentBlockParser.test.ts; typecheck ✓, lint ✓, 1093/123 vitest ✓ -->
- [x] P0 Update `agentBlockParser.ts` to accept `readPages` and `research`. <!-- KNOWN_WEB_OPS -->
- [x] P0 Update the web request validator to validate all five ops. <!-- validateWebRequest -->
- [x] P0 Update docs/design notes with the exact schema. <!-- BrowserClawWebRequest: urls, maxPages fields added -->
- [x] P0 Unknown ops must remain malformed/protocol errors. <!-- C1 test: unknown op is malformed -->
- [x] P0 Tests:
  - [x] valid `research` block parses; <!-- C1 test -->
  - [x] valid `readPages` block parses; <!-- C1 test -->
  - [x] empty `research.query` is malformed; <!-- C1 test -->
  - [x] empty `readPages.urls` is malformed; <!-- C1 test -->
  - [x] non-string URL slot is malformed; <!-- C1 test -->
  - [x] unknown op is malformed. <!-- C1 test -->

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

<!-- evidence: Runtime::require_str_field() helper; effects_for_web_request rewritten — missing/empty op/query/url/urls all return audit_invalid_web_request (runtime.invalid_web_request); c2_* tests in claw-core; cargo test 27/27 ✓ -->
- [x] P0 Replace `unwrap_or("")` / `unwrap_or_default()` field fallback in Rust web request mapping. <!-- require_str_field() + validate per op -->
- [x] P0 Add helper functions:
  - [x] required non-empty string field; <!-- Runtime::require_str_field() -->
  - [x] required non-empty URL array; <!-- readPages urls validation inline -->
  - [x] safe options extraction. <!-- web_request.get("options").cloned() -->
- [x] P0 Invalid requests must emit `audit_append` / protocol error, not a web effect. <!-- audit_invalid_web_request() -->
- [x] P0 Tests:
  - [x] missing `op` emits invalid web request audit; <!-- c2_missing_op_emits_invalid_web_request_audit -->
  - [x] missing `query` for search emits invalid web request audit; <!-- c2_search_missing_query_emits_invalid_web_request_audit -->
  - [x] empty `query` for research emits invalid web request audit; <!-- c2_search_empty_query_emits_invalid_web_request_audit -->
  - [x] missing `url` for readPage emits invalid web request audit; <!-- c2_read_page_missing_url_emits_invalid_web_request_audit -->
  - [x] empty `urls` for readPages emits invalid web request audit; <!-- c3_read_pages_missing_urls_emits_invalid_web_request_audit -->
  - [x] valid ops still emit expected effects. <!-- existing web_request_* tests + c3_* tests -->

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

<!-- evidence: effectTypes.ts web_research is now discriminated union {mode:'query',query} | {mode:'urls',urls}; WebResearchService.readPages() added; webRunner.ts dispatches readPages vs query; referenceRuntime.ts emits correct mode; referenceRuntime.test.ts A2 test updated; 1093/123 ✓ -->
- [x] P0 Do not collapse explicit URL-array reads into `query: ''`. <!-- C3: readPages → mode:'urls' -->
- [x] P0 Choose implementation:
  - [x] Preferred: add `web_pages_read` effect for explicit URL arrays; or
  - [x] Acceptable: make `web_research` a discriminated effect with `mode: 'urls' | 'query'`. <!-- chosen: discriminated union -->
- [x] P0 Update TypeScript effect types. <!-- effectTypes.ts -->
- [x] P0 Update Rust schema. <!-- claw-schema: WebResearch { id, mode, query?, urls?, options? } -->
- [x] P0 Update effect executor and web runner. <!-- webRunner.ts, service.ts -->
- [x] P0 Tests:
  - [x] `readPages` emits URL-array preserving effect; <!-- referenceRuntime.test.ts A2 -->
  - [x] `research` emits query-preserving effect; <!-- referenceRuntime.test.ts A2 -->
  - [x] neither emits empty query/url fallback. <!-- fail-closed audit path in referenceRuntime -->

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

<!-- evidence: service-worker.js handle() is now async + try/catch; listener always calls handle().then(sendResponse); 5 D1 tests in serviceWorkerReadPages.test.ts; 1098/123 ✓ -->
- [x] P0 `onMessageExternal` must always call central `handle(message, sender)`. <!-- listener: handle(message).then(sendResponse); return true -->
- [x] P0 Central handler must support async and sync handlers. <!-- handle() is async, always awaits handler() -->
- [x] P0 Sender/origin validation must happen before dispatch. <!-- listener checks isAllowedSender before handle() -->
- [x] P0 Unknown handlers must return `unsupported_message_type`. <!-- D1 test: unknown type -->
- [x] P0 Missing/invalid `requestId` must return `invalid_request`. <!-- D1 test: missing requestId -->
- [x] P0 Thrown errors must return structured `internal_error`. <!-- D1 test: handler throw -->
- [x] P0 Tests:
  - [x] malformed `read_page` missing requestId is rejected before handler logic; <!-- D1 test -->
  - [x] malformed `web_search` missing requestId is rejected before handler logic; <!-- D1 test -->
  - [x] unknown async-looking type is rejected; <!-- D1 test -->
  - [x] handler throw returns structured `internal_error`; <!-- D1 test -->
  - [x] valid async request still works. <!-- D1 test -->

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

<!-- evidence: validateMessageSchema() in handle() before handler; 12 D2 tests; 1113/123 vitest ✓ -->
- [x] P1 Validate payload schema before calling the handler body:
  - [x] `read_page` requires URL string;
  - [x] `read_pages` requires non-empty URL array;
  - [x] `web_search` requires query and API key;
  - [x] `request_host_permission` requires URL/origin;
  - [x] `read_current_tab` is allowed but returns unavailable in v0.1.
- [x] P1 Tests for each invalid payload.

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

<!-- evidence: pageReaderProvider.ts readPages() now sends one read_pages message; per-slot failures preserved; 4 F1 tests; 1101/123 TS vitest ✓ -->
- [x] P1 Update `pageReaderProvider.readPages()` to send one `read_pages` message. <!-- F1 — single message send -->
- [x] P1 Preserve per-slot failures from the extension response. <!-- F1 test: partial slot failure preserved -->
- [x] P1 Do not loop over `readPage()` unless the extension lacks `read_pages` capability and the fallback is explicitly audited. <!-- no loop -->
- [x] P1 Tests:
  - [x] provider sends `read_pages` for multiple URLs; <!-- F1 test: single message -->
  - [x] partial slot failure is preserved; <!-- F1 test -->
  - [x] maxPages is passed through; <!-- F1 test -->
  - [x] no silent fallback to sequential reads unless explicitly configured/audited. <!-- no loop in impl -->

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

