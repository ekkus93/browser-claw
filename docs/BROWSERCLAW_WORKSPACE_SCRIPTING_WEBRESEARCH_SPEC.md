# BrowserClaw Workspace Filesystem, Script Runtime, Web Research, and Remaining Hardening Spec

## Purpose

This document defines the next BrowserClaw implementation pass.

It builds on the runtime/storage/security hardening work and covers two categories of work:

1. Remaining hardening gaps found during the latest code review.
2. New BrowserClaw capabilities:
   - app-private workspace filesystem;
   - workspace search and file snippet/range reads;
   - Script Runtime v0.1 structured plan DSL;
   - Script Runtime v0.2 sandboxed dynamic scripting escalation;
   - Chrome Web Research Companion extension for reading search-result pages without relying on browser `fetch()` CORS behavior.

The goal is to make BrowserClaw meaningfully useful as a browser-native agent while keeping the safety model explicit and auditable.

## Core Architectural Decisions

### Decision 1 — BrowserClaw gets an app-private workspace filesystem

BrowserClaw needs its own filesystem-like workspace for artifacts, notes, scripts, research pages, generated reports, imported files, and agent working state.

This must be an app-private virtual filesystem backed by browser storage, not arbitrary user filesystem access.

Default backing:

```text
OPFS for file bytes
IndexedDB/Dexie for metadata and indexes
Optional future SQLite-wasm/FTS index in OPFS
```

The workspace is not the user's OS filesystem.

### Decision 2 — Structured plan DSL is the default script runtime

Script Runtime v0.1 is a structured, validated plan DSL. It is the default execution path for agent-created workflows.

It supports known operations such as:

```text
fs.readText
fs.writeText
fs.updateText
fs.appendText
fs.delete
fs.list
fs.search
fs.grep
web.search
web.readPage
tool.call
memory.create
```

It does not execute arbitrary JavaScript.

### Decision 3 — Dynamic scripting is an explicit escalation path

Script Runtime v0.2 may be implemented in the same pass, but it must be treated as a higher-risk escalation path.

It must never execute raw agent-generated JavaScript in the BrowserClaw app context.

Disallowed:

```ts
eval(agentCode)
new Function(agentCode)()
script.textContent = agentCode
```

Allowed only through a sandboxed runtime with mediated capabilities:

```text
sandboxed worker/interpreter
no direct DOM
no direct indexedDB
no direct OPFS
no direct fetch
no raw chrome.* extension APIs
no secrets
bounded CPU/time/output
capability calls only
approval and audit
```

### Decision 4 — Web research uses a Chrome extension companion for page reading

A browser-only web app cannot reliably read arbitrary search-result pages using `fetch()` because of CORS.

BrowserClaw v0.1 should use:

```text
SearchProvider
  Finds URLs using a user-configured search API/provider.

Chrome PageReaderProvider
  Uses a Chrome extension companion to open/read result pages and return sanitized text/markdown.
```

Do not implement:

```text
hosted web proxy for all users
local daemon connector
raw unrestricted curl proxy
CORS-bypass fantasy via no-cors
```

Firefox extension support is deferred to v0.2.

## Non-Goals

Do not add in this pass:

- hosted BrowserClaw proxy service;
- local daemon/desktop helper;
- generic unrestricted curl bridge;
- unrestricted browser automation;
- form filling/submission automation;
- cookie/session scraping by default;
- paywall bypassing;
- hidden use of user credentials;
- arbitrary host filesystem access;
- raw JavaScript execution in the app origin;
- Firefox extension implementation;
- marketplace support;
- multi-user cloud sync.

## Part 1 — Remaining Hardening Requirements

The latest code review found that the current hardening pass is much stronger than before, but several issues remain. These must be fixed before or alongside the new workspace/script/web research work.

### 1.1 Re-check tool permissions at execution time

Current concern:

The tool proposal path checks skill permission before queueing approval, but approved execution must not trust Redux approval state alone.

Required behavior:

```text
approval accepted
→ load skill by skillId
→ require skill exists
→ require skill enabled
→ load protected skill permissions
→ require toolName in permissions.tools
→ then execute tool
```

The execution path must re-check permissions even if they were checked at proposal time.

### 1.2 Move skill permissions out of mutable skill_state

Skill permissions must not live in the same mutable state table used for skill-owned state.

Required options:

```text
Preferred:
  Add skill_permissions table keyed by skillId.

Alternative:
  Store immutable/protected permissions on SkillRow.
```

The runtime must not read permissions from `skill_state['__permissions__']`.

### 1.3 Make skill package files read-only

Installed skill package files are assets, not mutable state.

Required stores:

```text
skill_files
  read-only installed package assets

skill_state
  mutable private state

skill_outputs or workspace files
  optional generated artifacts
```

`SkillFs.writeText()` must not mutate installed package assets.

### 1.4 Harden Page Reader / network access

BrowserClaw currently has a browser-side page-reading tool. It must be hardened even if Chrome extension page reading becomes the preferred path.

Requirements:

- block localhost;
- block loopback IPs;
- block private LAN IPs;
- block link-local IPs;
- block metadata IPs such as `169.254.169.254`;
- block non-http/https schemes;
- add timeout;
- add max response bytes before reading whole body;
- avoid credentials by default;
- audit blocked fetches;
- return explicit CORS/network errors.

### 1.5 Malformed tool blocks must fail explicitly

If the model emits a fenced `tool` block but it is malformed, BrowserClaw must not silently treat it as ordinary assistant text.

Required parse result:

```ts
type ToolParseResult =
  | { kind: 'none' }
  | { kind: 'tool_call'; call: ToolCall }
  | { kind: 'malformed'; message: string };
```

Malformed tool calls must be audited and shown as protocol/tool errors.

### 1.6 Make `storage_put` idempotent

A replayed runtime effect must not create duplicate messages.

Required behavior:

```text
storage_put effect key maps deterministically to storage row ID
replaying the same effect overwrites/upserts same row
runtime snapshot restore does not duplicate messages
```

### 1.7 Audit or fail unknown `resolve_effect` IDs

If the runtime receives a `resolve_effect` command for an unknown/non-pending effect ID, it must not silently return no output.

Required event:

```text
runtime.resolve_unknown_effect
source: runtime
status: failure
risk: medium
```

This should be implemented in both TypeScript reference runtime and Rust core/WASM runtime.

### 1.8 Make provider test fail closed on locked/missing secrets

If a provider profile requires a key and the key is locked or missing, the provider test must not silently run unauthenticated.

Required behavior:

```text
apiKeyMode != none and secret resolution fails
→ provider.test_failed
→ show secret_locked or secret_missing
→ do not run unauthenticated checkHealth
```

If a reachability-only test is useful, add a separate explicitly labeled action.

### 1.9 Test must save provider profile before activation

If the user edits provider profile fields and clicks Test, BrowserClaw must avoid session/reload mismatch.

Preferred behavior:

```text
Test button saves profile first
then tests persisted profile
then activates provider only if test succeeds
```

### 1.10 Backup import must self-validate

`importBackup()` must call validation internally, even if the UI already validated.

No caller should be able to bypass:

- collection allowlist;
- version compatibility;
- row validation;
- raw secret detection;
- size limits.

### 1.11 Strengthen backup row schemas

The current key-field validation is helpful but not full row-shape validation.

Add schema validators for important collections:

```text
messages
conversations
memories
skills
skill_files
skill_state
skill_permissions
provider_profiles
encrypted_secrets
audit_events
app_settings
model_catalog
model_cache_index
workspace_files/workspace_index
```

Validate required fields, enum values, and important type constraints.

### 1.12 wllama integrity claim must be corrected

If CDN runtime loading remains supported, the TODO must not claim integrity verification unless hash/SRI verification is actually implemented.

Accepted outcomes:

```text
Option A: Vendor wllama runtime asset.
Option B: Verify exact SHA-256 hash of fetched runtime bytes.
Option C: Leave explicit CDN consent but mark integrity verification as incomplete.
```

### 1.13 Empty/invalid model responses must be errors

If wllama or any provider returns a response with missing content, BrowserClaw must treat it as `invalid_response`, not as an empty assistant message.

### 1.14 Audit summary redaction

Audit `details` are redacted. Audit `summary` should also be constrained/redacted to avoid accidental leakage from exception messages.

### 1.15 Runtime boot outer catch must update UI

Unexpected boot errors outside the normal `onFailed` path must still dispatch runtime failure and show a visible error.

## Part 2 — Workspace Filesystem

### 2.1 Workspace concept

BrowserClaw needs a virtual filesystem namespace:

```text
/workspace
/workspace/notes
/workspace/research
/workspace/artifacts
/workspace/scripts
/workspace/imports
/workspace/tmp
```

It must be private to BrowserClaw's origin unless the user explicitly exports or downloads files.

### 2.2 Separation from skill filesystem

Do not merge workspace files with installed skill package assets.

Use separate concepts:

```text
WorkspaceFs
  User/agent project workspace files.

SkillPackageStore
  Read-only installed skill assets.

SkillStateStore
  Private mutable per-skill state.

SkillOutput / Workspace bridge
  Explicit writes from skills into workspace, subject to permissions.
```

### 2.3 Workspace file operations

Required API:

```ts
interface WorkspaceFs {
  createFile(path: string, content: Uint8Array | string, options?: CreateFileOptions): Promise<FileStat>;
  readFile(path: string): Promise<Uint8Array>;
  readText(path: string): Promise<string>;
  readTextRange(path: string, start: number, length: number): Promise<string>;
  readLines(path: string, startLine: number, lineCount: number): Promise<TextSnippet>;
  updateFile(path: string, content: Uint8Array | string): Promise<FileStat>;
  appendFile(path: string, content: Uint8Array | string): Promise<FileStat>;
  deleteFile(path: string): Promise<void>;
  moveFile(from: string, to: string): Promise<FileStat>;
  copyFile(from: string, to: string): Promise<FileStat>;
  listDir(path: string): Promise<FileStat[]>;
  stat(path: string): Promise<FileStat>;
  mkdir(path: string): Promise<void>;
  search(query: WorkspaceSearchQuery): Promise<WorkspaceSearchResult[]>;
  grep(query: GrepQuery): Promise<GrepResult[]>;
}
```

### 2.4 Path safety

Workspace paths must be virtual and normalized.

Reject:

```text
empty paths
relative paths outside workspace
.. traversal
encoded traversal
absolute OS paths
backslash traversal
null bytes
control characters
reserved namespaces
```

Allowed examples:

```text
/workspace/research/opfs.md
/workspace/scripts/parse-report.bcplan.json
/workspace/artifacts/summary.md
```

Disallowed examples:

```text
../../secret
/home/phil/file
C:\Users\Phil\file
/workspace/%2e%2e/secret
/workspace/foo\..\bar
```

### 2.5 Metadata

Each workspace file should have metadata:

```ts
type WorkspaceFileMeta = {
  id: string;
  path: string;
  kind: 'file' | 'directory';
  mimeType?: string;
  sizeBytes: number;
  createdAt: number;
  updatedAt: number;
  createdBy: 'user' | 'agent' | 'import' | 'script' | 'system';
  updatedBy?: 'user' | 'agent' | 'script' | 'system';
  source?: WorkspaceFileSource;
  tags?: string[];
  checksum?: string;
  indexedAt?: number;
};
```

### 2.6 Content storage

Preferred:

```text
OPFS stores file bytes by file id/content id.
IndexedDB stores metadata and search index records.
```

Avoid storing large file bodies directly in Redux.

### 2.7 Search and grep

Workspace search must support:

- path search;
- metadata search;
- text search;
- grep within file;
- grep across workspace;
- snippets with line numbers;
- read nearby context lines;
- file type filters;
- max result limits.

V0.1 acceptable search backend:

```text
IndexedDB metadata + incremental text index using a lightweight browser search library or simple chunk index.
```

Future:

```text
SQLite-wasm + FTS in OPFS.
```

### 2.8 Approval and audit

Reads may be low risk if within workspace and policy allows.

Writes/deletes/moves must be proposed, reviewed, and audited.

Write approval should show:

```text
path
operation
size
preview
diff if updating existing text
risk
script/agent source
```

Delete approval should show:

```text
path
recursive status
number of files affected
undo availability if any
```

Audit events:

```text
workspace.file_created
workspace.file_read
workspace.file_updated
workspace.file_deleted
workspace.file_moved
workspace.file_copied
workspace.search_performed
workspace.grep_performed
workspace.permission_denied
```

For high-volume reads/searches, audit summarized events instead of one row per file unless verbose audit is enabled.

### 2.9 Backup/restore

Workspace metadata and file contents must be included in backup/restore only when user chooses to include workspace files.

Backup options:

```text
settings only
settings + memories + skills
full backup including workspace files
full encrypted backup including workspace files
```

Large workspace backups must show size warnings.

## Part 3 — Script Runtime v0.1: Structured Plan DSL

### 3.1 Purpose

The plan DSL lets BrowserClaw execute agent-generated multi-step workflows without arbitrary code execution.

It is the default script/runtime mechanism.

### 3.2 Plan format

Example:

```json
{
  "type": "browserclaw_plan",
  "version": 1,
  "title": "Research OPFS and summarize",
  "reason": "Find and summarize current OPFS persistence guidance.",
  "steps": [
    {
      "id": "search",
      "op": "web.search",
      "query": "OPFS SQLite WASM browser persistence",
      "maxResults": 5
    },
    {
      "id": "read0",
      "op": "web.readPage",
      "urlFrom": "search.results[0].url",
      "format": "markdown",
      "maxChars": 50000
    },
    {
      "id": "write",
      "op": "fs.writeText",
      "path": "/workspace/research/opfs-summary.md",
      "contentFrom": "read0.markdown"
    }
  ]
}
```

### 3.3 DSL operations

V0.1 operations:

```text
fs.readText
fs.readTextRange
fs.readLines
fs.writeText
fs.updateText
fs.appendText
fs.delete
fs.move
fs.copy
fs.list
fs.search
fs.grep
web.search
web.readPage
web.readPages
memory.create
memory.search
tool.call
```

### 3.4 Validation

Before execution, validate:

- plan schema;
- version;
- operation names;
- path safety;
- input references;
- maximum step count;
- maximum read/write sizes;
- maximum web pages;
- maximum total output;
- capability requirements;
- approval requirements.

### 3.5 Plan execution

Execution rules:

```text
steps run sequentially by default
failed step stops the plan unless onError policy says otherwise
all writes use approval unless policy allows auto-approval
all web reads use web research policy
all capability calls are audited
step outputs are bounded and stored outside Redux if large
```

### 3.6 Plan approval

Approval card must show:

```text
plan title
reason
runtime: Structured Plan DSL v0.1
risk
requested capabilities
step list
files to read/write/delete
web domains to search/read
estimated output size
Approve / Edit / Reject
```

### 3.7 Error handling

Plan errors must be explicit:

```text
validation_error
permission_denied
workspace_error
web_search_error
page_read_error
tool_error
output_limit_exceeded
timeout
cancelled
```

No plan failure may silently turn into normal assistant text.

## Part 4 — Script Runtime v0.2: Sandboxed Dynamic Scripting

### 4.1 Purpose

The sandboxed script runtime lets BrowserClaw solve problems requiring loops, branching, parsing, aggregation, and custom transformations that are awkward in the structured DSL.

It is not a replacement for the DSL. It is an explicit escalation path.

### 4.2 Runtime selection policy

Default:

```text
Use Script Runtime v0.1 when task fits known operations.
```

Allow v0.2 only when:

```text
requires loops/branching over unknown data
requires custom parsing/transformation
would require many repetitive DSL steps
user explicitly asks for script
agent provides clear reason DSL is insufficient
policy allows sandboxed scripting
user approves
```

Reject v0.2 when:

```text
same thing can be done simply with DSL
requests broad workspace access
requests network access without approval
requests secrets
requests DOM/window/document/localStorage/indexedDB
uses eval/new Function/importScripts for dynamic code
resource limits are missing
```

### 4.3 Script request format

```json
{
  "type": "browserclaw_script_request",
  "version": 1,
  "runtime": "sandboxed_script",
  "title": "Aggregate fallback mentions",
  "reason": "Need custom aggregation across multiple markdown files.",
  "capabilities": {
    "fsRead": ["/workspace/docs/**"],
    "fsWrite": ["/workspace/reports/**"],
    "webSearch": false,
    "webRead": [],
    "network": "deny",
    "secrets": "deny"
  },
  "limits": {
    "timeoutMs": 5000,
    "maxOutputBytes": 262144,
    "maxFileReads": 100,
    "maxFileWrites": 10
  },
  "code": "..."
}
```

### 4.4 Sandbox constraints

The script runtime must not expose:

```text
window
document
localStorage
sessionStorage
indexedDB
OPFS direct handles
fetch
XMLHttpRequest
WebSocket
EventSource
chrome.* APIs
cookies
secrets
DOM access
```

Allowed APIs are mediated capability objects only:

```js
await fs.readText('/workspace/foo.md');
await fs.writeText('/workspace/out.md', text);
await search.workspace('fallback provider');
await web.search({ query: '...' });
await web.readPage({ url: 'https://example.com' });
```

Every capability call crosses back to BrowserClaw policy enforcement.

### 4.5 Resource limits

Required limits:

- timeout;
- cancellation;
- maximum stdout/log size;
- maximum return value size;
- maximum file reads;
- maximum file writes;
- maximum total bytes read;
- maximum total bytes written;
- maximum web requests;
- maximum pages read;
- no infinite execution.

### 4.6 Audit

Audit events:

```text
script.requested
script.approved
script.rejected
script.started
script.capability_requested
script.capability_denied
script.completed
script.failed
script.cancelled
script.timeout
```

Verbose per-capability events may be summarized by default.

### 4.7 Implementation choices

Acceptable implementation approaches:

```text
Preferred v0.2a:
  JS interpreter or constrained evaluator inside a Web Worker, with no raw global APIs.

Alternative v0.2b:
  WASM plugin runtime with explicit host imports.

Not allowed:
  eval/new Function in BrowserClaw app context.
```

If a JS interpreter is used, the interpreter itself must be reviewed as a dependency and covered by sandbox escape regression tests.

## Part 5 — Web Research and Chrome Extension Companion

### 5.1 Problem

BrowserClaw needs to perform online research:

```text
search web
get result URLs
read result pages
extract useful text/markdown
store research in workspace
summarize/analyze
```

A search API alone is insufficient because it returns URLs/snippets, not full page content.

Browser-side `fetch()` is insufficient for arbitrary pages because of CORS.

### 5.2 Provider model

Define two separate provider interfaces:

```ts
interface SearchProvider {
  search(query: string, options: SearchOptions): Promise<SearchResult[]>;
}

interface PageReaderProvider {
  isAvailable(): Promise<boolean>;
  readPage(request: PageReadRequest): Promise<PageReadResult>;
  readPages(request: PageReadPagesRequest): Promise<PageReadResult[]>;
  readCurrentTab(request: CurrentTabReadRequest): Promise<PageReadResult>;
}
```

BrowserClaw combines them in a `WebResearchService`:

```ts
interface WebResearchService {
  search(query: string, options: SearchOptions): Promise<SearchResult[]>;
  readPage(url: string, options: PageReadOptions): Promise<PageContent>;
  research(query: string, options: ResearchOptions): Promise<ResearchBundle>;
}
```

### 5.3 Search provider

V0.1 can support one or more user-configured search APIs.

Requirements:

- provider profiles stored in IndexedDB;
- API keys stored in SecretVault;
- no implicit mock search provider;
- search failures surfaced visibly;
- rate-limit/auth errors classified;
- search results stored optionally in workspace;
- search query audited without leaking secrets.

Potential provider types:

```text
brave_search
serpapi
tavily
exa
searxng
custom_search_api
```

Only implement providers that can work from BrowserClaw without requiring BrowserClaw to run a hosted proxy.

### 5.4 Chrome extension PageReaderProvider

V0.1 page reading should use a Chrome extension companion.

Responsibilities:

- connect only to allowed BrowserClaw origins;
- read current tab after user action;
- open/read search-result URLs in background/inactive tabs;
- request optional host permission per origin/domain;
- inject content script;
- extract readable text/metadata;
- return sanitized text/markdown;
- close tabs it opened for reading when appropriate;
- report errors clearly.

### 5.5 Chrome extension manifest policy

Use Manifest V3.

Required concepts:

```json
{
  "manifest_version": 3,
  "permissions": ["tabs", "scripting", "storage"],
  "optional_host_permissions": ["https://*/*", "http://*/*"],
  "externally_connectable": {
    "matches": [
      "http://localhost:5173/*",
      "https://<production-browserclaw-origin>/*"
    ]
  },
  "background": {
    "service_worker": "service-worker.js",
    "type": "module"
  }
}
```

The production origin must be strict. Do not allow arbitrary websites to message the extension.

### 5.6 Extension message protocol

BrowserClaw to extension:

```json
{
  "type": "read_page",
  "requestId": "req_123",
  "url": "https://example.com/article",
  "format": "markdown",
  "maxChars": 50000,
  "timeoutMs": 15000
}
```

Extension response:

```json
{
  "ok": true,
  "requestId": "req_123",
  "url": "https://example.com/article",
  "finalUrl": "https://example.com/article",
  "title": "Article title",
  "byline": "Author",
  "siteName": "Example",
  "text": "...",
  "markdown": "...",
  "excerpt": "...",
  "length": 42318
}
```

Error response:

```json
{
  "ok": false,
  "requestId": "req_123",
  "error": {
    "kind": "permission_denied",
    "message": "Host permission was denied for example.com",
    "retryable": true
  }
}
```

### 5.7 Permissions UX

Do not request `<all_urls>` at install by default.

Use optional host permissions.

Flow:

```text
BrowserClaw asks extension to read URL.
Extension checks host permission.
If missing, extension requests permission for that origin.
If allowed, read page.
If denied, return permission_denied.
```

Support two modes:

```text
Read current tab
  lower friction, user initiated, activeTab-style permission if used.

Read search result URL
  optional host permission for that URL/origin.
```

### 5.8 Extension extraction rules

V0.1 extraction should be read-only.

Allowed:

```text
read DOM text
read page title
read canonical URL
read metadata tags
extract main article text
convert to markdown/text
```

Disallowed:

```text
click arbitrary buttons
fill forms
submit forms
read cookies directly
read local storage/session storage from page
execute page scripts
bypass paywalls
scrape logged-in/private pages by default
perform arbitrary browser automation
```

### 5.9 Web research approvals

Search approval:

```text
query
provider
max results
risk
```

Page read approval:

```text
URLs/domains
max pages
max chars/page
host permissions needed
risk
```

Bulk research approval:

```text
query
result count
domains
read limits
workspace output paths
risk
```

### 5.10 Web research storage

Research output should be stored in workspace:

```text
/workspace/research/<slug>/search-results.json
/workspace/research/<slug>/pages/<domain>-<slug>.md
/workspace/research/<slug>/summary.md
```

Metadata should include:

```text
query
search provider
timestamp
URL
final URL
title
byline
site name
retrievedAt
extension version
content hash
```

### 5.11 BrowserFetch remains a lower-privilege tool

Keep a browser-native fetch tool for CORS-enabled APIs and same-origin endpoints.

It must be clearly labeled CORS-limited.

It must not be the primary web research path for arbitrary search result pages.

## Part 6 — Runtime Integration

### 6.1 New effect types

Add runtime effects for:

```text
workspace_fs
workspace_search
script_plan_proposal
script_plan_execute
script_sandbox_proposal
web_search
web_read_page
extension_request
```

Every effect must have:

- stable ID;
- risk classification;
- capability request;
- approval policy;
- audit path;
- explicit error shape.

### 6.2 Capability model

Capabilities:

```text
workspace.read
workspace.write
workspace.delete
workspace.search
web.search
web.readPage
web.readCurrentTab
script.plan
script.sandbox
skill.tool.<name>
```

Capability requests must include scope:

```text
paths
URLs/domains
max bytes
max files
max pages
methods
write/delete flags
```

### 6.3 Approval integration

The existing approval system should support:

- workspace write/delete approval;
- web research approval;
- script plan approval;
- sandboxed script approval;
- capability edit before approval;
- reject with reason;
- audit every decision.

### 6.4 Audit integration

New audit sources:

```text
workspace
script
web
extension
```

New audit events are listed throughout this document.

No raw secrets, page bodies, huge file contents, or script source beyond safe previews should be written to audit details.

## Part 7 — Safety and Testing Principles

### 7.1 Tests must cover hostile cases

Add regression tests for:

- path traversal;
- encoded traversal;
- package file mutation attempt;
- stale approval tool execution;
- skill permission changed after approval;
- malformed tool block;
- unknown resolve effect;
- duplicate storage effect replay;
- backup import bypass attempt;
- localhost/private network blocking;
- extension permission denial;
- sandbox requesting forbidden APIs;
- sandbox timeout;
- sandbox output too large;
- web research reading too many pages;
- CORS-limited BrowserFetch failure.

### 7.2 No new silent fallbacks

All new systems must fail visibly:

```text
workspace unavailable
OPFS unavailable
search provider missing
extension missing
host permission denied
page extraction failed
script validation failed
sandbox timeout
capability denied
```

Do not silently fall back to mock data.

## Completion Definition

This pass is complete when:

- remaining P0 hardening issues are fixed;
- workspace filesystem supports CRUD, range reads, search, grep, and audit;
- package files are read-only;
- skill permissions are protected outside mutable skill state;
- plan DSL can execute validated structured workflows;
- sandboxed scripting is gated, constrained, and mediated;
- Chrome extension can read current tab and search-result pages;
- web research can search, read pages, store research in workspace, and audit actions;
- BrowserFetch exists but is clearly CORS-limited;
- tests cover hostile and failure cases;
- no new hidden fallback/mock/no-op path is introduced.
