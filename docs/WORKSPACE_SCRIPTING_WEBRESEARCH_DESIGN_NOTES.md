# Workspace / Scripting / Web Research — Design Notes (scratchpad)

Cross-iteration implementation decisions for the pass described in
`BROWSERCLAW_WORKSPACE_SCRIPTING_WEBRESEARCH_SPEC.md` /
`...TODO.md`. This file is a decision log so architectural choices are not
re-litigated each Ralph-loop iteration. It is **not** canonical spec — the spec
and TODO are. Newest decisions at the bottom of each section.

## Locked decisions (from `docs/replies2.md`, 2026-06-14)

- **Build order:** Part A (hardening) → B (Workspace FS) → C (Plan Runtime) →
  E (Chrome extension / web research) → D (Sandboxed JS Runtime) → F/G/H.
  Do not implement web/search/scripting features before the P0 hardening lands.
- **Sandboxed JS Runtime (Part D) is IN SCOPE for v0.1.** Use a
  **QuickJS-in-WASM** embedded interpreter (e.g. `quickjs-emscripten`-class).
  **Never** `eval` / `new Function` / `importScripts` / raw Worker-eval /
  dynamic `<script>` / any browser-context JS execution. If the dependency
  proves unsuitable, STOP and report — do not fall back to browser eval.
- **Search routes through the Chrome extension by default** for v0.1 (most search
  APIs block browser-origin CORS and we won't put keys in browser JS). Define
  `SearchProvider` / `PageReaderProvider` interfaces, but the first production
  impls are extension-backed. Browser-direct search only if a provider is proven
  CORS-safe with acceptable key handling.
- **Chrome extension QA is automated, not manual-only.** Add a Dockerized
  Chromium extension E2E lane (Playwright persistent-context preferred; Puppeteer
  + Chrome-for-Testing acceptable). Command: `pnpm run test:extension:e2e`
  (+ optional `:docker`). Manual QA only for store packaging / install / upgrade /
  real host-permission prompts. Tiers: (1) unit (protocol, URL policy, extraction
  pure fn), (2) BrowserClaw integration, (3) Dockerized E2E smoke.
- **Configurable allowed origins** for the extension manifest — dev/test origins
  real (`http://localhost:5173`, `http://127.0.0.1:5173`), production origin a
  clearly-marked placeholder configured at release. Never invent a fake domain.
- **Rust/WASM changes are in scope** for the unknown-`resolve_effect` audit
  (item 1.7 / A2.2): fix in both the TS reference runtime and `claw-core`/WASM;
  gate includes `cargo test` / `cargo clippy` / `pnpm run build:wasm`. If the
  Rust toolchain is unavailable in an environment, document and do not mark the
  Rust half complete (do not ship TS-only silently).
- **`ContentStore` abstraction** for Workspace FS bytes — `OpfsContentStore`
  (prod), `MemoryContentStore` (unit tests; jsdom has no OPFS),
  `UnavailableContentStore` (explicit error path). Keep OPFS behind the interface.
- **`tool.call` (DSL/sandbox) waits for A1.1 → A1.2 → A1.3** so it cannot bypass
  the same approval/permission path as chat-originated tool calls.
- **TODO evidence comments** required when ticking a box:
  `<!-- src/path/file.ts: fnName; testName in file.test.ts -->`. No box checked
  without source/test evidence unless explicitly design-only.
- **Plan DSL op order:** fs.* → workspace search → memory → tool.call (after A1)
  → web.search / web.readPage (after extension providers exist). Do NOT stub the
  web ops as fake browser-fetch.

## Open questions to resolve when the relevant part starts

- Exact QuickJS-in-WASM package + license/bundle-size review (Part D).
- Workspace path normalization rules — finalize the reject list vs. the spec
  §2.4 examples when Part B2 starts.
- Search provider backend(s) the extension will call (Part E2).

## Implementation log

### A1.1 — re-check skill permission at approved-execution time (done)
- Added `src/skills/skillPermissions.ts` `authorizeSkillTool(db, skillId, tool)`
  as the SINGLE fail-closed authorization read (skill exists + enabled + tool
  declared). Reads `skill_state['__permissions__']` for now; **A1.2 will relocate
  that read here in one place.**
- `toolRunner.ts`: proposal handler now calls `authorizeSkillTool`; and
  `runApprovedToolCall` RE-CHECKS via the same helper before running, auditing
  `tool.permission_recheck_failed` and resolving `tool_not_permitted` on failure.
  Execution no longer trusts the approval/Redux state.

### A1.2 — move skill permissions out of mutable skill_state (done)
- New PROTECTED `skill_permissions` table (`db/types.ts SkillPermissionsRow`,
  `db/db.ts` — **DB_VERSION 4 -> 5**). v5 upgrade migrates every
  `skill_state['__permissions__']` row: valid blob (guarded by
  `skillTypes.ts isSkillPermissions`) -> `skill_permissions`, then the old row
  deleted; malformed blob dropped (fail closed) + `skill.permissions_migration_failed`
  audit (written via `buildAuditRow` inside the upgrade tx).
- `skillPermissions.ts loadSkillPermissions(db, id)` is now the SINGLE read path
  (used by authorizeSkillTool, skillManager.fsFor, SkillsScreen). Install/reinstall
  is the ONLY writer (skillManager). uninstall deletes it.
- Backup: added `skill_permissions` to COLLECTIONS + KEY_FIELDS (`['skillId']`).
- GOTCHA: `skill_state` is keyed `[skillId+key]` — `key` is NOT a standalone
  index, so the migration must `.filter(r => r.key === '__permissions__')`, not
  `.where('key')` (which throws SchemaError).
- SkillFs reserved-key guard (`__`-prefix) stays as defense in depth.

### A1.3 — installed skill package files are read-only (done)
- New writable `skill_outputs` table (`db/types.ts SkillOutputRow`, `db/db.ts`
  **DB_VERSION 5 -> 6**, add-table-only migration). `SkillFs.writeText` now
  writes there and NEVER touches `skill_files`; `readText` returns a generated
  output if present else the read-only package asset (output shadows package).
- `skillManager` uninstall + clearState-reinstall clear skill_outputs;
  install/reinstall remains the ONLY writer of `skill_files`.
- Backup: `skill_outputs` added to COLLECTIONS + KEY_FIELDS (`['skillId','path']`).
- NOTE: there is still NO `skill_fs_write_text` runtime effect, so skills can't
  write files from the runtime yet anyway — this hardens the SkillFs API itself
  so future wiring can't mutate package assets. The `skill_state` and
  `/workspace` write targets in the spec are left for later (skill_state already
  works via setState; /workspace lands in Part B).

### A1.4 — Page Reader SSRF / network hardening (done)
- NEW shared `src/net/urlSafety.ts` (reused by future `browser_fetch`, E3):
  `classifyFetchUrl`/`assertFetchUrlAllowed`/`BlockedUrlError`. http(s) only;
  blocks localhost/.localhost/.local, IPv4 loopback/0.0.0.0/8/10.8/172.16.12/
  192.168.16/100.64.10(CGNAT)/169.254.16(incl 169.254.169.254 metadata)/
  multicast, and IPv6 ::1/::/fe80::/fc00::/ff00:: + IPv4-mapped (dotted AND hex).
- `pageReaderTool`: validator gate (+ `web.fetch_blocked` audit when db/dispatch
  present) -> AbortController timeout (`ctx.timeoutMs`, default 15s) -> fetch with
  `credentials:'omit'`, no custom headers -> re-validate final `response.url`
  after redirects -> `readCappedText` (content-length precheck + streamed cap at
  MAX_PAGE_BYTES=2MB) -> htmlToText slice.
- GOTCHAs:
  * WHATWG URL normalizes `http://2130706433/` -> 127.0.0.1 and `[::ffff:127.0.0.1]`
    -> `[::ffff:7f00:1]` (HEX). Must parse the hex IPv4-mapped form, not just dotted.
  * eslint `preserve-caught-error`: a `throw new Error()` inside a `catch` MUST pass
    `{ cause: error }`. Added to both timeout/network throws.
  * `new Response(str).url` is '' — guard the final-URL re-validation with
    `if (response.url)` so the happy path (synthetic responses in tests) doesn't
    trip "invalid_url".
- Added `ctx.timeoutMs` to ToolContext (injectable, like fetchImpl) for fast tests.

### A1.5 — malformed tool blocks fail explicitly (done)
- `parseToolCall` now returns `ToolParseResult` = `{kind:'none'}` |
  `{kind:'tool_call', call}` | `{kind:'malformed', message}` (was `ToolCall|null`).
- `llmRunner`: malformed -> `recordAudit('tool.parse_failed', source:'runtime',
  failure)` + `resolve_effect {ok:false, error:{kind:'tool_parse_failed'}}`
  (reuses the same failed-LLM-effect path as provider_request_failed, so it's
  surfaced as a protocol error and NEVER stored as an assistant message).
- DELIBERATE DEVIATION from the TODO: "missing args -> parse_failed" NOT
  implemented — an OMITTED args is valid (no-arg tools; the existing "defaults
  args to {}" behavior). Non-object args (e.g. `"args":[1]`) IS malformed and is
  tested. The spec's "ask model to retry" is its own optional item, deferred.

### A2.1 — idempotent storage_put (done)
- `storageRunner.ts`: message row id = `${effect.conversation_id}:${effect.key}`
  (the runtime's key is `m${message_count}`, deterministic per message position),
  replacing `crypto.randomUUID()`. Replay (e.g. snapshot restore re-emitting the
  same keyed effect) upserts the same row — no duplicate message.
- Skipped the optional "audit duplicate/replay" sub-item: a replay is meant to be
  a silent idempotent upsert; auditing every one would be noise.

### A2.2 — unknown resolve_effect audited (TS + Rust + WASM) (done)
- THE Rust item. Both runtimes' unknown/non-pending resolve arm now emits
  `Effect::AuditAppend { event_type: "runtime.resolve_unknown_effect", risk:
  "medium" }` instead of returning nothing: `crates/claw-core/src/lib.rs` (`_` arm
  of the ResolveEffect match) and `src/runtime/referenceRuntime.ts` (unknown-kind
  branch). Recoverable — no state change.
- `effectExecutor.ts`: new `RUNTIME_FAILURE_EVENTS` set records that event with
  `status: 'failure'` (the audit_append channel otherwise defaults to success;
  the effect schema has no status field, so the host maps it by event type —
  avoids churning every AuditAppend call site + the WASM ABI).
- Rebuilt WASM: only `src/runtime/wasm/claw_wasm_bg.wasm` changed (JS bindings
  identical — same interface).
- Toolchain confirmed available: cargo 1.94.1, wasm-pack 0.13.1. Gate now also
  runs `cargo test -p claw-core`, `cargo clippy -p claw-core/-p claw-wasm
  --all-targets -D warnings`, `pnpm run build:wasm`.
- Updated the pre-existing Rust test `resolving_an_unknown_effect_is_a_no_op` ->
  `..._audits_a_failure_and_changes_no_state` (old test asserted the silent no-op).

### A2.3 — provider test fails closed on locked/missing secret (done)
- responses2.md said resolveApiKey already fails closed — TRUE, but the Models
  Test button IGNORED that and ran `checkHealth(undefined)` anyway (the old
  comment literally said "an unauthenticated health check is still meaningful").
  That violated spec 1.8. FIXED: `ModelsScreen.handleTest` now returns after a
  `!keyResult.ok` with `providerHealthSet('unreachable')` + a `provider.test_failed`
  audit (summary carries keyResult.kind, never the key). Reachability-only is the
  spec's separate optional action, deferred.
- TEST FALLOUT: 3 existing tests ("no API key needed", "durable audit", "edited
  values") used the OpenAI card whose default apiKeyMode is 'encrypted' + a locked
  vault — they were GREEN only because of the bug (unauth fallback). Fixed by
  switching those cards to 'No key' mode before Test (their names already say "no
  API key needed"). New test switches to 'encrypted' to exercise fail-closed.
- Default profile apiKeyModes (providerProfiles.ts): openai/anthropic/compatible =
  'encrypted'; ollama/llama-server = 'none'.

### A2.4 — provider Test saves before activation (done)
- `ModelsScreen.handleTest` now `await saveProviderProfile(db, buildRow())` FIRST
  (inside its own try: on failure -> toast 'Save failed' + return, no test). Then
  resolve/key-check/checkHealth; activeProviderSet only on `connected`. So a
  reload can't show a config different from what was tested/activated.
- Tests: extended "tests ... edited values" to assert the baseUrl persisted to
  db.provider_profiles; new "does not run the provider test when saving fails"
  (spies db.provider_profiles.put -> reject; asserts fetch not called +
  activeProviderId null).

### A2.5 — backup import self-validation (done)
- `importBackup` now runs `validateBackup(backup, limits)` first and throws
  "Refusing to import an invalid backup: <reason>" on failure — no caller can
  bypass the allowlist / version / key-field / size / raw-secret checks. Added an
  optional `limits` param (4th) for parity with validateBackup.
- Chose unconditional re-validation over reusing the UI's earlier result: it's
  pure and cheap, and a "pre-validated" flag would itself be a bypass vector.
- Side effect: the old "rolls back if a collection fails" test now fails at
  validation (its bogus skill_state row) BEFORE the transaction — still throws,
  still no partial write, so it stays green.

### A2.6 — strengthen backup row validators (done)
- `backupService.ts` ROW_VALIDATORS: per-collection enum/type checks for
  messages, conversations, memories, audit_events, provider_profiles, skills,
  skill_permissions (isSkillPermissions), model_catalog. Enum helpers via `oneOf`.
- ORDER MATTERS: row validators run LAST in the per-row loop — AFTER the
  raw-secret and size checks — so a secret/oversize row reports its own
  (more security-critical) reason. (Discovered by 3 existing tests using minimal
  rows to probe secret/size; moving the validator after those kept them green.)
- Skipped: model_catalog has no `status` field (only provider/label validated);
  app_settings keys left open-ended (allowlist would reject future settings).

### A2.7 — wllama runtime integrity (SHA-256 verify) (done)
- Chose the strongest option (real verification, not a doc note). No false
  integrity claim existed in code/docs beforehand (verified by grep).
- NEW src/wllama/runtimeIntegrity.ts: `WLLAMA_WASM_SHA256` (real pinned hash of
  @wllama/wllama@3.4.1 wllama.wasm = a3e827b9…, computed via curl+sha256sum),
  `sha256Hex`, `verifyRuntimeBytes`, `fetchVerifiedRuntimeUrl` (fetch -> hash ->
  return application/wasm blob URL of the VERIFIED bytes; throws
  WllamaIntegrityError on mismatch, plain Error on bad fetch).
- engine.ts getInstance: `const verifiedWasmUrl = await fetchVerifiedRuntimeUrl(WASM_URL);`
  then `new Wllama({ default: verifiedWasmUrl })`. A mismatch throws through the
  existing catch -> onRuntimeLoad(false) audit + rethrow (fail closed).
- GOTCHA (TS6): crypto.subtle.digest wants an ArrayBuffer-backed BufferSource;
  Uint8Array<ArrayBufferLike> fails. Normalize via `bytes.slice()` /
  `new Uint8Array(arrayBuffer)`.
- LIMITATION: the engine wiring (blob URL into wllama) is real-browser-only —
  engine mocks wllama in unit tests — so it needs real-browser verification like
  the rest of the engine. The verification helper itself IS fully unit-tested.
- IMPORTANT: bump WLLAMA_WASM_SHA256 in lockstep whenever the pinned wllama
  version/WASM_URL changes, or local models will fail closed.

### A2.8 — invalid/empty provider responses are errors (done)
- New `invalid_response` ProviderErrorKind (errors.ts) + message + kindToHealth
  -> 'unreachable'. Adapters now throw it instead of returning `?? ''`:
  openAiCompatible.ts (empty/missing choices[0].message.content), anthropic.ts
  (no text block), wllamaProvider.ts (empty generation). The wllama engine still
  returns a string; the provider boundary validates it.
- isFailoverEligible leaves invalid_response false (not cors/unreachable/unknown)
  — an empty response isn't a reachability failure.
- Tests: providers.test OpenAI (empty / missing content / no choices) + Anthropic
  (no text block) -> invalid_response.

### A2.9 — audit summary redaction (done)
- `auditService.ts redactText` scrubs credential-shaped substrings from free
  text (Authorization headers, bearer tokens, sk-/sk-ant-/xox/AKIA/ghp_/ya29./
  JWT — thresholds mirror the backup detector to avoid false positives like
  "task-manager"). Applied to `summary` in buildAuditRow (single choke point;
  the Redux live-tail uses the already-redacted row.summary). details redaction
  unchanged.

### A2.10 — runtime boot outer-catch updates UI (done)
- main.tsx boots on import (not unit-testable), so the catch BODY moved to a
  testable helper `reportRuntimeBootFailure({dispatch,db}, error)` in
  runtimeBoot.ts (no import side-effects, already tested). It console.errors,
  dispatches runtimeFailed (status error + fatal -> app-wide block), and does a
  best-effort durable audit (runtime.boot_failed). main.tsx's
  `bootRuntime().catch` calls it (was console.error only).
- This handles UNEXPECTED boot failures outside the runtime's own onFailed path
  (DB open, snapshot read, host wiring throwing).

## Part B — Workspace Filesystem

### B1 — data model + storage backend (done)
- src/workspace/types.ts: WorkspaceFileMeta (id, path, kind, sizeBytes, times,
  createdBy/updatedBy actors, source, tags, checksum, indexedAt) + WORKSPACE_ROOT
  ('/workspace') + WORKSPACE_DIRS.
- DB v6->v7: `workspace_files` table `'id, &path, kind, updatedAt, *tags'` —
  METADATA ONLY (bytes live in OPFS). &path = unique path index.
- src/workspace/contentStore.ts: ContentStore interface (read/write/delete/has by
  id) + OpfsContentStore (navigator.storage.getDirectory, files flat under
  'workspace-content/') + MemoryContentStore (tests) + UnavailableContentStore
  (every op throws WorkspaceUnavailableError) + isOpfsAvailable + createContentStore
  (OPFS or Unavailable — NO silent localStorage fallback). Errors:
  WorkspaceUnavailableError, WorkspaceContentMissingError.
- GOTCHA (TS6 again): FileSystemWritableFileStream.write wants ArrayBuffer-backed;
  pass `bytes.slice()`. And to call a 0-param Unavailable* method with args in a
  test, type the var as `ContentStore` (fewer-params-satisfies-interface).
- jsdom has no OPFS -> isOpfsAvailable() false -> createContentStore() returns
  UnavailableContentStore (tested). Real OPFS path is browser-only.
- NEXT B-phases: B2 path validation (normalizeWorkspacePath/validateWorkspacePath),
  B3 CRUD WorkspaceFs (ties metadata + ContentStore), B4 range reads, B5 search/grep,
  B6 approval+audit, B7 UI, B8 backup.

### B2 — path validation (done)
- src/workspace/path.ts: validateWorkspacePath -> {ok,path}|{ok:false,reason};
  normalizeWorkspacePath (throws); isValidWorkspacePath. Checks BOTH raw and
  percent-decoded form (encoded traversal caught), rejects backslash/null/control
  (control via codePoint loop -- NO control-regex, so no eslint no-control-regex
  and no eslint-disable), requires first segment "workspace", rejects "." / ".."
  and any leading-dot (hidden/reserved) segment, collapses // and trailing slash.
- GOTCHA: literal control bytes in test fixtures survive Write but are fragile;
  converted to backslash-u escapes via perl for robust ASCII source.

### B3 — WorkspaceFs CRUD (done)
- src/workspace/workspaceFs.ts: WorkspaceFs class. Deps injected: {db, content
  ContentStore, now?, newId?}. Every path normalizeWorkspacePath'd first.
  createFile/readFile/readText/updateFile/appendFile/deleteFile/mkdir/listDir/
  stat/moveFile/copyFile/exists. Content keyed by metadata id; move keeps the id
  (path-only change), copy makes a new id+bytes. SHA-256 checksum per file.
  Content written BEFORE metadata -> a failed content write leaves no row.
  Errors: WorkspacePathConflictError, WorkspaceNotFoundError, WorkspaceNotAFileError.
- listDir returns IMMEDIATE children only (prefix + no further slash).
- Tests use MemoryContentStore + injected now/newId for determinism.

## Locked decisions (2026-06-15, mid-pass)

- **E2 search backend:** a COMMERCIAL search API (Tavily / Brave / Exa) — user
  will name the specific one. Key in SecretVault; CALLED FROM THE EXTENSION
  context (not browser-direct), so E2 needs: (a) a `search` message type added to
  the extension protocol + service-worker handler, (b) a profile in IndexedDB,
  (c) an extension-backed SearchProvider that sends the search message, (d) error
  classification (auth/rate_limit/network/invalid_response/unavailable) + audit
  web.search_started/completed/failed. Confirm the exact provider before E2.
- **Resume cadence:** the QuickJS sandbox (Part D) + F/G/H are to be done in a
  FRESH session (this one is context-saturated). All work is pushed at fa3ec26.

### D1 — Script runtime policy + router (done, 2026-06-15)
- src/script/scriptPolicy.ts: ScriptExecutionPolicy {defaultRuntime:'plan_dsl',
  sandboxedScriptingEnabled, advancedMode} + DEFAULT_SCRIPT_POLICY (both gate
  flags false -> v0.2 unavailable by default). ScriptRuntimeKind =
  'plan_dsl'|'sandboxed_script'. SANDBOX_RUNTIME_LABEL='Sandboxed Script Runtime v0.2'.
- ScriptCapabilities {fsRead[], fsWrite[], webSearch, webRead[], network
  'deny'|'mediated', secrets 'deny'} — SHARED shape; D2's full request schema
  reuses it. ScriptEscalation {reason?, capabilities?, userRequested?}.
- routeScript(input, policy=DEFAULT) -> RuntimeDecision: no escalation OR
  (fitsKnownOps && !userRequested) -> {runtime:'plan_dsl'}. Else v0.2 path:
  reject unless sandboxedScriptingEnabled && advancedMode; reject missing
  reason / missing capabilities / secrets!=='deny'; else
  {runtime:'sandboxed_script', requiresApproval:true, risk}.
- classifyCapabilityRisk: high if network 'mediated' OR broad fsRead/fsWrite
  (BROAD_SCOPES: *, **, /*, /**, /workspace, /workspace/*, /workspace/**);
  medium if any bounded write/webSearch/webRead; else low.
- `fitsKnownOps` is supplied by the caller (validatePlan over a candidate plan).
- NEXT D2: BrowserClawScriptRequest schema validator (type/version/runtime/
  title/reason/code/capabilities/limits; no secrets; no direct network unless
  mediated web; path scopes must be safe workspace globs). Reuse ScriptCapabilities.

### D2 — Sandboxed script request schema (done, 2026-06-15)
- src/script/scriptRequest.ts: BrowserClawScriptRequest {type
  'browserclaw_script_request', version 1, runtime 'sandboxed_script', title,
  reason, code, capabilities: ScriptCapabilities (reused from D1), limits:
  ScriptLimits}. validateScriptRequest(input) -> {ok,request,risk}|{ok:false,errors}.
- ScriptLimits core REQUIRED: timeoutMs, maxOutputBytes, maxFileReads,
  maxFileWrites (all positive, <= MAX_TIMEOUT_MS 30s / MAX_OUTPUT_BYTES 1MiB /
  MAX_FILE_READS 1000 / MAX_FILE_WRITES 200). Extended optional (maxLogBytes,
  maxTotalBytesRead/Written, maxWebRequests, maxPagesRead) enforced by D5.
- Capability rules: fsRead/fsWrite scopes each isValidWorkspacePath (globs like
  /workspace/docs/** pass; /etc/passwd and /workspace/../x rejected). webRead
  each classifyFetchUrl.ok. secrets must be 'deny'|absent. network 'deny'|
  'mediated' ONLY (no raw network); 'mediated' REQUIRES webSearch||webRead.
  Risk via classifyCapabilityRisk (broad write -> high but ACCEPTED).
- Tests: src/script/scriptRequest.test.ts (13). vitest 671->684.
- NEXT D3: pnpm add quickjs-emscripten. QuickJS-in-WASM sandbox in a Worker (NO
  eval/new Function in app ctx). Expose NONE of window/document/localStorage/
  sessionStorage/indexedDB/OPFS/fetch/XHR/WebSocket/EventSource/chrome/cookies/
  secrets. Sandbox-escape regression tests = P0 security-critical. Inject the
  QuickJS module so the core is unit-testable headless (the escape tests run the
  real interpreter; Worker wiring may be a thin shell tested in Docker E2E).

### D3 — Sandboxed script runtime (QuickJS-in-WASM) (done, 2026-06-15)
- DEP: pnpm add quickjs-emscripten 0.32.0. Async variant via
  newQuickJSAsyncWASMModule() (supports async host fns + top-level await).
  Prod build: WASM bundles self-contained (no separate fetch); build OK.
- src/script/sandbox.ts: runSandboxedScript(code, opts, injectedModule?) ->
  SandboxResult {ok:true,value} | {ok:false,error,errorKind}. errorKind:
  script_error|timeout|cancelled|internal_error.
  - Fresh QuickJS context = ONLY ECMAScript built-ins. No window/document/
    storage/indexedDB/OPFS/fetch/XHR/WebSocket/EventSource/chrome/navigator/
    secrets — proven by escape tests run UNDER jsdom (host realm HAS them).
  - Code wrapped `(async () => {\n<code>\n})()` -> supports await + return.
  - Marshalling: toHandle(vm,value) recursive (string/number/bool/null/array/
    object; fns/symbol/bigint -> undefined; dispose children). Read back via
    vm.dump. Host args via vm.dump(argHandle).
  - Host injection: opts.host = {namespace: {fn}}. installHostNamespace builds
    an object of vm.newAsyncifiedFunction wrappers; host throw -> {error:
    vm.newError(msg)} rejects the in-sandbox promise. This is D4's substrate.
  - Timeout/cancel: vm.runtime.setInterruptHandler checks signal.aborted ->
    'cancelled', now()-start>timeoutMs -> 'timeout' (now injected for tests).
  - Lifecycle: evalCodeAsync -> resolvePromise + executePendingJobs -> await
    settled. VM disposed in finally (always). Module cached singleton.
- Tests: src/script/sandbox.test.ts (24): marshalling, host await/throw,
  13-global FORBIDDEN escape table, no-leak-to-host, mediated-only exposure,
  script error classify, infinite-loop timeout, abort cancel. vitest 684->708.
- NEXT D4: capability proxy — wrap WorkspaceFs/WebResearchService/memory/tool
  as the `host` namespaces (fs.readText/writeText/search/grep, web.search/
  readPage, memory.search, tool.call via permission model). EVERY call
  policy/scope-checked against the request's capabilities (fsRead/fsWrite
  globs); denied -> explicit error + audit. Then D5 (count/byte limits in this
  proxy), D6 (approval card + script.sandbox_* audit). DEFERRED: Worker hosting -> F2.

### D4 — Sandbox mediated capability proxy (done, 2026-06-15)
- ADDITIVE to D1/D2: ScriptCapabilities += memoryRead?:boolean, tools?:string[].
  D2 validates both; classifyCapabilityRisk: tools present -> medium.
- src/script/sandboxCapabilities.ts: buildSandboxHost(ctx, capabilities) ->
  SandboxHostApi — the ONLY bridge out of the D3 VM. SandboxCapabilityContext
  {fs, db, dispatch, web?, toolCtx?, onAudit?}. SandboxCapabilityError.
- Namespace exposure is capability-driven (so typeof unused-ns === 'undefined'):
  fs iff fsRead||fsWrite; web iff webSearch||webRead; memory iff memoryRead;
  tool iff tools[]. Each CALL re-checks its specific scope:
  - globToRegExp: ** -> .*, * -> [^/]*, regex-escape the rest, anchored ^$.
    matchesAnyScope(path, scopes). fs.readText/writeText normalize path first
    (invalid path -> deny). fs.search/grep filter results to fsRead scope.
  - web.search needs webSearch===true; web.readPage needs url in webRead scope
    (glob match over the full URL). Both need ctx.web present.
  - memory.search read-only (id/title/text/tags); tool.call -> runToolCall with
    allowedTools=capabilities.tools (existing permission model).
- deny(cap,target,reason): audit allowed:false + throw -> rejected promise in
  the script. Every allowed call also audited. onAudit injectable (F4 backs it
  with recordAudit -> script.capability_*). Redux-agnostic.
- Tests: src/script/sandboxCapabilities.test.ts (10) end-to-end via
  runSandboxedScript. vitest 708->718.
- NEXT D5: resource limits as COUNTERS in this proxy (maxFileReads/maxFileWrites/
  maxTotalBytesRead/Written/maxWebRequests/maxPagesRead/maxOutputBytes/maxLogBytes).
  Wrap buildSandboxHost (or thread a LimitTracker) so each fs/web call increments
  + throws a 'limit_exceeded' when over. timeout/cancel already in D3 runtime.
  Output-size cap on the returned value. Then D6 (approval card + script.sandbox_* audit).

### D5 — Sandbox resource limits (done, 2026-06-15)
- src/script/sandboxCapabilities.ts: LimitTracker(limits) counts fileReads/
  fileWrites/bytesRead/bytesWritten/webRequests/pagesRead/logBytes; each accessor
  throws SandboxLimitError when a ceiling is crossed and records `tripped`.
  buildSandboxHost(ctx, caps, tracker?) threads it: readText beginFileRead+
  addBytesRead, writeText beginFileWrite, web.search countWebRequest, web.readPage
  countWebRequest+countPageRead, console.log -> appendLog (maxLogBytes).
- runSandboxWithLimits(ctx, code, {capabilities, limits, signal?, now?}) ->
  LimitedSandboxResult (SandboxResult + logs?). Wires limits.timeoutMs/signal to
  the D3 interrupt handler; builds the host with a tracker; after the run:
  if tracker.tripped -> errorKind 'limit_exceeded' (covers fire-and-forget log
  overflow + swallowed errors); else if output JSON size > maxOutputBytes ->
  limit_exceeded; else passthrough. console.log collected into result.logs.
- Tests: src/script/sandboxLimits.test.ts (8). vitest 718->726.

### D3 RUNTIME REWRITE (asyncify -> deferred promises) — IMPORTANT
- The D3 sandbox originally used newQuickJSAsyncWASMModule + newAsyncifiedFunction
  + evalCodeAsync. That HANGS when a script awaits host calls INSIDE A LOOP
  (proved: a 5-iteration loop of awaited host fns never returns). v0.2 scripts
  exist for loops, so this was fatal.
- Rewrote to the deferred-promise pattern (sync getQuickJS module): host fns are
  vm.newFunction returning vm.newPromise().handle, resolved/rejected from a host
  Promise.resolve().then(fn); deferred.settled.then(executePendingJobs). The
  runner drives the script's returned promise via resolvePromise + a loop that
  pumps executePendingJobs and `await setTimeout` (yields to the host event loop)
  until settled, honoring the interrupt-based timeout/cancel throughout.
- Public API (runSandboxedScript signature, SandboxResult, host injection) UNCHANGED.
  All D3 escape tests + D4 + D5 pass. injectedModule param is now QuickJSWASMModule.
- GOTCHA: erasableSyntaxOnly (TS6) forbids constructor parameter properties —
  declare the field + assign in the body (LimitTracker.limits).

### D6 — Sandboxed script approvals + audit (done, 2026-06-15) — PART D COMPLETE
- src/script/scriptRuntime.ts (mirrors planRuntime.ts; Redux-agnostic via audit sink):
  - buildScriptProposal(request, risk) -> ScriptProposal {runtime
    SANDBOX_RUNTIME_LABEL, title, reason, codePreview(<=2000)+codeTruncated, risk,
    capabilities[] summary, fileScopes{reads,writes}, webPermissions{search,read},
    network, limits}.
  - proposeScript(ctx, input): validateScriptRequest -> audit
    script.sandbox_requested (valid) | script.sandbox_rejected (invalid) ->
    {ok,proposal}|{ok:false,errors}.
  - rejectScript(ctx, request): audit script.sandbox_rejected (runs nothing).
  - runApprovedScript(ctx, input, {signal?,now?}): re-validate -> audit
    sandbox_approved + sandbox_started -> runSandboxWithLimits (onAudit ->
    script.capability_used/capability_denied per call) -> terminal audit by
    errorKind: ok=sandbox_completed, timeout=sandbox_timeout,
    cancelled=sandbox_cancelled, else sandbox_failed.
  - ScriptRuntimeContext = SandboxCapabilityContext (fs/db/dispatch/web?/toolCtx?).
- Tests: src/script/scriptRuntime.test.ts (10). vitest 726->736.
- P1 inline capability/limit editing deferred to G2 (UI); runApprovedScript
  re-validates so an edited manifest is always re-checked.
- ===== PART D (D1-D6) COMPLETE. Sandboxed v0.2 script runtime: policy/routing,
  request schema, QuickJS-in-WASM sandbox (deferred-promise bridge), mediated
  capabilities, resource limits, approvals+audit. All green, all pushed. =====
- NEXT: Part F (Redux integration — capability model F1, runtime effects F2,
  approval wiring F3 [wire workspaceOps + planRuntime + planRunner + scriptRuntime
  into approvalRequested/approvalResolved listeners], audit builders F4), Part G
  (UI: G1 workspace done-ish, G2 script approval cards [plan+sandbox], G3 web
  research status), E2 (search — user names Tavily/Brave/Exa), Part H (QA gate).

### F1 — Unified capability model (done, 2026-06-15)
- src/runtime/capabilities.ts: capability vocabulary + scope + risk (no I/O, no state).
  Names: workspace.read/write/delete/search, web.search/readPage/readCurrentTab,
  script.plan/sandbox, skill.tool.<name> (SKILL_TOOL_PREFIX family). CapabilityName
  union; isKnownCapabilityName (type guard); skillToolName() extracts tool (bare
  'skill.tool.' rejected). CapabilityScope {paths[] workspace globs, domains[],
  urls[] safe http(s), limits{} non-negative}. validateCapability/validateScope
  fail-closed (unsafe path/url, negative limit, unknown name -> errors).
  classifyCapabilityRisk: delete/sandbox -> high; workspace.write broad path
  (BROAD_SCOPES) -> high else medium; read/search -> low; web/plan/skill.tool ->
  medium. aggregateRisk = max over a set (low when empty).
- Tests: src/runtime/capabilities.test.ts (13). vitest 736->749.
- NOTE: scriptPolicy.ts has its OWN classifyCapabilityRisk over the ScriptCapabilities
  MANIFEST shape; this F1 one is over individual named Capability {name,scope}. Both kept.
- NEXT F2: runtime-effect / host-side proposal actions for workspace file op,
  workspace search, plan proposal, sandbox script proposal, web search, web page
  read, extension request. Missing handler FAILS CLOSED (effectExecutor failEffect
  precedent); all failures resolve as errors + audit. Tests: missing handler,
  success, failure. effectTypes.ts already has script_plan_proposal (C5).

### F2 — Runtime effects for the new subsystems (done, 2026-06-15)
- effectTypes.ts Effect union += HOST-SIDE proposal effects (like
  script_plan_proposal C5): workspace_file_op{op}, workspace_search{query},
  sandbox_script_proposal{request}, web_search{query,options?},
  web_page_read{url,options?}, extension_request{request}.
- effectExecutor.ts EffectPorts += workspace? (file_op|search), sandboxScript?,
  web? (search|page_read), extension?. executeEffect routes each; a missing port
  -> failEffect (audit runtime.effect_failed status:failure + runtimeErrored +
  throw) = FAIL CLOSED. A handler rejection propagates to the host loop.
- Tests: effectExecutor.test.ts 'F2 subsystem proposal effects' (12: per-effect
  route-to-port + fail-closed-audited) + handler-failure propagation. vitest 749->762.
- NEXT F3: wire the REAL port impls + approval. Build the port handlers backed by
  B6 workspaceOps (buildWorkspaceProposal/executeWorkspaceOp/rejectWorkspaceOp),
  C4 planRuntime + planRunner, D6 scriptRuntime (proposeScript/runApprovedScript/
  rejectScript), web (WebResearchService), extension (createExtensionPageReader).
  Dispatch approvalRequested in the proposal path; run/reject in the
  approvalResolved listener (runtimeListeners.ts tool_call precedent). ApprovalKind
  already has workspace_write/workspace_delete/plan/sandbox_script.

### F3 (partial) — script-runtime approval wiring (done, 2026-06-15)
- src/runtime/sandboxScriptRunner.ts (D6 analog of C5 planRunner.ts):
  createSandboxScriptEffectHandler(deps) -> validates via proposeScript (audits
  sandbox_requested|sandbox_rejected) -> dispatch approvalRequested(kind
  'sandbox_script', payloadPreview=JSON request) | resolve_effect failure if
  invalid. runApprovedSandboxScriptEffect(deps, approval) -> approved:
  runApprovedScript + resolve_effect(result); rejected: rejectScript +
  resolve_effect(user_rejected). deps {ctx: ScriptRuntimeContext, submit}.
- runtimeListeners.ts approvalResolved now ROUTES BY KIND: plan ->
  deps.resolvePlanApproval, sandbox_script -> deps.resolveSandboxApproval (both
  injected, optional), else tool_call (existing). RuntimeListenerDeps +=
  resolvePlanApproval?/resolveSandboxApproval?. This is the seam to extend for
  workspace/web/extension/bulk approvals.
- Tests: sandboxScriptRunner.test.ts (4) + runtimeListeners.test.ts +2 (plan +
  sandbox routing). vitest 762->768.
- GOTCHA: SANDBOXED_SCRIPT_RUNTIME is exported from scriptPolicy.ts (NOT
  scriptRequest.ts); SCRIPT_REQUEST_TYPE/VERSION from scriptRequest.ts.
- KEY FACT: registerRuntimeListeners is NOT yet called by live app wiring
  (effect-port + listener host assembly is a later step). All bridges are built
  + tested in isolation. The plan/sandbox handlers are provided by whoever
  assembles the host (deps injection).
- F3 REMAINING: workspace_write/workspace_delete (wire B6 workspaceOps +
  listener route), web_page_read (+ add ApprovalKind 'web_page_read'),
  extension_permission, bulk_research. Same router/injected-deps pattern.

### F3 (workspace increment) — workspace approval wiring (done, 2026-06-15)
- src/runtime/workspaceRunner.ts: createWorkspaceEffectHandler(deps {ops:
  WorkspaceOpsDeps, submit}) — workspace_search runs read-only directly + resolves;
  workspace_file_op -> parseWorkspaceOp (validates kind + workspace paths; bad ->
  resolve_effect failure) -> buildWorkspaceProposal -> approvalRequested kind
  workspace_delete (delete) | workspace_write (else), payloadPreview=JSON op.
  runApprovedWorkspaceEffect: approved -> executeWorkspaceOp + resolve_effect
  {ok,stat}; rejected -> rejectWorkspaceOp + resolve_effect(user_rejected);
  invalid/throw -> resolve_effect failure. parseWorkspaceOp exported + tested.
- runtimeListeners.ts approvalResolved += route workspace_write/workspace_delete
  -> deps.resolveWorkspaceApproval (injected). RuntimeListenerDeps += that.
- Tests: workspaceRunner.test.ts (6) + runtimeListeners.test.ts +1. vitest 768->775.
- F3 STATUS: plan + sandbox_script + workspace_write/delete wired. REMAINING:
  web_page_read (+ ApprovalKind), extension_permission, bulk_research.

### F4 — Audit event builders + redaction (done, 2026-06-15)
- AuditSource already had workspace/script/web/extension (C4) — verified+ticked.
- src/audit/auditEvents.ts: workspace/script/web/extensionAuditEvent(type,
  summary, {risk?,status?,at?}) -> AppendAuditInput with the right source fixed.
  buildAuditRow sanitizes downstream.
- src/audit/auditService.ts: redactText (credentials, existing A2.9) UNCHANGED;
  NEW capText(text, max=MAX_AUDIT_TEXT_CHARS 4000) -> "… [N more chars truncated]";
  NEW redactSummary = capText(redactText(text)). buildAuditRow.summary now uses
  redactSummary -> huge page bodies / file contents / script source can never be
  stored whole in the audit log (only correlation + a bounded, scrubbed preview).
- Tests: auditService.test.ts 'summary length cap (F4)' (3: cap, redact+cap,
  short unchanged) + auditEvents.test.ts (3). vitest 775->781.
- PART F STATUS: F1 (capability model) done, F2 (runtime effects) done, F3
  (approval wiring) PARTIAL [plan+sandbox+workspace_write/delete wired;
  web_page_read/extension_permission/bulk_research remain], F4 (audit+redaction) done.
- NEXT: finish F3 remaining (web_page_read +ApprovalKind, extension_permission,
  bulk_research) OR move to PART G (UI: G2 plan+sandbox approval cards via
  PlanProposal/ScriptProposal, G3 web research status). E2 (search) needs the user
  to NAME the provider (Tavily/Brave/Exa). PART H = QA gate.

### F3 (web increment) — web_page_read approval wiring (done, 2026-06-15)
- USER DECISION: E2 search provider = BRAVE SEARCH (commercial API, key in
  SecretVault, called from the extension). Build E2 against Brave when we get there.
- approvalsSlice ApprovalKind += web_page_read, bulk_research, extension_permission.
- src/runtime/webRunner.ts: createWebEffectHandler({web:WebResearchService, db,
  dispatch, submit}) — web_search runs read-only DIRECT (audited
  web.search_started/completed/failed) + resolves; web_page_read validates URL
  (classifyFetchUrl) -> approvalRequested kind 'web_page_read' (payloadPreview
  {url,options}), nothing fetched. runApprovedWebPageRead: approved ->
  web.readPage + web.page_read_started/completed audits + resolve {ok,content};
  rejected -> web.page_read_rejected + resolve user_rejected; reader throw ->
  web.page_read_failed + resolve failure. Audit summaries length-capped by F4
  (big page body never stored whole). Uses webAuditEvent (F4 builder).
- runtimeListeners.ts approvalResolved += route web_page_read ->
  deps.resolveWebPageReadApproval. RuntimeListenerDeps += that.
- Tests: webRunner.test.ts (7) + runtimeListeners.test.ts +1. vitest 781->788.
- F3 STATUS: plan + sandbox + workspace_write/delete + web_page_read WIRED.
  REMAINING: extension host permission ('extension_permission'), bulk_research
  ('bulk_research') — kinds declared in ApprovalKind, handlers TODO. extension
  permission = real-browser chrome.permissions flow (extension service worker);
  bulk_research needs a web_research effect (not in F2) or research() gating.

### F3 (extension increment) — extension host-permission approval (done, 2026-06-15)
- src/runtime/extensionRunner.ts: createExtensionEffectHandler({transport:
  ExtensionTransport, db, dispatch, submit}) — parses effect.request via
  parseExtensionRequest; request_host_permission -> approvalRequested kind
  'extension_permission' (risk high, payloadPreview=JSON request), nothing sent;
  benign requests (ping/status) pass through sendAndResolve directly; invalid ->
  resolve failure. runApprovedExtensionPermission: approved -> audit
  extension.permission_requested + transport.send + resolve response; rejected ->
  extension.permission_rejected + resolve user_rejected. The real
  chrome.permissions.request stays in the extension service worker (real-browser).
- runtimeListeners.ts approvalResolved += route extension_permission ->
  deps.resolveExtensionPermissionApproval.
- Tests: extensionRunner.test.ts (5) + runtimeListeners.test.ts +1. vitest 788->794.
- F3 STATUS: plan + sandbox + workspace + web_page_read + extension_permission
  WIRED. REMAINING: bulk_research (kind declared; needs a web_research effect).

### F3 (bulk research) — PART F COMPLETE (done, 2026-06-15)
- effectTypes.ts Effect += web_research{query,options}; effectExecutor.ts web
  port Extract + case now covers web_search|web_page_read|web_research.
- webRunner.ts: web_research -> approvalRequested kind 'bulk_research' (risk high;
  title/summary show query + maxPages + site; payloadPreview {query,options});
  runApprovedBulkResearch -> web.research(query, sanitizeResearchOptions) +
  web.research_started/completed/failed/rejected audits + resolve {ok,bundle}.
- runtimeListeners.ts approvalResolved += route bulk_research ->
  deps.resolveBulkResearchApproval.
- Tests: webRunner.test +3 (gate, run, reject) + effectExecutor.test +1 (route) +
  runtimeListeners.test +1 (routing). vitest 794->800.
- ===== PART F COMPLETE: F1 capability model, F2 runtime effects, F3 all six
  approval types (plan/sandbox/workspace_write+delete/web_page_read/
  extension_permission/bulk_research) wired via runtimeListeners.approvalResolved
  + injected-deps, F4 audit builders + redaction cap. =====
- ONLY P2 inline cap/limit editing deferred to G2. registerRuntimeListeners + the
  effect ports are assembled into the live app in a later host-wiring step.

### G2 — Script approval cards (done, 2026-06-15) — PART G started
- src/screens/chat/ScriptApprovalCard.tsx: presentational card for kinds 'plan'
  + 'sandbox_script'. Derives PlanProposal (validatePlan -> buildPlanProposal) /
  ScriptProposal (validateScriptRequest -> buildScriptProposal) from
  approval.payloadPreview; unparseable -> raw-JSON fallback (Exact data). Shows
  runtime-label primary Badge, risk/status Badge, plan steps/files(read/write/
  delete color-coded)/urls/caps, OR sandbox reason/code(maxh-48 scroll)/caps/
  file scopes/network+web/limits. Optional `outcome` prop (running|completed|
  failed) -> Result badge + danger message. View raw toggle. Approve/Reject
  (pending only); P2 inline edit still deferred.
- Matches design system: rounded-card/border-border/bg-surface-subtle, Badge
  tones (low->success/medium->warning/high->danger), Button variant/size,
  useState; no Redux inside (callbacks like ApprovalCard).
- ChatScreen.tsx: SCRIPT_APPROVAL_KINDS set routes plan/sandbox_script ->
  ScriptApprovalCard, all other kinds -> ApprovalCard (with onEdit). resolve()
  unchanged (approvalResolved + approvalDismissed).
- Tests: ScriptApprovalCard.test.tsx (6) via @testing-library/react. vitest 800->806.
- NEXT G3: Web Research settings/status area — search provider config status
  (Brave), Chrome extension status (createExtensionPageReader.isAvailable /
  ping), install instructions when missing, host-permission prompts/results,
  research bundle output paths, CORS note for Browser Fetch (E3). Then G1
  (workspace screen — B7 WorkspaceScreen mostly exists; file tree/preview/search/
  empty/error states). Then E2 (Brave search adapter), PART H QA.

### G3 — Web Research status area (done, 2026-06-15)
- src/screens/settings/WebResearchStatus.tsx: presentational panel. Props
  {searchProvider {name, configured}, extension? {available, version?},
  researchPaths?, probe?}. ExtensionStatus unknown/checking/connected/missing
  Badge; probe() (= createExtensionPageReader.isAvailable when wired) drives a
  Check button — only rendered when probe given (HONEST: no dead button).
  Install panel (chrome://extensions + Load unpacked extension/chrome-web-research)
  when status !== connected. Research output paths list or "No research runs yet".
  CORS note for in-page Browser Fetch (E3) + per-site permission note.
- Embedded in SettingsScreen as a "Web research" Section: searchProvider
  {name 'Brave Search', configured:false}, no probe yet (extension transport
  assembly = later host-wiring step).
- Tests: WebResearchStatus.test.tsx (6). vitest 806->812.
- PART G STATUS: G2 done, G3 done. REMAINING: G1 (workspace screen — B7
  WorkspaceScreen already exists at src/screens/WorkspaceScreen.tsx; check what's
  missing: file tree/list, preview, search/grep UI, empty state, unavailable-
  storage error state, disable unimplemented actions — all P2).

### G1 — Workspace UI search/grep (done, 2026-06-15) — PART G COMPLETE
- WorkspaceScreen (B7) already had nav/file-list/preview/empty/OPFS-error-banner/
  disabled-actions. ADDED the real content search/grep UI (was only a client-side
  path filter): a form with "Search file contents" Input + Search button ->
  fs.grep({pattern, ignoreCase}) -> hit list (path:line + text snippet, click
  opens file); Clear resets. Disabled when !isOpfsAvailable() (grep reads content
  via ContentStore; jsdom/no-OPFS -> disabled, honest).
- Tests: WorkspaceScreen.test.tsx (3): grep UI renders, disabled-without-OPFS +
  banner, unimplemented actions disabled. vitest 812->815.
- ===== PART G COMPLETE: G1 workspace UI (B7 + grep), G2 script approval cards
  (plan+sandbox), G3 web research status. =====
- REMAINING in this TODO: E2 (Brave search adapter) + PART H (QA gate H1 unit /
  H2 integration / H3 manual). Also still pending: the live host-wiring step that
  assembles registerRuntimeListeners + effect ports + extension transport into the
  real store (the F3/G3 bridges are built + tested in isolation).

### E2 — Brave Search adapter (done, 2026-06-22)
- `src/webresearch/braveSearch.ts`: `createBraveSearchProvider({apiKey,fetch?})`
  implements `SearchProvider` against `https://api.search.brave.com/res/v1/web/search`.
  `X-Subscription-Token: <key>` auth header; key injected at construction, never
  written to Redux / IndexedDB / audit logs / error messages.
- Error kinds: `auth` (401/403), `rate_limit` (429), `unavailable` (5xx),
  `network` (TypeError — covers CORS + network failure), `invalid_response`
  (non-JSON or unexpected shape). All surface as `SearchError` with a `kind`.
- Key resolution: `resolveSearchProviderKey(vault, profile)` mirrors
  `resolveApiKey` from the LLM provider path — `secret_locked` when vault is
  locked (no vault call), `secret_missing` when no secret found, `ok` with the
  raw key otherwise. Secret ID = `search_provider:${profileId}`.
- DB v8 bump: `search_provider_profiles` table (`id, kind`) added to Dexie with
  `SearchProviderProfileRow {id, kind:'brave', label, apiKeyMode, encryptedSecretId?}`
  in `db/types.ts`. Backup service updated: `search_provider_profiles` added to
  COLLECTIONS + `isSearchProviderKind` row validator.
- Audits `web.search_started/completed/failed` are already emitted by
  `webRunner.ts` (F3) — the Brave provider itself doesn't re-emit them.
- Health test = a real search call (Brave has no dedicated health endpoint); a
  failed call produces a typed `SearchError`. The provider is created by host
  assembly (a later wiring step) — not yet live in the running app.
- Tests: `braveSearch.test.ts` (15): `resolveSearchProviderKey` locked/missing/ok
  + no-key-leak; `createBraveSearchProvider` valid response, count cap, site
  prefix, auth/rate-limit/unavailable/network/invalid-response/non-JSON errors,
  no key in error message. vitest 815->830.
- Gate green (single-threaded): typecheck, eslint --max-warnings 0, prettier,
  vitest 830/111, e2e 30. No Rust.

## FIX1 Locked decisions (2026-06-28)

These decisions apply to the FIX1 correction and integration pass. See
`docs/BROWSERCLAW_WORKSPACE_SCRIPTING_WEBRESEARCH_FIX1_SPEC.md` and
`...FIX1_TODO.md` for the full scope.

- **Chrome extension status must be truthful.** `service-worker.js`
  `get_status` currently returns `pageReadingAvailable: true` but `read_page`
  is not implemented (the `default:` branch returns `unsupported`). FIX1-A1
  must fix this before any extension capability can be marked complete.
- **Extension `read_page` must exist before page-reading items are live.**
  BrowserClaw-side protocol wrappers (`pageReaderProvider.ts`) exist, but the
  service worker only handles `ping` / `get_status`. FIX1-A3 implements real
  `read_page`; FIX1-A4 implements `read_current_tab`.
- **Runtime ports must be wired in `main.tsx`.** The plan/workspace/
  sandboxScript/web/extension handlers are built and isolated-tested (F2–F3),
  but not live. FIX1-B1 assembles them into the real store at boot.
- **Approval resolvers must be passed to `registerRuntimeListeners`.** FIX1-B2
  wires resolver deps (resolvePlanApproval, resolveSandboxApproval, …) so
  approvals actually resolve runtime effects in the live app.
- **Plan/script/web agent block parsing must be explicit.** The LLM runner
  handles tool blocks but not `browserclaw-plan` / `browserclaw-script` /
  `browserclaw-web` fenced blocks. FIX1-C2/C3 implement the unified parser
  and wire it after each provider response.
- **Sandbox `tool.call` must enforce cross-capability requirements.** A sandbox
  with `tools: ['Page Reader']` but no `webRead`/`webSearch` cap can currently
  reach network behavior through the generic tool path. FIX1-D1/D2 add
  per-tool capability descriptors and enforce them before execution.
- **Sensitive memories are excluded from sandbox `memory.search` by default.**
  FIX1-E1 adds a `sensitivity !== 'sensitive'` filter; a separate high-risk
  `memorySensitiveRead` capability is P2 and not implemented in v0.1.
- **Invalid approved tool args fail, not `{}`.** `parseArgs()` must become
  `parseApprovedArgsOrThrow()`: invalid JSON or non-object rejects with
  `tool.args_parse_failed` audit; the tool is not run. FIX1-F1 implements this.
- **Dockerized extension E2E is required.** FIX1-K1/K2 add a Playwright
  persistent-context lane (`pnpm run test:extension:e2e`) that proves the
  extension loads, connects, reads a fixture page, and blocks private URLs.
  Manual QA covers store packaging and host-permission prompts only.
- **Brave Search direct browser mode must be proven or moved through extension.**
  `braveSearch.ts` is a working `SearchProvider` library adapter, but it has
  not been tested from a real browser origin (CORS may block it). FIX1-G1/G2
  verify behavior; if CORS is a problem, the extension-backed search path
  becomes the required default.

## FIX2 Locked decisions (2026-06-28)

These decisions apply to the FIX2 safety hardening and integration pass. See
`docs/BROWSERCLAW_WORKSPACE_SCRIPTING_WEBRESEARCH_FIX2_SPEC.md` and
`...FIX2_TODO.md` for the full scope.

- **QuickJS sandbox remains in scope for v0.1.** `sandboxedScriptingEnabled`
  defaults to `false` in `DEFAULT_SCRIPT_POLICY` but must be updated to `true`
  per the spec's recommended v0.1 policy. `alwaysRequiresApproval: true`;
  `network: deny`; `secrets: deny` remain hard constraints.
- **Plan Runtime remains default for simple tasks.** `defaultRuntime: 'plan_dsl'`
  unchanged.
- **Sandboxed JS Runtime is always approval-gated.** `alwaysRequiresApproval: true`
  enforced at `createSandboxScriptEffectHandler()` before any queueing (B1).
- **Chrome extension page reader is v0.1.** Firefox extension remains deferred.
- **No hosted proxy, no local daemon, no browser eval/new Function/importScripts,
  no generic unrestricted curl/proxy tool.** All remain out of scope.
- **TODO/doc status reconciliation.** Checked boxes in previous TODO files may
  represent library-level or isolated unit-tested implementation only. Full app
  wiring (live effect ports, host assembly, `main.tsx` integration, E2E
  verification) may still be incomplete. FIX2 parts must explicitly distinguish
  library-level from app-level and wired-in-live-app completion.
- **WASM runtime must handle plan/script/web result shapes.** The TypeScript
  reference runtime handles `plan`, `script_request`, `web_request.*`. `claw-core`
  must be updated to match before any of these can be called feature-complete
  (Part A1). WASM must be rebuilt and verified after each Rust change.
- **Approval payloads are fail-closed.** All approval payload parsing must use
  explicit helpers that throw on invalid/missing data (Part F1). No silent
  empty-string or `{}` fallbacks anywhere in the approval chain.
- **Search provider must be wired or explicitly unavailable in the live app.**
  A missing provider must surface `search_unavailable`; no silent no-op (Part D1).
- **Sensitive memories excluded from all automated retrieval paths** by default:
  sandbox `memory.search`, Plan Runtime `memory.search`, LLM context retrieval.
  A `memorySensitiveRead` capability is P2 and must not be added without explicit
  user request and high-risk approval gate (Part G1).
- **Sandbox tool descriptors deny by default.** A tool missing a capability
  descriptor cannot be called from sandbox (Part H1). The deny-by-default pattern
  ensures new tools are safe until explicitly declared.
- **Browser extension URL safety cannot fully resolve DNS rebinding or private DNS
  targets.** The extension URL safety check blocks known local hostnames
  (`localhost`, `127.0.0.1`, `0.0.0.0`, `::1`) and private IP ranges by pattern,
  but cannot resolve arbitrary hostnames or detect DNS rebinding attacks where a
  public name is later resolved to a private IP. This is a known limitation of
  browser-extension sandboxing; a full mitigation would require OS-level DNS
  interception outside the browser. Operators deploying BrowserClaw in sensitive
  environments should be aware that the extension page reader is not a fully
  DNS-rebinding-safe tool. (K1 documentation requirement.)
- **Extension page-reading permission flow (v0.1).** The user must grant
  BrowserClaw host permission for each new origin before `read_page` can succeed.
  The flow: (1) BrowserClaw sends `request_host_permission`; (2) the extension
  service worker calls `chrome.permissions.request({origins:[pattern]})`; (3) if
  Chrome requires a user gesture, `permission_flow_required` is returned and the
  user must open the extension popup to grant access manually; (4) once granted,
  `read_page` succeeds. Permissions are stored in Chrome's extension permission
  store and persist across sessions. (K1 documentation requirement.)
- **Brave/direct search vs extension-backed (v0.1).** The direct browser Brave
  Search API path (`createBraveSearchProvider`) is blocked behind
  `BRAVE_DIRECT_CORS_VERIFIED = false` because the Brave Search API does NOT
  support browser-origin CORS headers for third-party callers. All production
  search in v0.1 routes through the Chrome extension (`createExtensionSearchProvider`
  via `createConfiguredSearchProvider`). The extension forwards the request to the
  Brave API server-side without CORS restrictions. The Brave API key is stored in
  SecretVault (decrypted in-memory only) under the canonical key ID
  `search_provider:brave` and forwarded to the extension in-message (never
  persisted to localStorage or Redux). (K1 documentation requirement.)

## FIX3 Locked decisions (2026-06-28)

These decisions apply to the FIX3 live-path correctness pass. See
`docs/BROWSERCLAW_WORKSPACE_SCRIPTING_WEBRESEARCH_FIX3_SPEC.md` and
`...FIX3_TODO.md` for the full scope.

- **FIX3 fixes remaining live-path quiet failures from FIX2.** FIX2 put in place
  library-level building blocks; FIX3 connects them so real requests actually
  work. No broad new features are added in this pass.
- **Search provider must resolve the saved Brave key at request time.** A
  boot-time captured API key is not acceptable. `createConfiguredSearchProvider()`
  must receive `secretVault` and resolve the key immediately before each
  extension search request. Missing key → `secret_missing`; locked vault →
  `secret_locked`. Raw key must never enter Redux, audit, logs, or error messages.
- **Structured web effect results must never become empty tool messages.** A shared
  TypeScript `toolContentFromEffectResult()` serializer must handle `{ results }`,
  `{ content }`, `{ contents }`, `{ bundle }`, and `{ response }` shapes. An
  equivalent Rust serializer must exist in `claw-core`. An empty or unrecognized
  success result must fail audibly, not silently.
- **Rust/WASM and TypeScript web-request validation must match and fail-closed.**
  `unwrap_or("")` / `unwrap_or_default()` fallbacks for web-request fields are
  removed. Missing/empty `op`, `query`, `url`, or `urls` emits
  `runtime.invalid_web_request`; no empty-query or empty-url effects are emitted.
- **`research` and `readPages` are supported end-to-end in v0.1.** Both ops are
  accepted by the parser and runtime. `readPages` maps to a discriminated
  `web_research { mode: 'urls' }` or a dedicated `web_pages_read` effect — not to
  `query: ''`. Explicit URL arrays must be preserved.
- **Extension async handlers must go through central `handle()`.** `onMessageExternal`
  must always delegate to the central handler. Sender/origin, message shape,
  `type`, `requestId`, and handler existence are validated before dispatch. Thrown
  exceptions must return structured `internal_error`, not crash the service worker.
- **Settings status is capability-specific.** A single "Connected" badge is
  replaced with separate rows for: extension connected, page reading, host
  permission flow, current-tab (unsupported v0.1), web search handler, Brave key,
  and live search readiness. Collapsing these into one badge was identified as
  misleading in FIX3 review.
- **`read_pages` is live through the provider.** `pageReaderProvider.readPages()`
  sends a single `read_pages` batch message to the extension. Sequential fallback
  is disallowed unless explicitly configured and audited.
- **Strict approval payload parsing throughout.** `runApprovedWebPageRead()` and
  `runApprovedExtensionPermission()` both use strict `parseApprovalPayloadObject()`
  + `requireStringField()`. Lenient parsing that produces empty URL/origin is
  removed; malformed payloads fail with audit, not silently.
- **Brave key clear errors are visible and audited.** The broad catch in
  `useWebResearchKey.clearKey()` is replaced by an intentional handler that
  ignores `not-found` but audits and shows a UI error on vault or storage failure.
- **`waitForTabComplete()` race is fixed (P2).** The extension now checks existing
  tab status before attaching the `onUpdated` listener, so a tab that completes
  before listener setup does not time out.

## FIX4 Locked decisions (2026-06-29)

These decisions apply to the FIX4 protocol-validation hardening pass. See
`docs/BROWSERCLAW_WORKSPACE_SCRIPTING_WEBRESEARCH_FIX4_SPEC.md` and
`...FIX4_TODO.md` for the full scope.

- **FIX4 closes remaining quiet-fallback gaps.** FIX3 wired up the live paths;
  FIX4 ensures every protocol boundary validates and fails visibly rather than
  silently coercing malformed data into "best effort" defaults. No broad new
  product features are added in this pass.
- **Rust `readPages.urls` must reject invalid slots, not filter them.** A new
  `required_string_array()` Rust helper rejects the whole request if any slot is
  missing, non-string, or empty/whitespace. Silent per-slot filtering is removed.
- **Rust `tool_call.name` must be required and non-empty.** A new
  `required_tool_name()` Rust helper rejects the tool call with
  `runtime.invalid_tool_call` if the name is missing, empty, or whitespace-only.
  An empty-name `tool_call_proposal` must never reach the host.
- **Host `webRunner` must not default malformed fields to empty values.** Patterns
  like `const query = effect.query ?? ''` are replaced with strict
  `requireEffectStringField()` / `requireEffectStringArrayField()` helpers.
  Missing, empty, or whitespace-only values resolve the effect as failure and audit
  `web.effect_payload_invalid`.
- **Bulk research approval URL parsing must be per-slot strict.** `runApprovedBulkResearch()`
  must validate every slot in the URL array, not just check that the array is
  non-empty. Invalid URL slots must block the request and audit
  `web.bulk_research_payload_invalid`.
- **Page reader must reject empty successful page responses.** An `ok: true`
  response with no meaningful content (empty text, whitespace-only, zero length)
  must be treated as a protocol error, not returned as a successful read.
- **`WebResearchService.readPages()` must delegate to provider batch `readPages()`
  when available.** Sequential URL-by-URL fallback is only allowed if explicitly
  configured AND audited. Silent downgrade is disallowed.
- **Extension E2E must prove a real `read_page` against a fixture page.** A
  failing or skipped extension E2E lane cannot be counted as extension readiness.
  `permissionRequestSupported` must reflect whether the permission flow can
  actually complete (e.g., requires user gesture), not just that a handler exists.
- **Sandbox scripting policy must be explicit in UI and docs.** If sandboxed
  scripting is implemented but disabled in v0.1, the UI must say so honestly —
  not present an active-looking interface backed by a no-op.
- **`waitForTabComplete()` tab-load race fix (P2, carried from FIX3).** P2
  deferred from FIX3; I1 is in FIX4 scope as a P2 item.

## FIX5 Locked decisions (2026-06-29)

These decisions apply to the FIX5 follow-up hardening pass. See
`docs/BROWSERCLAW_WORKSPACE_SCRIPTING_WEBRESEARCH_FIX5_SPEC.md` and
`...FIX5_TODO.md` for the full scope.

- **Plan Runtime `web.readPages` must not filter invalid URL slots.** The
  current `args.urls.filter(...)` approach silently drops non-string slots.
  Replace with `requirePlanStringArrayField()` that throws `PlanOpError` on
  any invalid slot (missing array, empty array, non-string item, empty string
  item). No web provider call is made when validation fails.
- **Plan Runtime `web.readPages` must call `ctx.web.readPages()` once (batch),
  not loop over `ctx.web.readPage()`.** If the web context does not expose a
  batch API, fail with a visible `unsupported_op` error rather than silently
  degrading to single-URL loops.
- **Sandbox memory search must use the same snippet cap as Plan Runtime.**
  `filterMemoriesForAutomatedAccess()` + `shapeMemoryForAutomatedAccess()` are
  the canonical helpers for any automated (plan/sandbox/LLM) memory access.
  Returning raw `m.text` from any automated path is disallowed.
- **Settings UI must use `normalizeExtensionStatus()` to render capability
  status.** It is not sufficient for the helper to exist in tests; the live
  Settings screen must call it and pass the result to `WebResearchStatus`.
  Misleading copy that implies a working host-permission request flow must be
  removed (v0.1 has no popup UI for that flow).
- **Extension E2E readiness requires a recorded successful `read_page` run.**
  Local headless Chromium failures are documented in FIX4; FIX5 must run and
  record Docker extension E2E, or explicitly block extension/page-reader
  readiness with a follow-up task.
- **`readPages(maxPages)` must not generate missing-result failures for
  intentionally skipped URLs.** Only URLs in `expectedUrls = urls.slice(0,
  maxPages)` should appear in the result map; URLs beyond `maxPages` are
  silently skipped, not failures.
- **`web_page_read` invalid URL/payload must audit `web.effect_payload_invalid`
  consistently**, matching the pattern already used for `web_search` and
  `web_research` invalid payloads.
- **Effect failures must produce structured, non-empty, sanitized content.**
  Generic strings like "Operation was not completed" are replaced with
  `toolContentFromEffectFailure()` JSON output containing `type`, `kind`,
  `message`, and `retryable` fields; token-like strings in messages are
  redacted.

## FIX6 Locked decisions (2026-06-29)

These decisions apply to the FIX6 parity and validation hardening pass. See
`docs/BROWSERCLAW_WORKSPACE_SCRIPTING_WEBRESEARCH_FIX6_SPEC.md` and
`...FIX6_TODO.md` for the full scope.

- **Rust/WASM failure content must match TypeScript structured failure content.**
  FIX5 added `toolContentFromEffectFailure()` in TypeScript (`referenceRuntime.ts`)
  but left the Rust/WASM runtime producing generic strings ("Operation was not
  completed.", "Tool call was not completed."). FIX6 Part A adds the Rust equivalent
  (`tool_content_from_effect_failure`) so that the WASM path — which is the default
  production runtime when available — produces the same structured, sanitized JSON
  output as the TS reference runtime. Parity tests must cover the same canonical
  input shapes in both languages.
- **TypeScript reference runtime must validate raw `readPages` requests at the
  effect-handling layer.** `referenceRuntime.ts` currently casts
  `web_request.readPages.urls` as `string[]` without validation. The agent block
  parser and Plan Runtime validate `readPages` upstream, but the raw effect path
  in `referenceRuntime.ts` is a second entry point that can receive unvalidated
  data. FIX6 Part B adds strict slot-by-slot validation (non-empty string array,
  URL safety via `classifyFetchUrl`) before a `web_research` effect is emitted.
  Invalid requests emit `runtime.invalid_web_request`, not a blank web-research
  effect.
- **Settings WebResearch capability status must derive from current key/vault state,
  not the stale probe-time snapshot.** FIX5 C1 stored a normalized `capabilityStatus`
  at probe time. If the user clears the Brave key or the vault locks after a
  successful probe, the status badge remains "ready" until the next probe — this is
  misleading. FIX6 Part C changes the shape: `rawExtensionStatus` is stored from
  the probe, and `capabilityStatus` is derived via `useMemo` from the raw status
  plus current `webKey.keyConfigured` and `webKey.vaultLocked`. The badge then
  updates reactively on every relevant state change without needing a new probe.
- **Rejected approvals must not parse malformed payloads before returning.**
  `runApprovedBulkResearch()` (and similar approval handlers) parse the
  `payloadPreview` before checking `approval.status`. A rejected approval with a
  malformed JSON payload would audit `web.bulk_research_payload_invalid` instead
  of `web.research_rejected` — misleading and incorrect. FIX6 Part D moves the
  `approval.status !== 'approved'` check before any payload parsing, so a rejection
  resolves cleanly without ever inspecting the payload.
- **`readPages(maxPages)` must use `expectedUrls` for all failure paths.** FIX5 E1
  fixed the success mapping but some top-level error paths (extension unavailable,
  invalid response, transport throws) may still use `request.urls` instead of
  `request.urls.slice(0, maxPages)`. FIX6 Part E computes `expectedUrls` once at
  the top of `readPages()` and uses it consistently across all result and failure
  paths.
- **Docker extension E2E evidence must remain reproducible.** The Docker E2E lane
  (`pnpm run test:extension:e2e:docker`) was proven in FIX5 and must be re-verified
  or cited in FIX6 acceptance. If it cannot run in the current environment, a prior
  recorded result may be cited only if the extension code has not changed since that
  run; otherwise a new run is required.
- **No new broad features in FIX6.** All changes in FIX6 are correctness,
  validation, and parity fixes. Feature additions belong in a separate pass.

## FIX7 Locked decisions (2026-06-29)

These decisions apply to the FIX7 targeted hardening pass. See
`docs/BROWSERCLAW_WORKSPACE_SCRIPTING_WEBRESEARCH_FIX7_SPEC.md` and
`...FIX7_TODO.md` for the full scope.

- **Rust failure redaction must redact all occurrences, not just the first.**
  FIX6 Part A introduced `tool_content_from_effect_failure()` in Rust, but the
  inner `redact` helper uses a single `if out.contains(marker)` check — it will
  miss a second `sk-` token in the same message. TypeScript uses
  `String.prototype.replace(/regex/g, ...)` which is globally replacing. FIX7
  Part A replaces the one-shot check with a `loop { break when no marker }` pattern
  using `redact_marker_all` (no regex dep). Order: `Authorization:` before
  `Bearer ` before `sk-ant-` before `sk-` to avoid partial-prefix double-redaction.
- **`maxPages` must be validated at every protocol boundary before use.**
  Invalid `maxPages` values (0, negative, NaN, Infinity, non-integer, string)
  can desynchronize what BrowserClaw expects to read from what the extension
  actually reads. FIX7 Part B adds a shared TypeScript helper
  `normalizeOptionalPositiveIntegerLimit` and applies it at all boundaries:
  `pageReaderProvider`, `WebResearchService`, `webRunner`, `planOps`,
  `referenceRuntime`, and the extension service worker. The hard max constant
  `MAX_BATCH_PAGE_READS = 10` is defined in `src/webresearch/limits.ts`.
- **Extension central validation (`validateMessageSchema`) must reject bad
  `read_pages` payloads before dispatch.** Per-slot and `maxPages` validation
  must not rely on handler best-effort. Central validation runs first; if it
  fails, the handler never sees the message. This closes the window where a
  race or type confusion could bypass slot validation.
- **Invalid `maxPages` must not expand reads.** `0`, negative, NaN, Infinity
  and non-integers must not be treated as "read all" or silently converted to
  unlimited. Any boundary that receives an invalid `maxPages` must reject with
  an explicit error, not fall back to `urls.length`.
- **Docker extension E2E must be rerun after FIX7 changes.** The extension
  service worker is modified in FIX7 (central validation). A Docker run is
  required before marking FIX7 complete; a FIX6 Docker result cannot substitute.
- **No new broad features in FIX7.** All changes are correctness, validation,
  and redaction hardening. Feature additions belong in a separate pass.

## FIX8 Locked decisions (2026-06-29)

- **`browserclaw-web` top-level limit fields must be normalized into canonical
  `options`.** The model may emit `maxPages`, `maxChars`, `maxResults` at the
  top level of a `browserclaw-web` block. The runtime expects `options.maxPages`
  etc. Top-level fields must be validated and merged into the canonical `options`
  shape during parse/validation so limits are never silently dropped.
- **Invalid top-level `maxPages` must be rejected before effect emission.**
  `validateWebRequest()` must reject `maxPages: 0`, negative, non-integer,
  or string values. An invalid top-level `maxPages` is a malformed/protocol
  error and must not result in a web effect being emitted.
- **`referenceRuntime` must not validate options and then drop them.** After
  validating `options.maxPages`, the validated options object must be forwarded
  into the emitted `web_research`/`web_search`/`web_page_read` effect. Validate
  and then silently omit is not acceptable.
- **Web effect handlers must audit/resolve invalid option payloads instead of
  throwing.** `createWebEffectHandler()` calls `sanitizeResearchOptions()` before
  any try/catch. If `sanitizeResearchOptions()` throws (e.g. invalid `maxPages`),
  the handler throws uncaught. FIX8 wraps option sanitization in try/catch and
  routes failures through `failInvalidWebEffect()`.
- **`handleReadPages()` must validate `maxPages` even when called directly.**
  Central validation in `validateMessageSchema` rejects invalid `maxPages`, but
  direct handler invocations (e.g. tests, future refactors) bypass that path.
  `handleReadPages()` must call `validateOptionalPositiveIntegerLimit` at its
  own start and return a structured `invalid_request` response on failure.
- **Rust failure redaction must avoid obvious safe-word false positives while
  preserving secret redaction.** The FIX7 loop-based `redact_marker_all()` may
  redact ordinary words containing `sk-` such as `risk-level`, `task-id`,
  `ask-for-help`, `disk-cache`. FIX8 adds boundary/min-length checks: only
  redact `sk-` tokens that start at a non-alphanumeric boundary AND have at
  least 12 secret-like characters following the prefix. `Bearer ` requires a
  word boundary before it.

## FIX9 Locked decisions (2026-06-29, from `docs/replies3.md`)

- **Runtime web options must be validated by one shared helper.**
  `referenceRuntime.ts` must not validate options ad-hoc in each branch.
  A single `validateRuntimeWebOptions(raw: unknown)` validates model-authored
  `web_request.options`; each web-op branch calls this and forwards the result.
  Supported fields for FIX9: `maxPages`, `maxResults`, `maxChars` only.
  `site` and `format` are rejected as unsupported (not used downstream).
- **No web op may validate options and then drop them.** After validation,
  the normalized options object must be spread into the emitted effect. Validate
  and silently omit is not acceptable. Applies to `search`, `readPage`,
  `research`, and `readPages`.
- **`maxResults` and `maxChars` must be validated like `maxPages`.** Invalid
  values (zero, negative, non-integer, string, above cap) must produce an
  explicit `runtime.invalid_web_request` audit, not best-effort omission.
  `agentBlockParser` must apply the same validation at parse time.
- **`MAX_WEB_PAGE_CHARS = 50_000` is the cap for `maxChars` in web research.**
  Do not use `planSchema.ts`'s `MAX_PAGE_CHARS = 200_000` (workspace file reads).
  Add `MAX_WEB_PAGE_CHARS` and `MAX_SEARCH_RESULTS` to `src/webresearch/limits.ts`;
  update `braveSearch.ts` to import `MAX_SEARCH_RESULTS` from there.
- **`RuntimeWebOptionsValidationError` replaces the nonexistent
  `RuntimeProtocolError`.** `validateRuntimeWebOptions()` throws this class for
  schema violations; `normalizeOptionalPositiveIntegerLimit` throws
  `LimitValidationError` for limit violations. `validateRuntimeWebOptions` wraps
  limit errors into `RuntimeWebOptionsValidationError` so the runtime has one
  error type to handle. Runtime branches catch it and emit
  `event_type: 'runtime.invalid_web_request'`.
- **Approved bulk-research invalid options are payload-invalid, not provider
  failures.** `sanitizeResearchOptions(parsed.options)` must be called inside
  the payload-validation try/catch, before `web.research_started`. Invalid
  options reach `failInvalidBulkResearchPayload`, not `web.research_failed`.
- **Rust `sk-ant-` / `sk-` redaction uses precise ownership (Option A).**
  The generic `sk-` rule must skip tokens starting with `sk-ant-`. This
  prevents double-handling: `sk-ant-*` tokens are exclusively owned by the
  `sk-ant-` rule. Tests prove short `sk-ant-` tokens are not redacted and long
  `sk-ant-` tokens are redacted only by the `sk-ant-` rule, not the `sk-` rule.
- **FIX8 evidence note corrected.** The FIX8 acceptance checklist item
  "`referenceRuntime` forwards validated options for all web ops" was imprecise:
  FIX8 only implemented readPages forwarding; search/readPage/research forwarding
  was deferred. FIX9 completes the parity.

## FIX10 Locked decisions (2026-06-29, from `docs/BROWSERCLAW_WORKSPACE_SCRIPTING_WEBRESEARCH_FIX10_REPLIES.md`)

- **`webRunner` search and page-read sanitizers must be strict.** `sanitizeSearchOptions()`
  and `sanitizeReadOptions()` must throw `WebEffectPayloadError` on non-object input,
  unknown fields, and invalid limit values. Silent dropping of malformed values is not
  acceptable. New helpers `assertPlainOptionsObject()` and `rejectUnknownOptionFields()`
  shared between both sanitizers.
- **Invalid `maxResults` and `maxChars` must not be silently dropped.** Any invalid
  value (string, zero, negative, non-integer, above cap) must throw, not be omitted.
  `SEARCH_OPTION_FIELDS = {'maxResults'}` (site rejected for FIX10).
  `PAGE_READ_OPTION_FIELDS = {'maxChars'}` (format and timeoutMs rejected for FIX10).
- **Approved single page-read invalid options are payload-invalid, not provider failures.**
  `sanitizeReadOptions()` must be called before `web.page_read_started` inside a
  payload-validation try/catch. Invalid options emit `web.page_read_payload_invalid`
  via a new `failInvalidPageReadPayload()` helper (mirroring the bulk-research helper).
  The `WebResearchService.readPage(url, options)` two-arg call form is kept; no interface
  refactor in FIX10.
- **`pageReaderProvider` must validate `maxChars` at the provider boundary.**
  `readPage()` validates `request.maxChars` and returns a structured `invalid_request`
  failure before calling the extension. `readPages()` validates `maxChars` in a second
  independent try/catch after the existing `maxPages` try/catch (not combined), so
  `expectedUrls` is always computed from a valid `effectiveMaxPages`. Invalid `maxChars`
  returns one failure per expected URL; transport is not called.
- **Extension `read_page` and `read_pages` must validate `maxChars` centrally and
  directly.** `validateOptionalMaxChars()` calls the existing
  `validateOptionalPositiveIntegerLimit(value, 'maxChars', DEFAULT_MAX_CHARS)`. It is
  called in `validateMessageSchema()` for both message types and in `handleReadPage()` /
  `handleReadPages()` for direct-call defense-in-depth. No new constant introduced;
  the existing `DEFAULT_MAX_CHARS = 50_000` is reused (mirrors `MAX_WEB_PAGE_CHARS`).
- **Gate evidence must distinguish pass / fail / cannot-run / not-attempted.** A
  NOT ATTEMPTED task must remain `[ ]` unchecked, not `[x]`. This corrects the FIX9
  `test:extension:e2e:docker` checkbox which was ticked while noting NOT ATTEMPTED.

## FIX11 Locked decisions (2026-06-29, from `docs/BROWSERCLAW_WORKSPACE_SCRIPTING_WEBRESEARCH_FIX11_RESPONSES.md`)

- **`sanitizeResearchOptions()` must be strict like search/page-read sanitizers.**
  Use `assertPlainOptionsObject()` + `rejectUnknownOptionFields()` (FIX10 helpers).
  `RESEARCH_OPTION_FIELDS = {'maxPages', 'maxResults', 'maxChars'}` only.
  `site` and `format` are rejected because they are not honored end-to-end; they
  must not be accepted at any sanitizer boundary in FIX11.
- **`site` and `format` removed from `ResearchOptions` type.** `ResearchOptions`
  no longer extends `SearchOptions`; it becomes a standalone type with only
  `maxPages?`, `maxResults?`, `maxChars?`. Compile errors from this change identify
  hidden legacy paths that assumed unsupported options — fix those paths, do not
  suppress errors or keep dead fields.
- **Approved bulk-research invalid options must remain payload-invalid before
  `web.research_started`.** The payload try/catch structure from FIX9/FIX10 is
  retained; the strict sanitizer from Part A plugs in automatically.
- **Extension `invalid_request` maps to `PageReadResult.error.kind === 'invalid_request'`.**
  Update `ERROR_KIND_MAP` in `pageReaderProvider.ts` so extension-side `invalid_request`
  does not become `internal_error`. Add `'invalid_request'` to `PageReadErrorKind`.
  `internal_error` is reserved for unexpected failures and malformed extension responses.
- **`protocol.ts` validates `read_page/read_pages.maxChars` inline.** No new helper;
  use the existing `return { ok: false, reason }` style already in `parseExtensionRequest()`.
  Cap: 50,000 (= `MAX_WEB_PAGE_CHARS`).
- **Extension `web_search.maxResults` must be validated, not silently defaulted.**
  Add `DEFAULT_SEARCH_RESULTS = 10` (internal constant, not exported) and
  `validateOptionalMaxResults()` helper. Wire in `validateMessageSchema()` and
  `handleWebSearch()`. Invalid `maxResults` returns `invalid_request`; valid absent
  `maxResults` uses `DEFAULT_SEARCH_RESULTS`.

## FIX12 Locked decisions (2026-06-30)

- **Batch `readPages()` top-level extension `invalid_request` must map to `invalid_request`.**
  The combined `!isExtensionResponse(raw) || !raw.ok || !Array.isArray(raw['results'])`
  guard in `pageReaderProvider.readPages()` was split into three cases so that the
  extension's own error kind is preserved via `toError()`. Malformed responses
  (not an `ExtensionResponse`) and successful responses missing `results` still
  return `internal_error`.
- **Service-worker central schema and direct handler must both validate `web_search.maxResults`.**
  `validateMessageSchema()` now calls `validateOptionalMaxResults(message.maxResults)`
  in the `web_search` branch. `handleWebSearch()` retains its own defensive check.
  Both layers validate independently (central first, direct as fallback).
- **BrowserClaw-side protocol must cap `web_search.maxResults` at 20.**
  `parseExtensionRequest()` now rejects `maxResults > SEARCH_MAX_RESULTS (20)`.
  Protocol.ts and service-worker now agree: `web_search.maxResults` must be a
  positive integer ≤ 20; `read_page/read_pages.maxChars` must be a positive
  integer ≤ 50,000.
- **Explicit test evidence must match actual tests.**
  FIX12 added string-type and at-cap tests for `read_page.maxChars` and
  `read_pages.maxChars` that were previously claimed in FIX11 but not tested.
  Central-schema and direct-handler validation tests are in separate describe
  blocks (B1 vs B2 in `serviceWorkerReadPages.test.ts`) to make the distinction
  clear.
- **Gate evidence must distinguish pass/fail/cannot-run/not-attempted.**
  `pnpm run test:extension:e2e` CANNOT RUN in this environment (no persistent
  Chrome / display). The Docker lane (`test:extension:e2e:docker`) PASSES (5/5)
  and is the authoritative result. All other required commands pass.

## FIX13 Locked decisions (2026-06-29)

- **Central `web_search` schema validation must check `maxResults` before `apiKey`.**
  A malformed request shape (invalid `maxResults`) should return `invalid_request`
  regardless of whether `apiKey` is present. Hiding a shape error behind a credential
  error makes errors non-deterministic and misleads callers. Order: query → maxResults →
  apiKey.
- **`invalid_request` for bad shape; `permission_denied` for missing credential.**
  When the `web_search` request is structurally valid (query non-empty, maxResults valid
  or absent) but `apiKey` is missing/empty, the response is `permission_denied`. Shape
  errors always surface first as `invalid_request`.
- **Direct `handleWebSearch()` validation remains unchanged.**
  The `validateOptionalMaxResults()` call inside `handleWebSearch()` is a defense-in-depth
  layer and must not be removed. The only change in FIX13 is the ordering within
  `validateMessageSchema()`.
- **FIX12 B1/B2 tests are not deleted or replaced.**
  FIX13 adds a new `A1 (FIX13)` describe block in `serviceWorkerReadPages.test.ts`.
  The existing FIX12 blocks remain and all still pass.
