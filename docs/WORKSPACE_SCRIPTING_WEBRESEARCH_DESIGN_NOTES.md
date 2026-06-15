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
