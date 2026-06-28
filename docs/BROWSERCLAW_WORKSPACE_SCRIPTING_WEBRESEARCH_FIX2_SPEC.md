# BrowserClaw Workspace/Scripting/WebResearch Fix2 Spec

## Purpose

This is a follow-up integration and safety hardening pass for BrowserClaw.

The prior implementation added substantial new infrastructure:

- app-private Workspace FS;
- structured Plan Runtime;
- QuickJS-in-WASM Sandboxed JS Runtime;
- WebResearch provider interfaces;
- Chrome extension companion scaffolding;
- protected skill permissions;
- safer URL validation;
- improved tool parsing and tool approval behavior.

However, the latest review found several important gaps:

1. new TypeScript host/runtime features are not fully supported by the default Rust/WASM deterministic runtime;
2. sandboxed scripting policy exists but is not enforced on the execution path;
3. Chrome extension permission flow is probably not valid as currently designed;
4. search/page-reading integration is incomplete;
5. several approval/parsing paths still degrade quietly;
6. partial web research failures are hidden;
7. Plan Runtime memory search is less privacy-preserving than sandbox and LLM retrieval;
8. extension E2E coverage does not yet prove successful page reading;
9. docs/TODO status can overstate app-level readiness.

This pass is not about adding new features. It is about making the new features real, truthful, fail-closed, and app-integrated.

## Hard Rules

### No silent success

If a feature is unavailable, unwired, blocked by policy, unsupported by WASM, or missing permissions, the app must report that explicitly.

Do not convert unsupported plan/script/web requests into:

- empty assistant messages;
- empty search queries;
- empty argument objects;
- silently skipped pages;
- status flags that claim availability.

### WASM and TypeScript runtime parity

The TypeScript reference runtime and Rust/WASM runtime must handle the same user-visible LLM result protocol.

If BrowserClaw claims plan/script/web execution is supported, it must be supported in the default WASM runtime, not only in the reference runtime.

### Policy must be enforced at execution seams

If a policy type exists, the execution path must read and enforce it.

Examples:

- sandboxed scripting disabled;
- extension page reading unavailable;
- missing search provider;
- invalid approval payload;
- sensitive memory access;
- tool capability descriptor missing.

### Approval payloads are untrusted

Redux approval state and payload previews are not security boundaries. Anything read from an approval card or serialized preview must be parsed, validated, and re-authorized before execution.

### Chrome extension availability must be truthful

The extension must not report page reading as available unless `read_page` can actually work under the current permission/configuration state.

### Web research may be partial, but partial failure must be visible

Skipping failed page reads without reporting failures is not acceptable. Partial success is allowed only if the result includes failures and audit events summarize them.

## Scope

### In scope

- Rust/WASM runtime support for plan/script/web LLM result shapes.
- TypeScript reference runtime parity.
- Script execution policy enforcement.
- Chrome extension permission flow cleanup.
- WebResearchService wiring and failure reporting.
- Search provider wiring or explicit unavailable state.
- readCurrentTab routing.
- safe approval payload parsing.
- Plan Runtime memory filtering.
- sandbox `tool.call` validation.
- extension E2E success-path testing.
- TODO/doc status reconciliation.

### Out of scope

- Firefox extension implementation.
- Hosted proxy service.
- Local daemon.
- Full web crawling.
- Paywall bypassing.
- Form filling or arbitrary browser automation.
- Direct secret access from scripts.
- Raw browser `eval` / `new Function` / `importScripts`.

## Priority

Use the existing priority convention:

```text
P0 = security/correctness blocker
P1 = required for feature completeness
P2 = polish, robustness, or future-facing hardening
```

## Required Architecture Fixes

## 1. Rust/WASM parity for plan/script/web protocol

### Current concern

The TypeScript reference runtime recognizes LLM result shapes such as:

```json
{ "plan": { "...": "..." } }
{ "script_request": { "...": "..." } }
{ "web_request": { "op": "search", "...": "..." } }
{ "web_request": { "op": "readPage", "...": "..." } }
```

But the Rust core appears to handle only `tool_call` and `text`.

This can silently turn a valid model-emitted plan/script/web request into an empty assistant message in the default WASM runtime.

### Required behavior

Both runtimes must support the same LLM result protocol:

```text
result.tool_call       -> ToolCallProposal
result.plan            -> ScriptPlanProposal
result.script_request  -> SandboxScriptProposal
result.web_request     -> WebSearch / WebPageRead / WebResearch / ExtensionRequest
result.text            -> StoragePut assistant message
unknown shape          -> protocol error, not empty assistant message
```

### Acceptance criteria

- Rust tests prove each result shape emits the expected effect.
- TypeScript reference runtime tests prove identical behavior.
- WASM is rebuilt.
- UI path using default WASM runtime can propose a plan/script/web action.
- Unknown result shape emits a visible/audited protocol error.

## 2. ScriptExecutionPolicy enforcement

### Current concern

`ScriptExecutionPolicy` exists, but sandbox script proposals may bypass it.

### Required behavior

`createSandboxScriptEffectHandler()` must load/check script policy before queueing or running any sandboxed script.

If sandboxed scripting is disabled:

```text
audit script.sandbox_blocked_by_policy
resolve effect as failure
show visible error
do not queue approval
do not run script
```

If BrowserClaw v0.1 intentionally enables sandboxed scripting by default, the policy defaults and docs must say so honestly.

### Recommended v0.1 policy

Because the product decision is to include QuickJS sandboxing in v0.1:

```text
sandboxedScriptingEnabled: true
advancedModeRequired: false or true depending UI
alwaysRequiresApproval: true
networkDefault: deny
secrets: deny
```

If advanced mode is required, the UI must expose how to enable it and the runtime must honor it.

## 3. Chrome extension permission flow

### Current concern

The extension may call `chrome.permissions.request()` inside a service-worker response to an external message. Chrome permission requests generally require a user gesture.

### Required behavior

Separate host-permission granting from page reading.

Flow:

```text
BrowserClaw approval card:
  "Grant extension permission for example.com?"

User approves in BrowserClaw.
BrowserClaw sends request_host_permission to extension.
Extension opens/uses extension UI/user gesture path if necessary.
Extension returns granted/denied.

Only after permission exists:
  BrowserClaw sends read_page.
```

If Chrome cannot grant permission from the external-message path, provide a visible extension action page or popup route that the user opens/clicks.

### Acceptance criteria

- Extension does not claim it can read a host unless permission exists or permission request flow is available.
- `read_page` does not silently try permission request and then fail obscurely.
- Permission denial is visible and audited.
- `read_current_tab` uses either `activeTab` or existing host permission.

## 4. WebResearchService wiring and search provider

### Current concern

The app constructs a page reader provider but may not wire a search provider into `WebResearchService`.

### Required behavior

At app boot, construct a real search provider if configured.

Default v0.1 options:

```text
Preferred:
  ChromeExtensionSearchProvider

Allowed:
  BraveSearchProvider only if direct browser-origin CORS/key handling is verified,
  or if Brave calls are routed through the extension.

Fail-closed:
  no search provider -> search_unavailable visible error.
```

### Acceptance criteria

- `web.search` in the live app either works through a configured provider or fails visibly.
- `web.research` cannot silently run with missing search provider.
- Search API keys use one canonical SecretVault ID.
- Search status UI reflects real configured provider state.

## 5. readCurrentTab routing

### Current concern

A `readCurrentTab` model request may be translated into a `web_page_read` with an empty URL, which fails URL validation instead of using the extension's current-tab handler.

### Required behavior

Represent current-tab reading explicitly:

```text
Effect: extension_request { op: "read_current_tab" }
or
Effect: web_current_tab_read
```

Do not encode current-tab read as empty URL.

### Acceptance criteria

- Model-emitted `readCurrentTab` routes to extension current-tab handler.
- Missing extension/permission returns `current_tab_unavailable`.
- No empty URL workaround.

## 6. Approval payload parsing must fail closed

### Current concern

Some approval handlers parse `payloadPreview` and fall back to empty/default values if parsing fails.

### Required behavior

Approval payload parsing must use explicit helpers that either return validated payloads or throw.

Affected areas:

- bulk research approval;
- web page read approval;
- extension permission approval;
- workspace operation approval;
- plan/script approvals if using serialized payloads;
- tool approval args.

### Acceptance criteria

- malformed `payloadPreview` never becomes `{}` or empty query;
- malformed approval payload audits `*.approval_payload_invalid`;
- runtime effect resolves as failure;
- no external request or file write is performed.

## 7. WebResearchService partial failures

### Current concern

`research()` can skip failed page reads and return fewer pages without exposing failures.

### Required behavior

`ResearchBundle` must include page read failures.

Example:

```ts
type ResearchBundle = {
  query: string;
  results: SearchResult[];
  pages: PageContent[];
  failures: PageReadFailure[];
};
```

If all page reads fail, return failure or a bundle with `ok: false`.

### Acceptance criteria

- Partial failures are visible in UI and audit.
- All-page failure is not treated as success.
- Audit includes requested count, success count, failure count.

## 8. Memory privacy consistency

### Current concern

Sandbox memory search filters sensitive memories, but Plan Runtime memory search may not.

### Required behavior

All automated memory retrieval paths must use a shared policy:

```text
default: exclude sensitive memories
optional future: memorySensitiveRead capability with high-risk approval
```

Affected paths:

- LLM context retrieval;
- sandbox `memory.search`;
- Plan Runtime `memory.search`;
- future web/plan/script memory tools.

### Acceptance criteria

- Plan Runtime memory search excludes sensitive memories by default.
- Tests prove sensitive memories are not returned.
- Sensitive memory access cannot be requested silently.

## 9. Sandbox tool capability safety

### Current concern

Sandbox `tool.call` can become unsafe if invalid args are coerced or a new tool lacks a capability descriptor.

### Required behavior

- `tool.call` args must be plain objects.
- Missing descriptor must deny by default.
- Network-capable tools require web/network capability.
- Workspace-writing tools require fs write capability.
- Memory-writing tools require memory write capability.
- Tool calls count against resource limits.
- Tool calls are audited.

### Acceptance criteria

- Non-object args fail.
- Descriptor-missing tool fails.
- Page Reader requires web read/network capability.
- Tool calls increment limits.
- Denials are audited.

## 10. Chrome extension E2E success path

### Current concern

Extension E2E scaffolding exists, but the successful page-read path is still todo/unproven.

### Required behavior

Add a Dockerized/Chromium E2E test proving:

```text
BrowserClaw app -> extension -> read fixture page -> return content -> workspace/audit
```

At minimum, extension-only E2E must prove:

```text
load unpacked extension
service worker starts
read_page fixture succeeds
text/title extracted
blocked URL denied
```

### Acceptance criteria

- `pnpm run test:extension:e2e` exists.
- Docker or documented container command exists.
- Success-path read_page test is not `test.todo`.
- Extension unavailable/error states remain tested.

## 11. Documentation/TODO reconciliation

### Current concern

TODO checkboxes can imply app-level completion when only library-level code exists.

### Required behavior

Each checked item must distinguish:

```text
library-level implementation
runtime-port implementation
main app wiring
UI wiring
E2E verified
```

Do not mark a feature complete if only library-level code exists.

## Final Acceptance Criteria

This pass is complete when:

- default WASM runtime supports plan/script/web result shapes or fails explicitly;
- sandboxed scripting policy is enforced;
- extension permission flow is explicit and truthful;
- search provider is wired or explicitly unavailable;
- current-tab read routes correctly;
- approval payload parsing fails closed;
- web research partial failures are visible;
- sensitive memories are excluded consistently;
- sandbox tool calls cannot bypass capability boundaries;
- extension read_page success path is automated;
- docs/TODO status matches live behavior.

