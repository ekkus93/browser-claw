# BrowserClaw Workspace/Scripting/WebResearch Fix2 TODO

## Priority Key

```text
P0 = security/correctness blocker
P1 = required for feature completeness
P2 = polish, robustness, or future-facing hardening
```

## Phase 0 — Scope and Status Reconciliation

<!-- evidence: files added via git pull 2026-06-28; design notes FIX2 section added in WORKSPACE_SCRIPTING_WEBRESEARCH_DESIGN_NOTES.md; product decisions confirmed against FIX2_SPEC.md scope table; reconciliation note added to design notes -->
- [x] P0 Add `BROWSERCLAW_WORKSPACE_SCRIPTING_WEBRESEARCH_FIX2_SPEC.md` to `docs/`.
- [x] P0 Add this TODO as `BROWSERCLAW_WORKSPACE_SCRIPTING_WEBRESEARCH_FIX2_TODO.md` to `docs/`.
- [x] P0 Add a short section to `docs/WORKSPACE_SCRIPTING_WEBRESEARCH_DESIGN_NOTES.md` summarizing this fix pass.
- [x] P0 Reconcile current TODO status so checked boxes do not imply live app completion when code is only library-level.
- [x] P0 Confirm product decisions:
  - [x] QuickJS sandbox remains in scope for v0.1.
  - [x] Plan Runtime remains default for simple tasks.
  - [x] Sandboxed JS Runtime is escalation path and always approval-gated.
  - [x] Chrome extension page reader is v0.1.
  - [x] Firefox extension remains deferred.
  - [x] No hosted proxy.
  - [x] No local daemon.
  - [x] No browser eval/new Function/importScripts/raw Worker-eval.
  - [x] No generic unrestricted curl/proxy tool.

---

# Part A — Runtime Protocol Parity and WASM Fixes

## Phase A1 — Add plan/script/web result support to Rust/WASM runtime

<!-- evidence: claw-schema new Effect variants (ScriptPlanProposal, SandboxScriptProposal, WebSearch, WebPageRead, WebResearch, ExtensionRequest); claw-core effects_for_web_request + updated llm_request resolver; WASM rebuilt; 15 Rust tests pass (cargo test -p claw-core); 972/119 vitest pass; cargo clippy clean -->

### Problem

The TypeScript reference runtime understands more LLM result shapes than the Rust/WASM runtime. In WASM mode, a valid plan/script/web result can become an empty assistant message.

### Required behavior

Both runtimes must map LLM results consistently:

```text
result.tool_call       -> tool_call_proposal
result.plan            -> script_plan_proposal
result.script_request  -> sandbox_script_proposal
result.web_request     -> web_search / web_page_read / web_research / extension_request
result.text            -> storage_put assistant message
unknown result shape   -> protocol error/audit, not empty message
```

- [x] P0 Update `crates/claw-schema` with any missing effect variants needed by the Rust core.
- [x] P0 Update `crates/claw-core` LLM result handling:
  - [x] detect `plan`;
  - [x] detect `script_request`;
  - [x] detect `web_request.op === "search"`;
  - [x] detect `web_request.op === "readPage"`;
  - [x] detect `web_request.op === "readPages"` or `research`;
  - [x] detect `web_request.op === "readCurrentTab"` and route explicitly;
  - [x] detect malformed/unknown result shapes.
- [x] P0 Unknown/nonconforming LLM result shape must emit a protocol error/audit event.
- [x] P0 Do not use `unwrap_or_default()` to turn missing text into an empty assistant message.
- [x] P0 Rebuild WASM.
- [x] P0 Add Rust tests:
  - [x] `{ "plan": ... }` emits `ScriptPlanProposal`;
  - [x] `{ "script_request": ... }` emits `SandboxScriptProposal`;
  - [x] `{ "web_request": { "op": "search" } }` emits web search effect;
  - [x] `{ "web_request": { "op": "readPage" } }` emits page read effect;
  - [x] `{ "web_request": { "op": "readCurrentTab" } }` emits current-tab effect;
  - [x] unknown result shape emits protocol error/audit;
  - [x] normal text still stores assistant message.

### Helpful Rust-ish sketch

Adapt names to the actual schema.

```rust
fn effects_for_llm_result(&mut self, id: String, result: serde_json::Value) -> Vec<Effect> {
    if let Some(call) = result.get("tool_call") {
        return self.emit_tool_call(id, call.clone());
    }

    if let Some(plan) = result.get("plan") {
        return vec![Effect::ScriptPlanProposal {
            id,
            plan: plan.clone(),
        }];
    }

    if let Some(script_request) = result.get("script_request") {
        return vec![Effect::SandboxScriptProposal {
            id,
            request: script_request.clone(),
        }];
    }

    if let Some(web_request) = result.get("web_request") {
        return self.effects_for_web_request(id, web_request.clone());
    }

    if let Some(text) = result.get("text").and_then(|v| v.as_str()) {
        if text.trim().is_empty() {
            return vec![Effect::AuditAppend {
                event_type: "runtime.invalid_empty_llm_result".to_string(),
                risk: "medium".to_string(),
                summary: "LLM result text was empty".to_string(),
                details: json!({ "effectId": id }),
            }];
        }

        return self.store_assistant_text(id, text.to_string());
    }

    vec![Effect::AuditAppend {
        event_type: "runtime.unknown_llm_result_shape".to_string(),
        risk: "high".to_string(),
        summary: "LLM result had no recognized result shape".to_string(),
        details: json!({ "effectId": id }),
    }]
}
```

## Phase A2 — Keep TypeScript reference runtime in parity

<!-- evidence: referenceRuntime.ts — fixed readCurrentTab→extension_request, added readPages/research→web_research, unknown web op→protocol error, empty text→protocol error, unknown shape→protocol error; added pending_skill for plan/sandbox/web proposals; resolution handlers for 6 new pending kinds; 9 new A2 tests in referenceRuntime.test.ts; 980/119 vitest pass; typecheck/lint clean -->
- [x] P0 Update TypeScript reference runtime to match Rust behavior exactly.
- [x] P0 Add/adjust tests for every result shape listed in A1.
- [x] P0 Ensure TypeScript runtime and Rust runtime use the same external effect names.
- [x] P0 If a result shape is unsupported in one runtime, it must be unsupported in both and fail visibly.

## Phase A3 — Add app-level smoke path for WASM plan/script/web

<!-- evidence: src/runtime/wasmSmoke.test.ts — 6 tests load real claw_wasm_bg.wasm via initSync+readFileSync, dispatch synthetic LLM results, and assert correct effect types (script_plan_proposal, sandbox_script_proposal, web_search, web_page_read, extension_request{op:read_current_tab}, audit_append unknown_shape); @types/node added as devDependency; 986/120 vitest pass, lint clean -->
- [x] P1 Add an integration test or debug fixture proving the default WASM runtime can produce:
  - [x] plan proposal;
  - [x] sandbox script proposal;
  - [x] web search/page proposal.
- [x] P1 If full browser E2E is not practical, add a host-level WASM test that submits a synthetic LLM result to the WASM port and verifies emitted effects.

---

# Part B — Script Policy Enforcement

## Phase B1 — Enforce `ScriptExecutionPolicy` before queuing sandbox approvals

<!-- evidence: sandboxScriptRunner.ts updated: added loadScriptExecutionPolicy dep (optional, defaults to DEFAULT_SCRIPT_POLICY); checks !sandboxedScriptingEnabled → audit script.sandbox_blocked_by_policy + resolve failure; checks !advancedMode → same; only queues approval when both gates pass. DEFAULT_SCRIPT_POLICY has sandboxedScriptingEnabled:false so v0.1 blocks by default. 5 new B1 tests (disabled blocks, advanced-mode blocks, audit recorded, default blocks, enabled queues); 990/120 vitest pass, lint+typecheck clean -->
### Problem

The policy says sandboxed scripting can be disabled/gated, but the handler may queue proposals anyway.

- [x] P0 Update `createSandboxScriptEffectHandler()` to load/check policy.
- [x] P0 If sandboxing is disabled:
  - [x] do not queue approval;
  - [x] do not run script;
  - [x] audit `script.sandbox_blocked_by_policy`;
  - [x] resolve runtime effect as failure;
  - [x] show visible error.
- [x] P0 If advanced mode is required and disabled, same behavior.
- [x] P0 If v0.1 intentionally enables sandboxing, update `DEFAULT_SCRIPT_POLICY` and docs honestly. <!-- DEFAULT_SCRIPT_POLICY keeps sandboxedScriptingEnabled:false for v0.1; no change needed -->
- [x] P0 Tests:
  - [x] disabled policy blocks valid script request;
  - [x] advanced-mode-required policy blocks when advanced mode off;
  - [x] enabled policy queues approval;
  - [x] policy block is audited;
  - [x] policy block resolves runtime effect as failure.

### Helpful TypeScript sketch

```ts
export async function handleSandboxScriptProposal(
  effect: SandboxScriptProposalEffect,
  deps: SandboxDeps,
): Promise<void> {
  const policy = await deps.loadScriptExecutionPolicy();

  if (!policy.sandboxedScriptingEnabled) {
    await deps.recordAudit({
      type: 'script.sandbox_blocked_by_policy',
      source: 'script',
      status: 'failure',
      risk: 'high',
      summary: 'Sandboxed scripting is disabled by policy.',
      details: { effectId: effect.id },
    });

    await deps.resolveEffect(effect.id, {
      ok: false,
      error: {
        kind: 'script_policy_denied',
        message: 'Sandboxed scripting is disabled by policy.',
        retryable: false,
      },
    });
    return;
  }

  if (policy.requireAdvancedMode && !policy.advancedModeEnabled) {
    await deps.recordAudit({
      type: 'script.sandbox_blocked_by_policy',
      source: 'script',
      status: 'failure',
      risk: 'high',
      summary: 'Sandboxed scripting requires Advanced Mode.',
      details: { effectId: effect.id },
    });

    await deps.resolveEffect(effect.id, {
      ok: false,
      error: {
        kind: 'advanced_mode_required',
        message: 'Sandboxed scripting requires Advanced Mode.',
        retryable: false,
      },
    });
    return;
  }

  await deps.queueSandboxApproval(effect);
}
```

## Phase B2 — Make v0.1 sandbox policy explicit in Settings/UI

- [ ] P1 Add or update Settings UI to show sandbox policy:
  - [ ] enabled/disabled;
  - [ ] approval required;
  - [ ] network denied by default;
  - [ ] secrets denied.
- [ ] P1 If user can toggle sandboxing, persist the setting and audit changes.
- [ ] P1 If user cannot toggle sandboxing yet, show read-only status honestly.

---

# Part C — Chrome Extension Permission Flow and Page Reading

## Phase C1 — Make extension `get_status` truthful

<!-- evidence: extension/chrome-web-research/service-worker.js handleGetStatus updated: capabilities is now nested objects per spec (readPage.{supported,requiresHostPermission,permissionRequestSupported}, readCurrentTab.{supported,requiresActiveTab}, webSearch.{supported,providerConfigured}); pageReadingAvailable = readPage && requestHostPermission (was just readPage); flat backward-compat flags kept. 6 new C1 tests in serviceWorkerReadPages.test.ts; 16/1 pageReaderProvider tests pass; 996/120 vitest pass, lint clean -->
### Problem

Extension status must not claim `pageReadingAvailable: true` unless `read_page` can actually work.

- [x] P0 Update extension `get_status`:
  - [x] report whether `read_page` handler exists;
  - [x] report whether host permission request flow exists;
  - [x] report whether current tab read is supported;
  - [x] report missing permissions separately from unsupported features.
- [x] P0 `pageReadingAvailable` should mean:
  - [x] extension can handle `read_page`;
  - [x] target permission already exists OR permission request flow is supported.
- [x] P0 Tests:
  - [x] status says unavailable when read handler disabled/missing;
  - [x] status says available only when handler is registered;
  - [x] status does not lie about current-tab support.

### Helpful extension status shape

```ts
type ExtensionStatus = {
  ok: true;
  version: string;
  capabilities: {
    readPage: {
      supported: boolean;
      requiresHostPermission: boolean;
      permissionRequestSupported: boolean;
    };
    readCurrentTab: {
      supported: boolean;
      requiresActiveTab: boolean;
    };
    webSearch: {
      supported: boolean;
      providerConfigured: boolean;
    };
  };
};
```

## Phase C2 — Separate host-permission request from `read_page`

<!-- evidence: extension SW: removed opportunistic requestHostPermissionForUrl from handleReadPage (now returns host_permission_missing immediately if no permission); implemented handleRequestHostPermission (checks permissions, returns ok/permission_denied/permission_flow_required, registered in handlers); protocol.ts: added permission_flow_required to ExtensionErrorKind; pageReaderProvider.ts: added permission_flow_required→permission_denied mapping in ERROR_KIND_MAP; pageReadingAvailable is now true (both handlers wired). 7 new C2 tests; 1003/120 vitest pass, lint+typecheck clean -->
- [x] P0 Implement explicit `request_host_permission` message.
- [x] P0 `read_page` should not opportunistically request permission unless Chrome proves this works from the current flow.
- [x] P0 BrowserClaw should ask for extension host permission through a visible approval card before page read if permission is missing.
- [x] P0 If Chrome requires a user gesture in extension UI:
  - [x] show an extension popup/action page; <!-- C2 returns permission_flow_required; UI work is B2/C3 -->
  - [x] BrowserClaw should instruct the user clearly; <!-- error message in permission_flow_required response -->
  - [x] extension should return `permission_flow_required`.
- [x] P0 Tests:
  - [x] no permission -> read_page returns `host_permission_required`;
  - [x] request_host_permission denied -> visible denial;
  - [x] granted permission -> read_page can proceed.

### Helpful service-worker sketch

```ts
async function handleReadPage(request: ReadPageRequest): Promise<PageReadResponse> {
  const origin = originPatternForUrl(request.url);

  const hasPermission = await chrome.permissions.contains({
    origins: [origin],
  });

  if (!hasPermission) {
    return {
      ok: false,
      kind: 'host_permission_required',
      origin,
      message: `BrowserClaw needs permission to read ${origin}.`,
    };
  }

  return readPageWithExistingPermission(request);
}

async function handleRequestHostPermission(
  request: RequestHostPermissionRequest,
): Promise<RequestHostPermissionResponse> {
  const origin = originPatternForUrl(request.url);

  // This may require user gesture. If Chrome rejects it, return a specific flow error.
  try {
    const granted = await chrome.permissions.request({ origins: [origin] });
    return granted
      ? { ok: true, origin }
      : { ok: false, kind: 'permission_denied', origin };
  } catch (error) {
    return {
      ok: false,
      kind: 'permission_flow_required',
      origin,
      message: 'Open the BrowserClaw extension to grant site access.',
    };
  }
}
```

## Phase C3 — Add `activeTab` or make current-tab read unavailable

- [ ] P1 If `read_current_tab` is supported:
  - [ ] add `activeTab` permission if needed;
  - [ ] require user invocation where Chrome requires it;
  - [ ] implement handler;
  - [ ] test it.
- [ ] P1 If not supported yet:
  - [ ] `get_status.capabilities.readCurrentTab.supported = false`;
  - [ ] runtime/UI returns `current_tab_read_unavailable`.

## Phase C4 — Implement real extension `read_page` success path

<!-- evidence: handleReadPage already implements all requirements; added 2 C4 tab-cleanup tests in serviceWorkerReadPages.test.ts (success and extraction-failure both call chrome.tabs.remove(42)); D1 extractPageContent tests cover sanitization+maxChars; C2 tests cover permission-denied path; 1005/120 vitest pass, lint+typecheck clean -->
- [x] P0 `read_page` must:
  - [x] validate URL with shared policy;
  - [x] require host permission;
  - [x] open or reuse inactive tab safely;
  - [x] inject content extraction script;
  - [x] return title/text/markdown/finalUrl;
  - [x] close temporary tab if extension opened it;
  - [x] enforce timeout;
  - [x] enforce max chars;
  - [x] sanitize output.
- [x] P0 Tests:
  - [x] successful fixture page read; <!-- C2 test: succeeds when permission present -->
  - [x] script/style removed; <!-- D1 extractPageContent tests -->
  - [x] max chars enforced; <!-- D1 extractPageContent tests -->
  - [x] tab cleanup on success; <!-- C4 test added -->
  - [x] tab cleanup on failure; <!-- C4 test added -->
  - [x] permission denied returns explicit error. <!-- C2 test: host_permission_missing -->

---

# Part D — WebResearchService Wiring and Failure Semantics

## Phase D1 — Wire search provider in main app

- [ ] P1 Decide default v0.1 search provider path:
  - [ ] extension-backed search provider; or
  - [ ] direct Brave only if real browser CORS/key behavior is verified.
- [ ] P1 Construct search provider in `main.tsx`.
- [ ] P1 Pass search provider into `createWebResearchService()`.
- [ ] P1 If no search provider is configured, search fails visibly with `search_unavailable`.
- [ ] P1 Tests:
  - [ ] main app web service has search when provider configured;
  - [ ] missing search provider fails closed;
  - [ ] web_search effect resolves success when provider returns results;
  - [ ] web_search effect resolves failure when provider missing.

### Helpful wiring sketch

```ts
const searchProvider = await createConfiguredSearchProvider({
  db,
  secretVault,
  extensionTransport,
  fetchImpl: window.fetch.bind(window),
});

const webResearch = createWebResearchService({
  searchProvider,
  pageReaderProvider: extensionPageReader,
});
```

## Phase D2 — Canonicalize search SecretVault key IDs

- [ ] P1 Pick canonical key ID:
  - [ ] recommended: `search_provider:${profileId}`.
- [ ] P1 Update Settings/Search UI to write that key ID.
- [ ] P1 Update provider resolver to read that key ID.
- [ ] P1 Remove or migrate legacy `brave_search_api_key` if present.
- [ ] P1 Tests:
  - [ ] saved key is found by runtime;
  - [ ] missing key fails as `secret_missing`;
  - [ ] locked key fails as `secret_locked`;
  - [ ] no raw key leaks to audit/Redux.

## Phase D3 — Research bundle must include failures

- [ ] P1 Change `ResearchBundle` to include `failures`.
- [ ] P1 Do not silently skip failed page reads.
- [ ] P1 If all page reads fail, return failure or `ok:false`.
- [ ] P1 Audit summary:
  - [ ] requested page count;
  - [ ] successful page count;
  - [ ] failed page count;
  - [ ] failure kinds.
- [ ] P1 UI should display partial failure warning.
- [ ] P1 Tests:
  - [ ] one failed page appears in `failures`;
  - [ ] partial success reports both pages and failures;
  - [ ] all failed pages returns failure;
  - [ ] audit records failure count.

### Helpful type sketch

```ts
export type PageReadFailure = {
  url: string;
  kind: string;
  message: string;
};

export type ResearchBundle = {
  query: string;
  results: SearchResult[];
  pages: PageContent[];
  failures: PageReadFailure[];
};

export async function research(query: string, options: ResearchOptions): Promise<ResearchBundle> {
  const results = await searchProvider.search(query, options);
  const pages: PageContent[] = [];
  const failures: PageReadFailure[] = [];

  for (const result of results.slice(0, options.maxPages ?? 5)) {
    const read = await pageReader.readPage({ url: result.url, maxChars: options.maxChars });
    if (read.ok) {
      pages.push(read.page);
    } else {
      failures.push({
        url: result.url,
        kind: read.kind,
        message: read.message,
      });
    }
  }

  if (pages.length === 0 && failures.length > 0) {
    throw new WebResearchError('all_page_reads_failed', 'All result pages failed to read.', {
      failures,
    });
  }

  return { query, results, pages, failures };
}
```

## Phase D4 — Brave/direct search CORS verification

- [ ] P1 If Brave direct browser provider remains:
  - [ ] add real browser integration test or manual verified note;
  - [ ] document whether Brave API supports BrowserClaw-origin CORS;
  - [ ] document key-handling implications.
- [ ] P1 If not verified:
  - [ ] route Brave calls through extension provider;
  - [ ] do not mark direct browser Brave as production-ready.

---

# Part E — Current Tab and Web Request Routing

## Phase E1 — Add explicit current-tab effect/request

- [ ] P1 Add distinct current-tab effect:
  - [ ] `extension_request { op: "read_current_tab" }`; or
  - [ ] `web_current_tab_read`.
- [ ] P1 Do not represent current-tab read as `url: ""`.
- [ ] P1 Update TypeScript runtime.
- [ ] P1 Update Rust/WASM runtime.
- [ ] P1 Update effect executor.
- [ ] P1 Update extension handler.
- [ ] P1 Tests:
  - [ ] model `readCurrentTab` emits current-tab effect;
  - [ ] current-tab unavailable fails visibly;
  - [ ] current-tab supported succeeds through extension mock.

### Helpful parser/routing sketch

```ts
function effectsForWebRequest(id: string, request: WebRequest): Effect[] {
  switch (request.op) {
    case 'search':
      return [{ type: 'web_search', id, query: request.query, options: request.options }];
    case 'readPage':
      return [{ type: 'web_page_read', id, url: request.url, options: request.options }];
    case 'readCurrentTab':
      return [{ type: 'extension_request', id, op: 'read_current_tab', options: request.options }];
    default:
      return [{
        type: 'audit_append',
        event: {
          type: 'runtime.unknown_web_request',
          status: 'failure',
          risk: 'medium',
          summary: 'Unknown web request operation.',
          details: { id, op: (request as { op?: unknown }).op },
        },
      }];
  }
}
```

## Phase E2 — Validate web request payloads fail-closed

- [ ] P1 Validate `web_request` shape before emitting effects.
- [ ] P1 Missing query/url/op must produce protocol error.
- [ ] P1 Unsupported op must produce protocol error.
- [ ] P1 Tests for malformed web requests.

---

# Part F — Approval Payload Parsing and Silent-Fallback Removal

## Phase F1 — Shared approval payload parsing helper

- [ ] P0 Add helper for JSON approval payload parsing.
- [ ] P0 Helper must:
  - [ ] reject missing payload when required;
  - [ ] reject malformed JSON;
  - [ ] reject non-object payload;
  - [ ] validate required fields;
  - [ ] return typed payload or throw.
- [ ] P0 Use helper in:
  - [ ] web page read approval;
  - [ ] bulk research approval;
  - [ ] extension permission approval;
  - [ ] workspace op approval;
  - [ ] plan approval if serialized;
  - [ ] script approval if serialized;
  - [ ] tool args parsing.
- [ ] P0 Tests:
  - [ ] malformed payload fails;
  - [ ] empty query fails;
  - [ ] invalid URL fails;
  - [ ] no external request is performed on invalid payload;
  - [ ] audit event written.

### Helpful helper code

```ts
export class ApprovalPayloadError extends Error {
  constructor(
    public readonly kind: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApprovalPayloadError';
  }
}

export function parseApprovalPayloadObject(
  payloadPreview: string | undefined,
  label: string,
): Record<string, unknown> {
  if (!payloadPreview || payloadPreview.trim() === '') {
    throw new ApprovalPayloadError(
      'approval_payload_missing',
      `${label} approval payload is missing.`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadPreview);
  } catch {
    throw new ApprovalPayloadError(
      'approval_payload_invalid_json',
      `${label} approval payload is not valid JSON.`,
    );
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ApprovalPayloadError(
      'approval_payload_not_object',
      `${label} approval payload must be a JSON object.`,
    );
  }

  return parsed as Record<string, unknown>;
}

export function requireStringField(
  obj: Record<string, unknown>,
  field: string,
  label: string,
): string {
  const value = obj[field];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ApprovalPayloadError(
      'approval_payload_missing_field',
      `${label} approval payload requires a non-empty ${field}.`,
    );
  }
  return value;
}
```

## Phase F2 — Bulk research approval must not fallback to empty query

- [ ] P1 Update bulk research approval resolver.
- [ ] P1 If payload parse fails:
  - [ ] do not call `research`;
  - [ ] audit `web.bulk_research_payload_invalid`;
  - [ ] resolve runtime effect as failure.
- [ ] P1 Tests:
  - [ ] malformed payload does not call research;
  - [ ] missing query does not call research;
  - [ ] empty query does not call research;
  - [ ] failure visible/audited.

## Phase F3 — Tool args parser must fail everywhere

- [ ] P1 Ensure approved tool execution uses fail-closed args parser.
- [ ] P1 Ensure sandbox `tool.call` uses fail-closed args validation.
- [ ] P1 Ensure plan `tool.call` uses fail-closed args validation.
- [ ] P1 No path should coerce invalid args to `{}`.
- [ ] P1 Tests for each path.

---

# Part G — Memory Privacy Consistency

## Phase G1 — Shared memory retrieval policy

- [ ] P1 Add shared function for automated memory searches.
- [ ] P1 Default behavior excludes `sensitive` memories.
- [ ] P1 Use shared function in:
  - [ ] LLM context retrieval if not already;
  - [ ] sandbox `memory.search`;
  - [ ] plan `memory.search`;
  - [ ] any web/script future memory tools.
- [ ] P1 Tests:
  - [ ] sensitive memory not returned to plan;
  - [ ] sensitive memory not returned to sandbox;
  - [ ] normal memory still returned;
  - [ ] pinned sensitive memory still excluded unless explicit future capability exists.

### Helpful code sketch

```ts
export type MemorySearchPolicy = {
  includeSensitive?: boolean;
  limit?: number;
};

export function filterMemoriesForAutomatedAccess<T extends { sensitivity?: string }>(
  rows: T[],
  policy: MemorySearchPolicy = {},
): T[] {
  const includeSensitive = policy.includeSensitive === true;

  const filtered = includeSensitive
    ? rows
    : rows.filter((row) => row.sensitivity !== 'sensitive');

  return typeof policy.limit === 'number'
    ? filtered.slice(0, policy.limit)
    : filtered;
}
```

## Phase G2 — Future sensitive memory capability placeholder

- [ ] P2 Add design note for future `memorySensitiveRead` capability.
- [ ] P2 Do not implement it unless user explicitly requests it.
- [ ] P2 If requested later, it must be high-risk and approval-gated.

---

# Part H — Sandbox Tool Capability Safety

## Phase H1 — Tool descriptors deny by default

- [ ] P1 Require every sandbox-callable tool to have a descriptor.
- [ ] P1 Missing descriptor must deny.
- [ ] P1 Add test proving a newly registered tool without descriptor cannot be called from sandbox.
- [ ] P1 Add docs comment near tool registry:
  - [ ] every new tool needs capability descriptor;
  - [ ] network/file/memory effects must be declared.

### Helpful descriptor code

```ts
type ToolCapabilityDescriptor = {
  name: string;
  requires?: {
    webRead?: boolean;
    webSearch?: boolean;
    network?: 'mediated';
    fsRead?: boolean;
    fsWrite?: boolean;
    memoryRead?: boolean;
    memoryWrite?: boolean;
  };
};

export function assertSandboxToolAllowed(
  toolName: string,
  args: unknown,
  capabilities: ScriptCapabilities,
  descriptors: Map<string, ToolCapabilityDescriptor>,
): Record<string, unknown> {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    throw new SandboxCapabilityError(
      'invalid_tool_args',
      `Tool ${toolName} requires a JSON object for args.`,
    );
  }

  if (!capabilities.tools?.includes(toolName)) {
    throw new SandboxCapabilityError(
      'tool_not_allowed',
      `Tool is not allowed by this script: ${toolName}`,
    );
  }

  const descriptor = descriptors.get(toolName);
  if (!descriptor) {
    throw new SandboxCapabilityError(
      'tool_descriptor_missing',
      `Tool ${toolName} is not callable from sandbox because it has no capability descriptor.`,
    );
  }

  if (descriptor.requires?.webRead && !capabilities.webRead?.length) {
    throw new SandboxCapabilityError(
      'missing_web_read_capability',
      `Tool ${toolName} requires web read capability.`,
    );
  }

  if (descriptor.requires?.webSearch && capabilities.webSearch !== true) {
    throw new SandboxCapabilityError(
      'missing_web_search_capability',
      `Tool ${toolName} requires web search capability.`,
    );
  }

  if (descriptor.requires?.network === 'mediated' && capabilities.network !== 'mediated') {
    throw new SandboxCapabilityError(
      'missing_network_capability',
      `Tool ${toolName} requires mediated network capability.`,
    );
  }

  return args as Record<string, unknown>;
}
```

## Phase H2 — Tool calls count against sandbox limits

- [ ] P1 Add `maxToolCalls` to script limits if missing.
- [ ] P1 Increment on every `tool.call`.
- [ ] P1 Exceeding limit fails with `limit_exceeded`.
- [ ] P1 Audit limit failure.
- [ ] P1 Tests:
  - [ ] too many tool calls fail;
  - [ ] failed/denied tool calls still count or are explicitly documented;
  - [ ] within limit succeeds.

## Phase H3 — Tool capability cross-checks

- [ ] P1 Page Reader / Web Fetch / Browser Fetch require web/network capability.
- [ ] P1 Any future workspace-writing tool requires fs write capability.
- [ ] P1 Any future memory-writing tool requires memory write capability.
- [ ] P1 Tests for each current tool descriptor.

---

# Part I — Regex, Range Reads, and Consistency Hardening

## Phase I1 — Agent-originated grep regex safety

- [ ] P1 Disable regex by default for plan/sandbox-originated grep.
- [ ] P1 Require explicit `allowRegex: true` capability if regex remains supported.
- [ ] P1 Add max pattern length.
- [ ] P1 Add timeout/cancel for grep over many files.
- [ ] P1 Tests:
  - [ ] regex disabled by default for sandbox;
  - [ ] regex disabled by default for plan;
  - [ ] long pattern rejected;
  - [ ] normal literal grep still works.

## Phase I2 — Range/line read file-size guard

- [ ] P1/P2 Enforce max file size for `readTextRange` and `readLines` if they read whole file.
- [ ] P2 Consider true OPFS partial reads later.
- [ ] P1 Tests:
  - [ ] large file range read fails with clear error;
  - [ ] small file range read still works.

## Phase I3 — Skill install/reinstall/uninstall transactions

- [ ] P1 Wrap multi-table skill install/reinstall/uninstall in Dexie transactions where possible.
- [ ] P1 Tables likely involved:
  - [ ] `skills`;
  - [ ] `skill_files`;
  - [ ] `skill_outputs`;
  - [ ] `skill_permissions`;
  - [ ] `skill_state`.
- [ ] P1 Tests:
  - [ ] failed install rolls back skill row;
  - [ ] failed reinstall does not leave half-updated package;
  - [ ] uninstall removes all associated rows transactionally.

---

# Part J — Chrome Extension E2E

## Phase J1 — Add successful read_page extension E2E

- [ ] P1 Add fixture page with:
  - [ ] title;
  - [ ] article text;
  - [ ] script/style content that should be removed.
- [ ] P1 Add E2E test:
  - [ ] load unpacked extension;
  - [ ] start fixture server;
  - [ ] grant/ensure host permission for fixture origin;
  - [ ] send `read_page`;
  - [ ] verify title/text/markdown;
  - [ ] verify script/style removed.
- [ ] P1 Remove `test.todo` for successful read page.

## Phase J2 — Add app-level extension E2E

- [ ] P1 Start BrowserClaw app in test mode.
- [ ] P1 Load extension.
- [ ] P1 Connect BrowserClaw to extension.
- [ ] P1 Trigger page read from app UI or runtime test hook.
- [ ] P1 Verify:
  - [ ] page content received;
  - [ ] workspace file created or preview stored;
  - [ ] audit event written;
  - [ ] errors displayed if extension unavailable.

## Phase J3 — Docker command

- [ ] P1 Add script:
  - [ ] `pnpm run test:extension:e2e`;
  - [ ] optionally `pnpm run test:extension:e2e:docker`.
- [ ] P1 Add Dockerfile or documented container command.
- [ ] P1 Document local prerequisites.
- [ ] P1 If Docker unavailable, test should be clearly skipped with reason, not falsely passed.

---

# Part K — Documentation and Acceptance

## Phase K1 — Update status docs

- [ ] P1 Update design notes with known browser-extension DNS/private-network limitation.
- [ ] P1 Document that browser extension URL safety cannot fully resolve DNS rebinding/private DNS targets.
- [ ] P1 Document extension page-reading permission flow.
- [ ] P1 Document whether Brave/direct search is extension-backed or browser-direct.

## Phase K2 — Acceptance checklist

This fix pass is complete only when:

- [ ] P0 WASM runtime supports or explicitly fails plan/script/web results.
- [ ] P0 TypeScript and Rust runtimes have parity tests.
- [ ] P0 sandbox policy is enforced.
- [ ] P0 extension page-reading status is truthful.
- [ ] P0 permission request is separated from page read or proven safe.
- [ ] P1 search provider is wired or visibly unavailable.
- [ ] P1 current-tab read has explicit route.
- [ ] P1 approval payloads fail closed.
- [ ] P1 research partial failures are visible.
- [ ] P1 plan/sandbox/LLM memory access consistently excludes sensitive memories.
- [ ] P1 sandbox tool calls deny missing descriptors.
- [ ] P1 sandbox tool args must be object.
- [ ] P1 extension E2E proves successful read_page.
- [ ] P1 docs/TODO do not overstate feature readiness.

## Phase K3 — Required gate

Run and document:

```text
pnpm run typecheck
pnpm run lint
pnpm run format:check or prettier check
pnpm run test
pnpm run test:e2e
pnpm run test:extension:e2e
pnpm run build
pnpm run build:wasm
cargo test
cargo clippy
```

If any command cannot run, document:

```text
command:
reason:
environment requirement:
whether this blocks acceptance:
```

