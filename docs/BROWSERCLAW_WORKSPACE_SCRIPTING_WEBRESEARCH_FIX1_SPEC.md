# BrowserClaw Workspace/Scripting/WebResearch FIX1 Spec

## Purpose

This document defines the **FIX1 correction and integration pass** for the BrowserClaw Workspace Filesystem, Script Runtime, Web Research, and Chrome extension work.

The prior implementation pass built a large amount of useful infrastructure:

- protected skill permissions;
- execution-time skill/tool permission re-check;
- read-only skill package assets via `skill_outputs`;
- URL safety validation;
- explicit malformed tool-call failures;
- idempotent `storage_put`;
- unknown `resolve_effect` audit behavior;
- backup import self-validation;
- stronger backup validators;
- OPFS-backed Workspace FS;
- structured Plan Runtime;
- QuickJS-in-WASM sandbox runtime;
- Web Research interfaces;
- Chrome extension protocol scaffolding;
- UI screens and approval primitives.

However, review of the latest code found a recurring issue:

> A lot of the new implementation exists as isolated modules and tests, but is not fully wired into the live BrowserClaw app/runtime path.

This FIX1 pass must close that gap.

The goal is to make the new systems **truthful, live, secure, and end-to-end testable**.

## Priority Definitions

Use the existing project priority convention:

```text
P0 = security/correctness blocker
P1 = required for feature completeness
P2 = polish, robustness, or future-facing hardening
```

## FIX1 Themes

This pass focuses on:

1. making Chrome extension status truthful;
2. implementing real extension page reading;
3. wiring runtime ports and approval resolvers into `main.tsx`;
4. adding model-output parsing for plan/script/web proposal blocks;
5. preventing sandbox `tool.call` from bypassing capability boundaries;
6. filtering sensitive memories from sandbox access;
7. making malformed approved tool args fail visibly;
8. adding Dockerized Chromium extension E2E tests;
9. verifying Brave Search browser-CORS behavior or moving search through the extension;
10. hardening agent-originated regex/grep;
11. adding large-file guards for Workspace range/line reads;
12. making multi-table skill operations transactional;
13. reconciling TODO checkboxes so checked items reflect live app behavior.

## Non-Goals

Do not add broad new product features in this pass.

Do not add:

- Firefox extension;
- hosted proxy;
- local daemon;
- arbitrary browser automation;
- form filling/submission;
- cookie extraction;
- paywall bypass;
- generic unrestricted curl/proxy endpoint;
- arbitrary DOM actions;
- hidden all-sites extension permission;
- direct access to browser `fetch` from sandbox scripts;
- direct access to OPFS/IndexedDB from sandbox scripts.

Do not expand v0.1 Chrome extension beyond:

- connection/status;
- read current tab;
- read explicit URL/search-result page;
- optional host permission request;
- content extraction;
- sanitized text/markdown return;
- bounded page reads;
- failure reporting;
- audit integration.

## High-Level Acceptance Standard

This pass is complete only when:

```text
The live BrowserClaw app can:
  - receive a model-emitted plan/script/web proposal;
  - validate it;
  - show an approval card;
  - approve/reject it;
  - execute it through the proper runtime handler;
  - enforce all capability boundaries;
  - write workspace/audit results;
  - handle extension page reads honestly;
  - and prove core extension behavior in Dockerized Chromium tests.
```

Library-only implementations are not enough.

A feature is not complete if it only passes unit tests while the live app cannot reach it.

## Current Defects to Fix

## 1. Chrome Extension Status Is Not Truthful

### Current Problem

The extension reports page reading as available in `get_status`, but the service worker only supports basic messages such as `ping` and `get_status`. `read_page` is unsupported.

This is a dangerous hollow affordance.

### Required Behavior

`get_status` must report capability availability truthfully.

If the extension does not support `read_page`, it must return:

```json
{
  "ok": true,
  "pageReadingAvailable": false
}
```

If `read_page` is implemented, it may return:

```json
{
  "ok": true,
  "pageReadingAvailable": true,
  "currentTabReadingAvailable": true
}
```

The BrowserClaw UI must not show page reading as available until a real read capability exists and passes a smoke check.

### Acceptance Criteria

- `read_page` is implemented or `pageReadingAvailable` is false.
- BrowserClaw status UI does not claim page-reading support unless it works.
- Unsupported extension requests produce explicit `unsupported_message_type`.
- Tests cover status truthfulness.

## 2. Chrome Extension Must Implement Real Page Reading

### Required Behavior

The v0.1 Chrome extension must implement:

```text
read_page
read_current_tab
request_host_permission
get_status
ping
```

At minimum, `read_page` must:

1. validate message schema;
2. validate URL policy;
3. ensure host permission exists or request it;
4. open a background/inactive tab or reuse a safe tab flow;
5. wait for load or timeout;
6. inject content extraction script;
7. extract title/text/markdown/snippet;
8. cap output;
9. close any tab opened by the extension;
10. return a structured success/error result.

### Required Error Kinds

Use explicit error kinds:

```text
unsupported_message_type
invalid_request
origin_not_allowed
permission_denied
host_permission_missing
url_blocked
tab_create_failed
page_load_timeout
script_injection_failed
extraction_failed
output_too_large
internal_error
```

### Content Extraction

The extractor must:

- remove script/style/noscript;
- avoid returning hidden controls where practical;
- normalize whitespace;
- cap output;
- avoid cookies/localStorage/sessionStorage;
- never return browser credentials;
- return clear metadata.

### Acceptance Criteria

- Extension can read a local fixture HTML page in automated tests.
- Extension can read current tab when permission model allows.
- Extension blocks private/local/internal URLs.
- Extension returns explicit failure for denied/missing permission.
- BrowserClaw receives and handles `PageReadResult`.

## 3. Runtime Ports Must Be Wired in the Live App

### Current Problem

`main.tsx` wires only existing ports such as:

```text
llmRequest
storage
tool
skill
```

It does not wire the new ports:

```text
plan
workspace
sandboxScript
web
extension
```

So the new handlers are library code, not live runtime integration.

### Required Behavior

`main.tsx` must construct and wire:

```text
WorkspaceFs
ContentStore
WebResearchService
ChromeExtensionTransport
PlanEffectHandler
SandboxScriptEffectHandler
WorkspaceEffectHandler
WebEffectHandler
ExtensionEffectHandler
```

The runtime effect executor must receive these ports.

Missing ports should still fail closed, but default app boot should provide all supported handlers.

### Acceptance Criteria

- The live app runtime context includes plan/workspace/sandbox/web/extension ports.
- Runtime effect tests prove missing ports still fail closed.
- App integration tests prove supported ports are wired in normal boot.
- No new runtime effect is silently dropped.

## 4. Approval Resolvers Must Be Wired

### Current Problem

Approval listener code supports plan/script/workspace/web/extension resolver functions, but `main.tsx` does not pass them into `registerRuntimeListeners`.

### Required Behavior

Wire resolver deps for:

```text
resolvePlanApproval
resolveSandboxApproval
resolveWorkspaceApproval
resolveWebPageReadApproval
resolveBulkResearchApproval
resolveExtensionPermissionApproval
```

Every approval kind must be able to resolve back to the runtime effect that requested it.

### Acceptance Criteria

- Plan approval executes plan and resolves runtime effect.
- Sandbox approval runs script and resolves runtime effect.
- Workspace approval executes mutation or rejects without mutation.
- Web page read approval calls WebResearch provider and resolves effect.
- Extension permission approval calls extension transport and resolves effect.
- Rejection resolves effect as failure, not pending forever.
- Stale approval IDs fail visibly/audit.

## 5. Model-Output Parsing for Plan/Script/Web Blocks

### Current Problem

The runtime/tool parsing path handles tool blocks, but normal chat does not appear to parse model-emitted plan/script/web blocks into effects.

### Required Behavior

The LLM runner must parse assistant output for structured BrowserClaw blocks:

```text
```browserclaw-plan
{ ... }
```

```browserclaw-script
{ ... }
```

```browserclaw-web
{ ... }
```
```

Valid blocks must resolve the LLM effect with a structured proposal payload so the deterministic runtime can emit the corresponding proposal effect.

Malformed blocks must fail explicitly, like malformed tool blocks.

### Required Parse Result

Use a union:

```ts
type AgentBlockParseResult =
  | { kind: 'none' }
  | { kind: 'tool_call'; call: ToolCall }
  | { kind: 'plan'; plan: BrowserClawPlan }
  | { kind: 'script_request'; request: BrowserClawScriptRequest }
  | { kind: 'web_request'; request: WebRequest }
  | { kind: 'malformed'; blockType: string; message: string };
```

### Acceptance Criteria

- Valid plan block creates plan proposal.
- Valid sandbox script block creates script proposal.
- Valid web request block creates web proposal/read effect.
- Malformed blocks are not stored as normal assistant text.
- Malformed blocks audit `agent.block_parse_failed`.
- Unknown BrowserClaw block types fail explicitly.

## 6. Sandbox `tool.call` Must Not Bypass Capability Boundaries

### Current Problem

Sandbox scripts can call tools through a generic `tool.call` capability. A script with a listed tool may indirectly reach network/file/memory behavior without the corresponding `web`, `fs`, or `memory` capability.

### Required Behavior

Every tool callable from a sandbox must have a tool capability descriptor:

```ts
type ToolCapabilityDescriptor = {
  name: string;
  categories: Array<'network' | 'workspace_read' | 'workspace_write' | 'memory_read' | 'memory_write' | 'pure'>;
  risk: 'low' | 'medium' | 'high';
  requiredCapabilities: Partial<ScriptCapabilities>;
};
```

Before executing `tool.call`, BrowserClaw must verify:

- tool is allowed by `capabilities.tools`;
- tool category requirements are satisfied;
- network-capable tools require mediated network/web capability;
- workspace-writing tools require `fsWrite` scope;
- memory-reading tools require `memoryRead`;
- memory-writing tools require explicit memory write capability if added;
- call counts/resource limits are enforced;
- all denials are audited.

### Acceptance Criteria

- Sandbox cannot call Page Reader/Web Fetch unless web/network capability exists.
- Sandbox cannot call workspace-writing tools unless fsWrite exists.
- Sandbox cannot call memory tools unless memory capability exists.
- Tool call count limit is enforced.
- Denials are visible and audited.
- Valid tool calls still work.

## 7. Sensitive Memories Must Not Leak to Sandbox Scripts

### Current Problem

Sandbox `memory.search` may return sensitive memories when `memoryRead` is true.

### Required Behavior

Default sandbox memory search must exclude:

```text
sensitivity === 'sensitive'
```

Sensitive memory access requires a separate explicit capability, for example:

```ts
memorySensitiveRead: boolean
```

For v0.1, do not expose sensitive memories to sandbox scripts at all unless a strong use case exists.

### Acceptance Criteria

- Sandbox memory.search excludes sensitive memories by default.
- Sensitive memory requires a separate high-risk capability if implemented.
- Memory search audits count/ids, not full sensitive text.
- Tests prove sensitive memory is not returned.

## 8. Invalid Approved Tool Args Must Fail

### Current Problem

Approved tool args parsing silently falls back to `{}` on JSON parse failure or non-object values.

This is unsafe and confusing.

### Required Behavior

Invalid approved args must:

- fail visibly;
- not run the tool;
- audit `tool.args_parse_failed`;
- resolve the runtime effect as failure.

### Acceptance Criteria

- Invalid JSON args do not run the tool.
- Non-object JSON args do not run the tool.
- Empty/missing args may still become `{}` for no-arg tools.
- Failure is visible and audited.

## 9. Dockerized Chrome Extension E2E Testing

### Required Behavior

Add an automated extension E2E lane.

The project should support:

```text
pnpm run test:extension:e2e
pnpm run test:extension:e2e:docker
```

or equivalent documented commands.

The Docker container should include:

- Linux;
- Node/pnpm;
- Chromium or Chrome for Testing;
- Playwright or Puppeteer;
- BrowserClaw dev/preview server;
- unpacked Chrome extension build;
- local static fixture pages.

### Required E2E Scenarios

Automate at least:

1. extension loads in Chromium;
2. service worker starts;
3. BrowserClaw can connect from allowed origin;
4. unknown origin is rejected;
5. read local public fixture page;
6. return sanitized title/text/markdown;
7. blocked URL fails;
8. BrowserClaw handles extension unavailable state;
9. BrowserClaw stores/audits successful page read.

### Manual QA Still Needed

Manual QA is still allowed for:

- Chrome Web Store packaging;
- human-facing permission prompts;
- real website behavior;
- extension upgrade flow.

But manual QA must not be the only test for extension function.

## 10. Brave Search CORS / Extension Routing

### Current Problem

A direct browser-side Brave Search provider may pass mocked fetch tests while failing in a real browser because of CORS or key exposure.

### Required Behavior

One of these must be true:

```text
Option A:
  Real browser test proves Brave Search works from BrowserClaw origin with CORS and user key.

Option B:
  Brave Search runs through the Chrome extension provider path.

Option C:
  Brave Search direct provider is marked experimental/unavailable until verified.
```

For v0.1, prefer **extension-backed search** unless direct CORS behavior is proven.

### Acceptance Criteria

- No UI claims web search is available unless the configured search path works.
- Search key is never leaked to audit/Redux/logs.
- Search failures are visible and classified.
- Real-browser or extension E2E covers the search path.

## 11. Regex/Grep Safety

### Current Problem

Agent-originated grep can use arbitrary regex patterns. Bad regexes can cause catastrophic backtracking.

### Required Behavior

For plan/sandbox/agent-originated grep:

- literal search is default;
- regex search disabled unless explicitly allowed;
- max pattern length enforced;
- safe-regex validation or timeout enforced;
- grep respects cancellation;
- large/binary files skipped.

### Acceptance Criteria

- Agent-originated grep cannot run arbitrary catastrophic regex by default.
- Regex mode requires explicit capability or user approval.
- Pattern length limits exist.
- Tests cover unsafe regex rejection or timeout.

## 12. Workspace Range Read Large-File Guards

### Current Problem

`readTextRange()` and `readLines()` may read entire files into memory.

### Required Behavior

Add large-file guards:

- reject range/line reads above max file size unless streaming backend supports partial reads;
- enforce max bytes decoded;
- preserve UTF-8 safety;
- return explicit error for oversized files.

### Acceptance Criteria

- Large file range read fails safely or streams bounded data.
- No unbounded full-file decode for huge files.
- Tests cover large-file guard.

## 13. Skill Operations Transactions

### Current Problem

Some multi-table skill operations may not be transactional.

### Required Behavior

Wrap pure Dexie multi-table skill operations in transactions:

```text
install
reinstall
uninstall
enable/disable where multiple writes/audits happen
```

OPFS and Dexie cannot share a single transaction; that is acceptable. But Dexie-only changes should be atomic where possible.

### Acceptance Criteria

- Skill install/reinstall writes skill row, package files, permissions, and cleanup inside transaction where feasible.
- Failure leaves no partially installed skill.
- Tests simulate failure and assert rollback.

## 14. TODO/Evidence Reconciliation

### Required Behavior

Update TODO evidence/status so checked boxes mean:

```text
implemented
wired into live path when applicable
tested
not merely present as a library helper
```

If a feature is intentionally scaffolded but not live, mark it as partial or unchecked.

### Acceptance Criteria

- Extension read_page is not checked until implemented and tested.
- Runtime integration is not checked until wired into `main.tsx`.
- Web search is not checked until live path verified.
- Plan/script approvals are not checked as live until resolver wiring works.
- TODO comments clearly distinguish library code from app integration.

## Security Invariants

These must hold after FIX1:

```text
No raw browser eval/new Function/importScripts for agent code.
QuickJS sandbox has no direct DOM/storage/network/chrome APIs.
Sandbox capabilities are the only escape hatch.
Every capability call is policy-checked.
Every destructive workspace operation requires approval unless explicit policy says otherwise.
Extension only accepts messages from configured BrowserClaw origins.
Extension does not claim capabilities it lacks.
Search/page reading cannot hit private/local/internal targets.
Sensitive memories do not leak to scripts by default.
Malformed model blocks fail explicitly.
Invalid approved args fail explicitly.
Missing runtime ports fail closed.
Live default boot wires supported ports.
```

## Completion Definition

FIX1 is complete only when:

- P0 tasks are implemented and tested;
- live app wires the new handlers/resolvers;
- Chrome extension can actually read a fixture page;
- extension status is truthful;
- sandbox `tool.call` cannot bypass capabilities;
- sensitive memories are filtered;
- invalid approved args fail;
- Dockerized extension E2E exists;
- TODO status is reconciled;
- all available gates pass or unavailable gates are explicitly documented.

