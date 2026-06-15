# Replies to Claude Code — Workspace/Scripting/WebResearch Round 2

These are the responses to `responses2.md` for the BrowserClaw Workspace, Scripting, and WebResearch follow-up pass.

Status: **implementation guidance approved with clarifications.**

The important correction from the discussion with Phillip:

> BrowserClaw v0.1 should include both the structured Plan Runtime and the Sandboxed JS Runtime.  
> For the Sandboxed JS Runtime, use a QuickJS-in-WASM style embedded interpreter.  
> Do not defer all of Phase D. Do not use browser `eval`, `new Function`, `importScripts`, or raw Worker-eval.

---

## Bottom line

Claude Code's review is mostly accurate. The Part A hardening issues are real and should land first. The new Workspace FS, Plan Runtime, WebResearch extension, and Sandboxed JS Runtime are larger subsystems and should be implemented in bounded Ralph-loop passes.

The implementation order should be:

```text
1. Part A — Remaining hardening fixes
2. Part B — Workspace FS foundation
3. Part C — Structured Plan Runtime
4. Part E — Chrome Web Research extension and extension-backed search/page reading
5. Part D — Sandboxed JS Runtime using QuickJS-in-WASM
6. Part F/G/H — integration, QA, docs, and acceptance cleanup
```

Do not implement web/search/scripting features before the remaining P0 security issues are fixed.

---

# Response to Part 1 hardening verification

The verification table in `responses2.md` is accepted with the following clarifications.

## A1.1 — Re-check skill permissions at approved execution time

Accepted. This is P0.

`runApprovedToolCall()` must not trust Redux approval state as the security boundary. It must re-load the skill and re-check the protected permissions immediately before execution.

Required execution flow:

```text
approval accepted
→ load approval payload
→ load skill by skillId
→ require skill exists
→ require skill.enabled
→ load protected skill permissions
→ require requested tool is declared
→ enforce tool risk/approval policy
→ execute tool
→ audit result
→ resolve runtime effect
```

Do not rely only on the proposal-time check.

## A1.2 — Move skill permissions out of `skill_state`

Accepted. This is P0.

Permissions must not live in mutable `skill_state['__permissions__']`.

Use one of these designs:

```text
Preferred:
  Add a protected `skill_permissions` table keyed by skillId.

Acceptable:
  Add immutable/protected permissions to `SkillRow`.

Not acceptable:
  Keep permissions in normal skill_state and merely block writes through SkillFs.
```

`SkillFs` should never read permission metadata from the mutable state table.

Backup/import must validate this new protected permission store.

## A1.3 — Read-only package files

Accepted. This is P1 but should be done before expanding scripting.

Separate:

```text
skill_package_files:
  installed read-only package assets

skill_state:
  private mutable state

skill_outputs / workspace artifacts:
  generated files, if needed
```

Do not expose `SkillFs.writeText()` as a way to mutate installed package assets.

## A1.4 — Page Reader SSRF/private-network hardening

Accepted. This is P0 before any web research work.

The existing browser-side Page Reader is not enough. It must block:

```text
localhost
127.0.0.0/8
::1
private IPv4 ranges
IPv6 unique-local/link-local ranges
169.254.0.0/16
169.254.169.254
non-http/non-https schemes
redirects to blocked addresses
```

Add:

```text
timeout
max response bytes before full read
redirect limit
content-type guard
audit for blocked requests
```

For extension-backed page reading, apply equivalent URL policy before opening/fetching a page.

## A1.5 — Malformed tool blocks

Accepted. This is P0.

`parseToolCall()` must distinguish:

```ts
type ToolParseResult =
  | { kind: 'none' }
  | { kind: 'tool_call'; call: ToolCall }
  | { kind: 'malformed'; message: string };
```

A malformed tool block should not silently become normal assistant text.

Required behavior:

```text
malformed tool block
→ audit tool.parse_failed
→ show visible error or ask model to retry
→ do not store it as a normal assistant reply without signaling the failure
```

## A2.1 — Idempotent `storage_put`

Accepted. This is P1.

`storage_put` should not use a new random UUID every time if replay could duplicate records.

Use an idempotent key derived from stable runtime data, for example:

```text
message.id = `${conversationId}:${effect.key}`
```

or store a mapping from runtime effect key to message row ID.

Replay after snapshot restore should not duplicate persisted messages.

## A2.2 — Unknown `resolve_effect`

Accepted. This is P0/P1 and it requires Rust + WASM changes.

Fix both:

```text
TypeScript reference runtime
Rust claw-core / WASM runtime
```

Unknown `resolve_effect` IDs must not silently return no output.

Required behavior:

```text
unknown resolve_effect id
→ emit audit_append runtime.resolve_unknown_effect
→ risk medium or high depending context
→ status failure
→ include id only, no sensitive payload
```

If the runtime cannot emit an audit event for this cleanly, return an explicit runtime error effect.

## A2.3 — Provider test fail-closed

Claude Code says this already exists, but confirm the actual Models screen Test button path.

The acceptance rule is:

```text
If profile.apiKeyMode requires a key and SecretVault returns secret_locked or secret_missing:
  provider Test must fail visibly
  provider Test must audit provider.test_failed
  provider Test must not silently run unauthenticated health check
```

Unauthenticated reachability testing is allowed only if it is explicitly labeled as:

```text
Reachability check only — no API key used.
```

That should be a separate explicit behavior, not the default Test fallback.

## A2.4 — Test saves before activation

Accepted. Verify and fix if needed.

Preferred behavior:

```text
Click Test
→ save provider profile form to IndexedDB
→ resolve provider from saved profile
→ run provider test
→ if successful, set active provider
```

Do not let Test use unsaved local React form state and then activate a provider configuration that will not survive reload.

## A2.5 — `importBackup()` self-validation

Accepted. This is P1.

`importBackup()` must call validation internally or require a validated/opaque type that only `validateBackup()` can produce.

Preferred pattern:

```ts
const validated = validateBackup(rawBackup);
await importBackup(db, validated, options);
```

or:

```ts
await importBackup(db, rawBackup, options);
// importBackup internally validates before writing
```

Do not allow future callers to bypass validation accidentally.

## A2.6 — Stronger backup row validators

Accepted. Current key-field validation is not enough.

Add per-collection validators for important tables:

```text
provider_profiles:
  id string
  kind enum
  model string
  enabled boolean
  apiKeyMode enum

skills:
  id/name/version strings
  enabled boolean
  metadata shape

skill_permissions:
  skillId string
  permissions schema

memories:
  id string
  text/title shape
  sensitivity enum
  createdAt number

messages:
  id/conversationId strings
  role enum
  content string
```

Reject invalid enum values and obviously malformed field types.

## A2.7 — wllama integrity

Accepted.

Current state:

```text
CDN consent gate: good
Pinned version: good
Integrity verification: not done
```

Do not claim integrity verification is done until there is actual SHA-256/SRI-style verification or the WASM asset is vendored.

For this pass, acceptable options:

```text
Option A:
  vendor the wllama WASM asset and stop using CDN.

Option B:
  keep explicit CDN consent and mark integrity verification as future work.

Option C:
  fetch bytes, verify known hash, then instantiate if wllama integration supports it.
```

If Option C is technically awkward, prefer A or B. Do not fake it.

## A2.8 — Empty provider/model responses

Accepted.

Missing content should be `invalid_response`, not an empty assistant message.

Apply to:

```text
wllama
Anthropic
OpenAI-compatible paths if relevant
any provider adapter that does `?? ''`
```

## A2.9 — Audit summary redaction

Accepted.

Details redaction is good but insufficient if summaries include raw exception messages.

Policy:

```text
Audit summary should be controlled text.
Details can carry normalized non-secret fields after redaction.
Exception messages should either be classified or redacted before summary insertion.
```

Add tests for secret-like strings in both `details` and `summary`.

## A2.10 — Boot outer-catch updates UI

Accepted.

Any outer boot catch should:

```text
dispatch runtimeFailed
attempt durable audit event
show blocking runtime error
avoid console-only failure
```

Console logging alone is not enough.

---

# Q1 — Sandbox runtime approach / QuickJS decision

## Final decision

Phase D is **in scope for BrowserClaw v0.1**.

BrowserClaw v0.1 includes both:

```text
Plan Runtime:
  structured plan DSL
  default execution path

Sandboxed JS Runtime:
  QuickJS-in-WASM style embedded interpreter
  explicit escalation path
  experimental but real
```

Do **not** defer all of Part D.

Do **not** implement Part D with:

```text
eval
new Function
importScripts
raw Worker eval
dynamic script tags
browser-context JavaScript execution
```

Use a real embedded sandbox. QuickJS-in-WASM is the approved implementation direction for v0.1 unless implementation discovery finds a blocker.

## Dependency decision

A QuickJS-class WASM interpreter dependency is acceptable for v0.1, subject to:

```text
license review
bundle-size review
browser compatibility check
escape/regression tests
resource-limit tests
capability-gating tests
```

Likely candidate:

```text
quickjs-emscripten or equivalent QuickJS-in-WASM package
```

If the dependency proves unsuitable, stop and report alternatives. Do not fall back to browser eval.

## Required sandbox model

The sandboxed JS runtime must have:

```text
no DOM
no window
no document
no localStorage
no indexedDB
no OPFS direct access
no chrome.* extension APIs
no raw fetch
no secrets
no dynamic import
no eval/new Function
no access to app objects
```

Scripts can only access host-provided capabilities:

```js
await fs.readText("/workspace/foo.md");
await fs.writeText("/workspace/report.md", text);
await search.workspace("query");
await web.search({ query: "..." });
await web.readPage({ url: "..." });
```

Each host capability is mediated by BrowserClaw, policy-checked, approval-gated when needed, and audited.

## Runtime routing

The Plan Runtime remains the default.

Use Plan Runtime when:

```text
the task fits known file/search/memory/tool steps
the operation is easy to validate as structured data
the task does not need loops/custom parsing/custom transformation
```

Use Sandboxed JS Runtime only when:

```text
task needs loops
task needs branching
task needs custom parsing
task needs aggregation over variable data
task would become awkward as many DSL steps
user explicitly asks for a script
agent provides a clear reason DSL is insufficient
```

The sandbox is an escalation path, not the default path.

## Phase D implementation requirements

Implement in v0.1:

```text
ScriptRuntimeProvider interface
QuickJS-backed runtime
capability manifest
capability host bridge
timeout limit
operation count limit
output size limit
file read/write limits
network denied by default
approval card for sandboxed scripts
audit every script run and every capability call
sandbox escape regression tests
```

The first version may be intentionally small, but it should be real.

---

# Q2 — Search provider for v0.1

## Decision

For v0.1, search should be routed through the Chrome extension unless a search provider is explicitly proven to work safely from browser-origin JavaScript.

Reason:

```text
Many search APIs do not support arbitrary browser-origin CORS.
Putting search API keys directly into browser JS is also unattractive.
```

So the default v0.1 architecture is:

```text
ChromeExtensionSearchProvider
ChromeExtensionPageReaderProvider
```

not a browser-native direct search provider.

## Provider interfaces remain

Still define provider interfaces:

```ts
interface SearchProvider {
  search(query: string, options: SearchOptions): Promise<SearchResult[]>;
}

interface PageReaderProvider {
  readPage(url: string, options: PageReadOptions): Promise<PageContent>;
}
```

But the first production implementations should be extension-backed.

## BrowserFetch remains useful

Keep BrowserFetch for CORS-enabled APIs and same-origin calls, but do not use it as the primary Web Research path.

## Search provider selection

The Chrome extension can support one or more backend search mechanisms:

```text
user-configured search API, called from extension context
search provider integration
future SearXNG/custom endpoint if user configures it
```

Do not hard-code a provider that requires a hidden hosted service.

---

# Q3 — Chrome extension QA and Docker testing

## Decision

Do **not** mark Chrome extension QA as manual-only.

Add an automated Dockerized Chrome/Chromium extension smoke-test lane.

Manual QA still exists, but only for UX and packaging cases that are difficult to automate.

## Docker testing approach

Create a Docker-based test environment:

```text
Linux container
Node + pnpm
Playwright or Puppeteer
Chromium / Chrome for Testing
BrowserClaw dev or preview server
built unpacked Chrome extension
local static test websites
```

The goal is to test real extension behavior without requiring a developer to install anything manually during the automated gate.

## Recommended first implementation

Since the repo already uses Playwright, start with Playwright and bundled Chromium using a persistent context and extension-loading flags.

If Playwright extension support becomes awkward, use Puppeteer for the extension E2E lane because Chrome's extension testing docs align well with Puppeteer.

Accept either:

```text
Playwright + Chromium persistent context
Puppeteer + Chrome for Testing
```

Do not block on using only one if the other is more practical.

## Automated extension test tiers

### Tier 1 — Unit tests

```text
message protocol validation
URL policy
blocked/private URL detection
origin checks
extractReadablePage pure function
HTML sanitization
permission decision logic
```

### Tier 2 — BrowserClaw integration tests

```text
extension unavailable state
extension available state
readPage success result handling
readPage failure result handling
workspace write from page result
audit event from page read
```

### Tier 3 — Dockerized extension E2E smoke tests

```text
build extension
load unpacked extension
start MV3 service worker
start BrowserClaw app
connect app ↔ extension
read fixture public article page
return title/text/markdown
write result to workspace
record audit
reject unknown external origin
block disallowed URL
surface timeout/failure path
```

## Manual QA remains for

```text
Chrome Web Store packaging
real Chrome install flow
human-facing optional host permission prompts
real-world search provider behavior
real-world search result pages
extension upgrade behavior
```

Manual QA is not a substitute for the automated smoke suite.

## Extension ID handling in tests

Use one of these:

```text
Option A:
  fixed dev/test extension key for stable extension ID

Option B:
  test reads extension ID from service worker URL and injects it into app config

Option C:
  app exposes a test-only extension ID setting
```

Preferred:

```text
Option A for stable E2E
Option B if fixed extension key causes issues
```

## Docker test command

Add a command such as:

```text
pnpm run test:extension:e2e
```

and optionally:

```text
pnpm run test:extension:e2e:docker
```

If Docker is unavailable in a local loop, document it. But the project should include the Docker test lane.

---

# Q4 — Production origin placeholder

## Decision

Yes. Use configurable allowed origins. Do not invent a production domain.

The extension manifest should be generated from config.

Example:

```text
BROWSERCLAW_ALLOWED_WEB_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
```

For v0.1 dev/test:

```text
http://localhost:5173/*
http://127.0.0.1:5173/*
```

For production:

```text
Configured at release time.
```

It is acceptable to have a clearly marked placeholder constant or build variable. It is not acceptable to pretend a fake domain is real.

---

# Q5 — Rust/WASM scope confirmation

## Decision

Rust/WASM changes are in scope for this pass.

Fix unknown `resolve_effect` behavior in both:

```text
TypeScript reference runtime
Rust claw-core / WASM runtime
```

Expected local gate:

```text
cargo test
cargo clippy
pnpm run build:wasm
pnpm run test
```

If a given environment lacks Rust/Cargo, document the failure and do not mark the Rust half complete.

This task should not ship TS-only unless explicitly blocked by unavailable toolchain and clearly deferred.

---

# Q6 — Design notes scratchpad

## Decision

Yes. Create:

```text
docs/WORKSPACE_SCRIPTING_WEBRESEARCH_DESIGN_NOTES.md
```

Use it for cross-pass decisions:

```text
QuickJS-in-WASM selected for v0.1 Sandboxed JS Runtime
no eval/new Function/importScripts
search routes through Chrome extension by default
Chrome extension v0.1 / Firefox v0.2
Dockerized extension E2E testing
Workspace path rules
ContentStore abstraction
tool.call dependency ordering
```

This should prevent repeated re-litigation of architectural choices.

---

# Q7 — OPFS unavailable in Vitest/jsdom

## Decision

Accepted. Use a `ContentStore` abstraction.

Recommended interface:

```ts
interface ContentStore {
  read(path: string): Promise<Uint8Array>;
  write(path: string, bytes: Uint8Array): Promise<void>;
  delete(path: string): Promise<void>;
  stat(path: string): Promise<ContentStat>;
  list(prefix: string): Promise<ContentStat[]>;
}
```

Backends:

```text
OpfsContentStore:
  production browser storage

MemoryContentStore:
  unit tests

UnavailableContentStore:
  explicit unsupported/error path
```

Do not couple Workspace FS logic directly to OPFS APIs. Keep OPFS behind an interface.

---

# Q8 — Ordering dependency: `tool.call`

## Decision

Accepted.

Do not implement DSL `tool.call` until the tool/skill security foundation is fixed.

Required order:

```text
A1.1 execution-time skill permission re-check
A1.2 move permissions out of skill_state
A1.3 read-only package files
then C2 tool.call
```

The DSL must not bypass the same approval/permission path as chat-originated tool calls.

---

# Q9 — TODO evidence annotations

## Decision

Accepted.

As tasks are completed, add evidence comments to the TODO using the same convention as the previous hardening TODO.

Each checked item should have evidence such as:

```text
<!-- src/path/file.ts: functionName; testName in file.test.ts -->
```

Do not check boxes without source/test evidence unless explicitly documented as design-only.

---

# Q10 — `web.search` / `web.readPage` DSL dependency

## Decision

Accepted.

Implement the plan DSL in this order:

```text
1. fs.* operations
2. workspace search operations
3. memory operations
4. tool.call after A1 security hardening
5. web.search / web.readPage after Chrome extension provider exists
```

Do not stub `web.search` / `web.readPage` as fake browser-fetch operations.

---

# Chrome extension v0.1 implementation guidance

## Scope

Implement a Chrome extension companion for v0.1.

Firefox extension is deferred to v0.2.

The extension should be narrow:

```text
read current tab
read specific search-result URL after permission/policy check
extract readable text/metadata
return sanitized content to BrowserClaw
```

It must not become a general browser automation agent.

## Not allowed in v0.1 extension

```text
generic proxy/curl endpoint
form filling
form submission
arbitrary clicking
cookie access
credential extraction
bypassing paywalls
unlimited crawling
arbitrary page-script execution
reading all websites by default
```

## Extension messaging

Use a strict external messaging protocol.

BrowserClaw web app sends:

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

Extension returns:

```json
{
  "ok": true,
  "requestId": "req_123",
  "url": "https://example.com/article",
  "finalUrl": "https://example.com/article",
  "title": "Article title",
  "siteName": "Example",
  "text": "...",
  "markdown": "...",
  "length": 12345
}
```

All messages must be schema-validated.

Reject unknown message types and unknown external origins.

## Permissions

Use Manifest V3.

Prefer:

```text
permissions:
  tabs
  scripting
  storage if needed

optional_host_permissions:
  https://*/*
  http://*/*
```

Do not request `<all_urls>` as a broad install-time host permission unless there is no alternative and the user is clearly warned.

## externally_connectable

Use generated manifest config.

Allow only BrowserClaw origins:

```text
localhost dev origin
127.0.0.1 test origin
production origin at release time
```

Do not allow arbitrary websites to message the extension.

## Page extraction

Implement content extraction as a pure function as much as possible:

```text
input: DOM/document or HTML fixture
output: title, byline/siteName if available, text, markdown
```

Sanitize:

```text
remove scripts
remove styles
remove hidden controls if possible
normalize whitespace
cap output size
do not return cookies/localStorage/sessionStorage
```

For v0.1, basic readable text extraction is acceptable. Readability-style extraction can be improved later.

---

# Dockerized extension E2E details

## Proposed directory layout

```text
extension/
  manifest.template.json
  src/
    serviceWorker.ts
    protocol.ts
    urlPolicy.ts
    extractReadablePage.ts
  tests/

tests/extension-e2e/
  extension.spec.ts
  fixtures/
    public-article.html
    hostile-script.html
    huge-page.html
  docker/
    Dockerfile
```

## E2E scenarios

Required first smoke tests:

```text
1. Extension loads in Chromium.
2. Service worker is discoverable.
3. BrowserClaw detects extension.
4. BrowserClaw can send a validated read_page request.
5. Extension reads local fixture article page.
6. Extracted title/text is returned.
7. BrowserClaw stores result in workspace.
8. BrowserClaw audits page read success.
9. Unknown origin cannot message extension.
10. Blocked URL policy returns permission/policy denial.
```

Later tests:

```text
optional host permission flow
multiple page reads
search result → read top N pages
timeout handling
oversized page handling
extension unavailable fallback UI
```

---

# Revised implementation order

Use this order:

## Part A — Remaining hardening

```text
A1.1 execution-time skill permission re-check
A1.2 protected skill permissions store
A1.3 read-only package files
A1.4 Page Reader / URL policy hardening
A1.5 malformed tool block handling
A2.1 idempotent storage_put
A2.2 unknown resolve_effect audit in TS + Rust/WASM
A2.3 provider test fail-closed verification/fix
A2.4 save-before-test provider activation
A2.5 importBackup self-validation
A2.6 stronger backup validators
A2.8 invalid empty responses
A2.9 audit summary redaction
A2.10 boot outer-catch UI failure
```

## Part B — Workspace FS

```text
ContentStore abstraction
OPFS backend
Memory backend
WorkspaceFs service
path validation
CRUD/list/stat/move/copy
text/range reads
metadata index
grep/search
approval/audit for writes/deletes
backup/restore inclusion
```

## Part C — Plan Runtime

```text
plan schema
validator
executor
step result binding
fs operations
workspace search operations
memory operations
tool.call after A1
approval/audit
rollback/partial failure policy
```

## Part E — Chrome Web Research extension

```text
extension protocol
manifest generation
externally_connectable origins
service worker
content extraction
URL policy
read current tab
read URL/search result
extension-backed search provider
extension-backed page reader provider
BrowserClaw integration UI
Dockerized extension E2E
```

## Part D — Sandboxed JS Runtime

```text
QuickJS-in-WASM dependency review
QuickJS runtime wrapper
capability manifest
host capability bridge
fs/search/web/memory/tool capabilities
approval card
timeout/output/op limits
sandbox escape tests
audit all script runs/capability calls
```

Part D is in v0.1, but it should come after the safer Plan Runtime and WebResearch foundations unless there is a strong reason to pull it earlier.

---

# Final decisions summary

```text
Q1:
  Phase D is in scope for v0.1.
  Use QuickJS-in-WASM style embedded interpreter.
  No eval/new Function/importScripts/raw Worker eval.

Q2:
  Search routes through Chrome extension by default for v0.1.
  Browser-direct search only if provider is proven CORS-compatible and key handling is acceptable.

Q3:
  Add Dockerized Chrome/Chromium extension E2E tests.
  Do not rely only on manual QA.

Q4:
  Use configurable allowed origins.
  Dev/test origins real; production origin configured later.

Q5:
  Rust/WASM changes are in scope for unknown resolve_effect auditing.

Q6:
  Create docs/WORKSPACE_SCRIPTING_WEBRESEARCH_DESIGN_NOTES.md.

Q7:
  Use ContentStore abstraction with OPFS and memory test backends.

Q8:
  tool.call waits for skill/tool permission hardening.

Q9:
  Add evidence comments to TODO as tasks are completed.

Q10:
  Add web.search/web.readPage DSL ops only after extension providers exist.
```

---

## Most important standard

BrowserClaw must not create a new unsafe escape hatch while adding scripting and web research.

The rule is:

> Dynamic scripting and web research must be capability-mediated, approval-gated, resource-limited, and audited. They must not bypass the same safety model that tools, skills, providers, workspace files, and secrets already use.

