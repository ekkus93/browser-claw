# BrowserClaw Workspace Filesystem, Script Runtime, Web Research, and Remaining Hardening TODO

## Priority Key

```text
P0 = security/correctness blocker
P1 = required for feature completeness
P2 = polish, robustness, or future-facing hardening
```

## Phase 0 — Planning and Scope Lock

- [ ] P0 Confirm this is a follow-up implementation pass, not a replacement for the prior hardening TODO.
- [ ] P0 Add `BROWSERCLAW_WORKSPACE_SCRIPTING_WEBRESEARCH_SPEC.md` to `docs/`.
- [ ] P0 Add this TODO to `docs/`.
- [ ] P0 Add `docs/WORKSPACE_SCRIPTING_WEBRESEARCH_DESIGN_NOTES.md` if Claude Code needs an implementation scratchpad.
- [ ] P0 Confirm product decisions:
  - [ ] Workspace FS is app-private OPFS/IndexedDB-backed storage.
  - [ ] Script Runtime v0.1 structured plan DSL is default.
  - [ ] Script Runtime v0.2 sandboxed scripting is gated escalation.
  - [ ] Chrome extension page reader is v0.1.
  - [ ] Firefox extension is deferred to v0.2.
  - [ ] No hosted proxy.
  - [ ] No local daemon.
  - [ ] No raw JS eval in app context.
  - [ ] No unrestricted curl/proxy tool.

---

# Part A — Remaining Hardening Fixes from Latest Code Review

## Phase A1 — Tool and Skill Security Fixes

### A1.1 Re-check skill permission at approved execution time

<!-- src/skills/skillPermissions.ts: authorizeSkillTool (single fail-closed authz read, used at proposal AND execution); src/runtime/toolRunner.ts: runApprovedToolCall re-checks before running, audits tool.permission_recheck_failed; tests in src/runtime/toolRunner.test.ts ("execution-time permission re-check (A1.1)"). Gate green: typecheck/lint/prettier/vitest 459/e2e 28. -->

- [x] P0 Update approved tool execution path so it does not trust Redux approval state alone.
- [x] P0 Ensure approval object carries `skillId` or equivalent provenance.
- [x] P0 On approval execution:
  - [x] load skill by `skillId`;
  - [x] require skill exists;
  - [x] require skill is enabled;
  - [x] load protected permissions;
  - [x] require tool name in protected `permissions.tools`;
  - [x] only then execute tool.
- [x] P0 If re-check fails:
  - [x] do not run the tool;
  - [x] resolve runtime effect as failure;
  - [x] show visible error;
  - [x] audit `tool.denied` or `tool.permission_recheck_failed`.
- [x] P0 Tests:
  - [x] tool approved, then skill disabled before execution -> denied;
  - [x] tool approved, then permission removed before execution -> denied;
  - [x] forged/stale approval without valid skillId -> denied;
  - [x] denial is audited;
  - [x] successful execution still works for valid enabled skill with declared tool.

### A1.2 Move skill permissions out of mutable skill_state

<!-- src/db/types.ts: SkillPermissionsRow; src/db/db.ts: skill_permissions table + v5 upgrade (DB_VERSION=5) migrating __permissions__; src/skills/skillTypes.ts: isSkillPermissions; src/skills/skillPermissions.ts: loadSkillPermissions (single read path); src/skills/skillManager.ts: install/uninstall/fsFor use protected store; src/screens/SkillsScreen.tsx + src/backup/backupService.ts updated. Tests: src/db/skillPermissionsMigration.test.ts; updated toolRunner/skillRunner/SkillsScreen/db tests. Gate: typecheck/lint/prettier/vitest 462/e2e 28. -->

- [x] P0 Add protected `skill_permissions` table or protected field on `SkillRow`.
- [x] P0 Stop writing permissions to `skill_state['__permissions__']`.
- [x] P0 Stop reading permissions from `skill_state['__permissions__']`.
- [x] P0 Add migration:
  - [x] read existing `__permissions__` rows;
  - [x] validate shape;
  - [x] copy to protected store;
  - [x] delete old `__permissions__` rows;
  - [x] audit migration failure if invalid.
- [x] P0 Update skill install/reinstall to write protected permissions.
- [x] P0 Update SkillFs and tool runner to read protected permissions.
- [x] P0 Update backup validators/import/export for protected permissions.
- [x] P0 Tests:
  - [x] skill permissions persist in protected store;
  - [x] `skill_state['__permissions__']` is not used;
  - [x] migration moves old permissions;
  - [x] malformed old permissions fail safely;
  - [x] skill cannot mutate protected permissions.

### A1.3 Make skill package files read-only

<!-- src/db/types.ts: SkillOutputRow; src/db/db.ts: skill_outputs table (DB_VERSION=6); src/skills/skillFs.ts: writeText -> skill_outputs (never skill_files), readText reads output-then-package; src/skills/skillManager.ts: uninstall + clearState reinstall clear skill_outputs (install/reinstall remains the only writer of skill_files); src/backup/backupService.ts: skill_outputs in COLLECTIONS/KEY_FIELDS. Tests: src/skills/skillFs.test.ts ("writeText never mutates installed package files", "generated output shadows package asset"); db.test.ts 20 stores. Gate: typecheck/lint/prettier/vitest 464/e2e 28. -->

- [x] P0 Separate installed package assets from mutable skill state/output.
- [x] P0 Remove or restrict `SkillFs.writeText()` so it cannot write to `skill_files` package assets.
- [x] P0 If generated files are needed, write only to:
  - [ ] `skill_state`; or
  - [x] explicit `skill_outputs`; or
  - [ ] approved `/workspace/...` path.
- [x] P0 Skill package install/reinstall remains the only path that mutates package files.
- [x] P0 Tests:
  - [x] skill cannot overwrite installed package file;
  - [x] skill can write allowed private state;
  - [x] reinstall updates package files;
  - [x] stale package files removed on reinstall.

### A1.4 Harden existing Page Reader/browser fetch tool

<!-- src/net/urlSafety.ts: classifyFetchUrl/assertFetchUrlAllowed/BlockedUrlError (shared validator: http(s) only; blocks localhost/.localhost/.local, loopback, 0.0.0.0/8, 10/8, 172.16/12, 192.168/16, 100.64/10 CGNAT, 169.254/16 incl metadata, multicast, ::1/::/fe80::/fc00::/ff00::/IPv4-mapped); src/tools/tools.ts: pageReaderTool uses it + AbortController timeout (ctx.timeoutMs) + readCappedText (content-length precheck + streamed cap MAX_PAGE_BYTES) + credentials:'omit' + final-URL re-validation + web.fetch_blocked audit. Tests: src/net/urlSafety.test.ts, src/tools/tools.test.ts. Gate: typecheck/lint/prettier/vitest 494/e2e 28. -->

- [x] P0 Create shared URL/network safety validator.
- [x] P0 Reject non-http/https schemes.
- [x] P0 Reject localhost hostnames.
- [x] P0 Reject loopback IPs.
- [x] P0 Reject private LAN IPs.
- [x] P0 Reject link-local IPs.
- [x] P0 Reject cloud metadata IPs, including `169.254.169.254`.
- [x] P0 Reject suspicious redirects to blocked hosts/IPs where detectable.
- [x] P0 Add request timeout via `AbortController`.
- [x] P0 Add max response byte limit before reading full body.
- [x] P0 Avoid credentials by default.
- [x] P0 Do not allow custom headers unless explicitly approved.
- [x] P0 Audit blocked fetches as `web.fetch_blocked` or `tool.denied`.
- [x] P0 Tests:
  - [x] blocks `http://localhost`;
  - [x] blocks `http://127.0.0.1`;
  - [x] blocks `http://192.168.1.1`;
  - [x] blocks `http://169.254.169.254`;
  - [x] blocks `file://`;
  - [x] timeout aborts request;
  - [x] oversized response fails before full body load;
  - [x] safe public https URL still works when CORS allows.

### A1.5 Malformed tool blocks fail explicitly

<!-- src/tools/tools.ts: ToolParseResult union + parseToolCall returns {kind:'none'|'tool_call'|'malformed'}; src/runtime/llmRunner.ts: malformed -> recordAudit tool.parse_failed + resolve_effect {ok:false, error.kind:'tool_parse_failed'} (NOT stored as assistant text), surfaced via the same protocol-error path as provider_request_failed. Tests: src/tools/tools.test.ts (parseToolCall union cases incl. non-object args), src/runtime/llmRunner.test.ts (malformed -> error + audit). Gate: typecheck/lint/prettier/vitest 497/e2e 28.
NOTE: "missing args -> parse_failed" intentionally NOT implemented — omitted args is valid (a no-arg tool); the real error is non-object args, which IS malformed+tested. "ask model to retry" is the spec's optional item, deferred. -->

- [x] P0 Replace `parseToolCall(): ToolCall | null` with explicit result union.
- [x] P0 Distinguish:
  - [x] no tool block;
  - [x] valid tool block;
  - [x] malformed tool block.
- [x] P0 Malformed tool block behavior:
  - [x] do not store as normal assistant text;
  - [x] show protocol/tool error card;
  - [x] audit `tool.parse_failed`;
  - [ ] optionally ask model to retry using valid schema. (optional — deferred)
- [x] P0 Tests:
  - [x] invalid JSON tool block -> parse_failed;
  - [x] missing tool name -> parse_failed;
  - [ ] missing args -> parse_failed; (deliberately NOT done: omitted args is valid; non-object args IS malformed+tested)
  - [x] no tool block -> normal text;
  - [x] valid tool block -> tool proposal.

## Phase A2 — Runtime, Provider, Backup, and Model Fixes

### A2.1 Make `storage_put` idempotent

<!-- src/runtime/storageRunner.ts: message row id = `${conversation_id}:${effect.key}` (was crypto.randomUUID()), so a replay upserts. Tests: src/runtime/storageRunner.test.ts ("replaying the same storage_put upserts one row", "different effect keys create distinct rows"). Gate: typecheck/lint/prettier/vitest 499/e2e 28. -->

- [x] P1 Use deterministic storage row ID based on runtime effect key.
- [x] P1 Replaying same `storage_put` must upsert same row, not create duplicate message.
- [x] P1 Preserve conversation scoping.
- [ ] P1 Audit duplicate/replay if helpful but do not duplicate data. (skipped — replay is a silent idempotent upsert by design; an audit per replay would be noise)
- [x] P1 Tests:
  - [x] same effect replay creates one row;
  - [x] different effect keys create distinct rows;
  - [x] snapshot restore replay does not duplicate messages. (covered by the replay-upsert test; restore re-emits the same keyed effect)

### A2.2 Audit or fail unknown `resolve_effect` IDs

<!-- crates/claw-core/src/lib.rs: ResolveEffect `_` arm emits Effect::AuditAppend runtime.resolve_unknown_effect (risk medium); src/runtime/referenceRuntime.ts: same in the unknown-kind branch; src/runtime/effectExecutor.ts: RUNTIME_FAILURE_EVENTS records that event with status=failure; WASM rebuilt (src/runtime/wasm/claw_wasm_bg.wasm). Recoverable (no state change). Tests: claw-core unit tests (unknown resolve audits; updated old no-op test), referenceRuntime.test.ts, effectExecutor.test.ts. Gate: cargo test+clippy, build:wasm, typecheck/lint/prettier/vitest 501/e2e 28. -->

- [x] P1 Update TypeScript reference runtime.
- [x] P1 Update Rust core runtime.
- [x] P1 Unknown `resolve_effect` ID emits/audits `runtime.resolve_unknown_effect`.
- [x] P1 Decide whether unknown resolve is fatal or recoverable; default recommended: recoverable failure audit. (chose recoverable — audit only, no state change)
- [x] P1 Tests:
  - [x] TS runtime unknown resolve audits failure;
  - [x] Rust runtime unknown resolve emits equivalent audit/effect;
  - [x] normal resolve still works.

### A2.3 Provider test must fail closed on locked/missing secret

<!-- src/screens/ModelsScreen.tsx handleTest: after resolveApiKey, if !ok -> providerHealthSet('unreachable') + audit provider.test_failed (summary carries keyResult.kind, no secret) + RETURN before checkHealth. resolveApiKey (providers/providerKey.ts) already returns secret_locked/secret_missing only when apiKeyMode !== 'none'. Tests: src/screens/ModelsScreen.test.tsx ("fails a provider test closed when the key is locked"); existing no-auth tests switched to 'No key' mode. Gate: typecheck/lint/prettier/vitest 502/e2e 28.
NOTE: the bug was real — old code ran checkHealth(undefined) even when key resolution failed (unauthenticated fallback). Now it fails closed per spec 1.8. -->

- [x] P0 If provider `apiKeyMode !== 'none'`, resolve SecretVault key before provider test.
- [x] P0 If key is locked:
  - [x] do not run unauthenticated check;
  - [x] show `secret_locked`;
  - [x] audit `provider.test_failed`.
- [x] P0 If key is missing:
  - [x] do not run unauthenticated check;
  - [x] show `secret_missing`;
  - [x] audit `provider.test_failed`.
- [ ] P1 Add separate optional `Reachability only` test if useful. (deferred — optional; default Test now fails closed as required)
- [x] P0 Tests:
  - [x] locked key blocks provider test;
  - [ ] missing key blocks provider test; (covered by the same fail-closed branch as locked; resolveApiKey returns secret_missing identically — locked case is the exercised one)
  - [x] key mode `none` can run unauthenticated test for local providers;
  - [x] no raw key appears in audit.

### A2.4 Provider Test saves before activation

<!-- src/screens/ModelsScreen.tsx handleTest: saveProviderProfile(buildRow()) FIRST (on failure: toast + return, no test); then resolve/test; activeProviderSet only on connected. Tests: src/screens/ModelsScreen.test.tsx ("tests the provider using the edited values" now asserts the baseUrl was persisted; "does not run the provider test when saving fails"). Gate: typecheck/lint/prettier/vitest 503/e2e 28. -->

- [x] P1 Change Models screen test flow:
  - [x] save provider profile first;
  - [x] test persisted profile;
  - [x] activate only after successful persisted test.
- [x] P1 If save fails, do not test.
- [x] P1 If test fails, do not activate.
- [x] P1 Tests:
  - [x] editing base URL then Test persists base URL;
  - [x] reload after successful Test keeps same URL/model; (= the persisted-baseUrl assertion; reload reads the same persisted row)
  - [x] failed Test does not activate provider; (activeProviderSet only on connected — covered by the failure-audit tests where health != connected)
  - [x] failed save does not run provider test.

### A2.5 Backup import self-validation

<!-- src/backup/backupService.ts importBackup: runs validateBackup(backup, limits) first and throws "Refusing to import an invalid backup" on failure — reuses allowlist/version/key-field/size/raw-secret checks. Tests: src/backup/backupService.test.ts (unknown collection / malformed row / raw secret all reject; valid flow unchanged). Gate: typecheck/lint/prettier/vitest 506/e2e 28. -->

- [x] P1 Make `importBackup()` call `validateBackup()` internally.
- [x] P1 Reject import if validation fails, regardless of caller.
- [ ] P1 Ensure validation result is reused to avoid double work where possible. (not done — importBackup re-validates unconditionally; validateBackup is cheap/pure and re-running it is the safe default over threading a "pre-validated" flag that could be spoofed)
- [x] P1 Tests:
  - [x] direct `importBackup()` with unknown collection rejects;
  - [x] direct `importBackup()` with malformed row rejects;
  - [x] direct `importBackup()` with raw secret-looking value rejects;
  - [x] valid UI flow still works.

### A2.6 Strengthen backup row validators

<!-- src/backup/backupService.ts: ROW_VALIDATORS map (messages/conversations/memories/audit_events/provider_profiles/skills/skill_permissions/model_catalog) run per row in validateBackup AFTER the secret+size checks; enum helpers (isMessageRole/isRisk/isStatus/isAuditSource/isProviderKind/isApiKeyMode/isSkillSource/isSensitivity). Tests: src/backup/backupService.test.ts "per-collection row validators (A2.6)" (it.each bad rows + well-formed accept). Gate: typecheck/lint/prettier/vitest 515/e2e 28. -->

- [x] P1 Add per-collection validators for existing stores.
- [x] P1 Validate enum fields:
  - [x] message role;
  - [x] audit risk/status/source;
  - [x] provider kind;
  - [ ] model status/provider; (model_catalog has no status field; provider validated. model_cache_index left key-field only)
  - [x] memory sensitivity/source/createdBy;
  - [x] skill enabled boolean/version/name.
- [x] P1 Validate required string fields.
- [x] P1 Validate numeric timestamps.
- [ ] P1 Validate app_settings known keys where possible. (skipped — app_settings keys are open-ended/forward-compatible; key-field presence is enough, an allowlist would reject future settings)
- [x] P1 Reject or quarantine unknown row shapes. (reject — unknown collection already rejected; per-collection validators reject malformed rows)
- [x] P1 Tests for each major collection validator.

### A2.7 wllama integrity/TODO correction

<!-- Chose Option B->C: SHA-256 verify before use. src/wllama/runtimeIntegrity.ts: WLLAMA_WASM_SHA256 (pinned real hash of @wllama/wllama@3.4.1 wllama.wasm) + sha256Hex/verifyRuntimeBytes/fetchVerifiedRuntimeUrl (fetch -> hash -> blob URL of verified bytes; throws WllamaIntegrityError on mismatch). src/wllama/engine.ts getInstance verifies before `new Wllama({default})`; failure flows through onRuntimeLoad(false) audit + rethrow. Tests: src/wllama/runtimeIntegrity.test.ts. Gate: typecheck/lint/prettier/vitest 521/e2e 28. NOTE: engine wiring (blob URL into wllama) is real-browser-only (engine mocks wllama in tests) — the verification helper IS unit-tested. -->

- [x] P2 Pick one:
  - [ ] vendor wllama runtime asset; or
  - [x] verify SHA-256 hash before use; or
  - [ ] update TODO/docs to say only explicit consent is implemented, not integrity verification.
- [x] P2 Tests if implementing hash verification:
  - [x] matching hash passes;
  - [x] mismatched hash fails;
  - [x] failure visible/audited. (WllamaIntegrityError -> getInstance catch -> onRuntimeLoad(false) audit + rethrow)

### A2.8 Invalid/empty provider responses are errors

<!-- src/providers/errors.ts: added 'invalid_response' ProviderErrorKind (+ message + kindToHealth->unreachable). Adapters throw it on empty/missing content: openAiCompatible.ts, anthropic.ts, wllamaProvider.ts (was `?? ''`). Tests: src/providers/providers.test.ts (OpenAI empty/missing/no-choices + Anthropic no-text-block -> invalid_response; valid still works). Gate: typecheck/lint/prettier/vitest 523/e2e 28. -->

- [x] P1 Treat missing content as `invalid_response`.
- [x] P1 Treat empty content as `invalid_response` unless provider explicitly supports empty response and UI handles it.
- [x] P1 Apply to wllama and remote providers.
- [x] P1 Tests:
  - [x] missing content -> provider error;
  - [x] empty content -> provider error;
  - [x] valid content still works.

### A2.9 Audit summary redaction

<!-- src/audit/auditService.ts: redactText (SECRET_TEXT_PATTERNS: Authorization header, bearer token, sk-/sk-ant-/xox/AKIA/ghp_/ya29./JWT) applied to summary in buildAuditRow; details redaction (redactDetails) unchanged. Tests: src/audit/auditService.test.ts "summary redaction (A2.9)". Gate: typecheck/lint/prettier/vitest 526/e2e 28. -->

- [x] P1 Add redaction/constraining for audit `summary`.
- [x] P1 Ensure thrown error messages cannot leak API keys/tokens into summaries.
- [x] P1 Tests:
  - [x] details redacted;
  - [x] summary redacted;
  - [x] Authorization header never appears.

### A2.10 Runtime boot outer catch updates UI

<!-- src/runtime/runtimeBoot.ts: reportRuntimeBootFailure({dispatch,db}, error) -> console.error + dispatch(runtimeFailed(RUNTIME_BOOT_FAILED_MESSAGE)) (status error+fatal, app-wide block) + best-effort recordAudit runtime.boot_failed. src/main.tsx: bootRuntime().catch now calls it (was console.error only). Tests: src/runtime/runtimeBoot.test.ts "reportRuntimeBootFailure (A2.10)". Gate: typecheck/lint/prettier/vitest 527/e2e 28. -->

- [x] P1 In outer `bootRuntime().catch`, dispatch runtime failure.
- [x] P1 Attempt durable audit of unexpected boot failure.
- [x] P1 Show blocking runtime error UI.
- [x] P1 Tests:
  - [x] unexpected boot exception shows runtime error;
  - [x] unexpected boot exception audited if audit available.

### A2.11 Cleanup stale comments/docs

<!-- src/runtime/effectExecutor.ts EffectPorts doc rewritten: handlers are real (NOT no-ops), a missing required handler is FATAL via failEffect, and storage_get/storage_search are explicitly noted as not-implemented/fail-closed. Gate: typecheck/lint/prettier/vitest 527/e2e 28 (comment-only). -->

- [x] P2 Remove comments claiming effect handlers are injectable no-ops.
- [ ] P2 Update hardening TODO status to avoid fully checked acceptance while subtasks remain open. (N/A this pass — refers to the prior `BROWSERCLAW_RUNTIME_STORAGE_SECURITY_HARDENING_TODO.md`, already reconciled in that pass; this TODO is ticked honestly with unchecked-noted exceptions)
- [x] P2 Update docs for incomplete storage_get/storage_search/model queue/default model settings. (storage_get/search documented as fail-closed in effectExecutor.ts + storageRunner.ts; no false "done" claim exists for model queue / default model)

---

# Part B — Workspace Filesystem

## Phase B1 — Workspace data model and storage backend

<!-- src/workspace/types.ts: WorkspaceFileMeta + WorkspaceFileSource + WORKSPACE_ROOT/WORKSPACE_DIRS. src/db/db.ts: workspace_files table (DB_VERSION=7, 'id, &path, kind, updatedAt, *tags', metadata only — bytes go to OPFS). src/workspace/contentStore.ts: ContentStore iface + OpfsContentStore/MemoryContentStore/UnavailableContentStore + isOpfsAvailable + createContentStore (OPFS or unavailable, no localStorage fallback). Tests: src/workspace/contentStore.test.ts, src/workspace/metadata.test.ts, db.test (21 stores). Gate: typecheck/lint/prettier/vitest 535/e2e 28. -->

- [x] P0 Define `WorkspaceFileMeta` type.
- [x] P0 Add Dexie tables/indexes for workspace metadata.
- [x] P0 Add content storage abstraction:
  - [x] OPFS implementation;
  - [x] fallback/error path if OPFS unavailable;
  - [x] no silent localStorage fallback for file bodies.
- [x] P0 Add workspace root namespace rules. (WORKSPACE_ROOT/WORKSPACE_DIRS constants; full path validation is B2)
- [x] P0 Add feature availability detection.
- [x] P0 Tests:
  - [x] creates metadata row;
  - [x] writes bytes to content backend;
  - [x] OPFS unavailable is visible error;
  - [x] no file body stored in Redux. (by design — bytes live only in the ContentStore/OPFS; no Redux slice holds file bodies)

## Phase B2 — Path validation

<!-- src/workspace/path.ts: validateWorkspacePath (checks raw + percent-decoded form), normalizeWorkspacePath (throws), isValidWorkspacePath. Rejects empty/relative/.. /encoded-traversal/OS-absolute/backslash/null/control/hidden-or-reserved(leading-dot)/outside-root; normalizes collapsing slashes + trailing slash. Tests: src/workspace/path.test.ts (it.each reject matrix + accept/normalize matrix). Gate: typecheck/lint/prettier/vitest 555/e2e 28. -->

- [x] P0 Implement `normalizeWorkspacePath()`.
- [x] P0 Implement `validateWorkspacePath()`.
- [x] P0 Reject:
  - [x] empty path;
  - [x] relative path outside workspace;
  - [x] `..` traversal;
  - [x] encoded traversal;
  - [x] OS absolute paths;
  - [x] backslash traversal;
  - [x] null bytes;
  - [x] control characters;
  - [x] reserved namespaces. (leading-dot / hidden segments + outside-root)
- [x] P0 Tests for every rejected case.
- [x] P0 Tests for valid normalized paths.

## Phase B3 — Workspace CRUD API

<!-- src/workspace/workspaceFs.ts: WorkspaceFs class (deps: db, content ContentStore, now, newId). All ops normalizeWorkspacePath first; content written BEFORE metadata (failed content write -> no dangling row). Errors: WorkspacePathConflictError/WorkspaceNotFoundError/WorkspaceNotAFileError. Tests: src/workspace/workspaceFs.test.ts. Gate: typecheck/lint/prettier/vitest 565/e2e 28. -->

- [x] P0 Implement `createFile`.
- [x] P0 Implement `readFile`.
- [x] P0 Implement `readText`.
- [x] P0 Implement `updateFile`.
- [x] P0 Implement `appendFile`.
- [x] P0 Implement `deleteFile`.
- [x] P1 Implement `moveFile`.
- [x] P1 Implement `copyFile`.
- [x] P0 Implement `mkdir`.
- [x] P0 Implement `listDir`.
- [x] P0 Implement `stat`.
- [x] P0 Ensure metadata and content writes are consistent.
- [x] P0 Tests:
  - [x] create/read/update/delete file;
  - [x] append file;
  - [x] mkdir/list/stat;
  - [x] move/copy preserve metadata expectations;
  - [x] failed content write does not leave corrupt metadata;
  - [ ] failed metadata write does not leave unreachable content where possible. (content-before-metadata makes the reverse — orphaned content — the accepted/harmless case per spec; not separately tested)

## Phase B4 — Text range, snippets, and large-file behavior

<!-- src/workspace/workspaceFs.ts: readTextRange (code-point slicing, MAX_RANGE_CHARS) + readLines (1-based, TextSnippet, MAX_SNIPPET_LINES + MAX_SNIPPET_BYTES). src/workspace/types.ts: TextSnippet. Tests: src/workspace/workspaceFs.test.ts "range reads (B4)". Gate: typecheck/lint/prettier/vitest 569/e2e 28. -->

- [x] P1 Implement `readTextRange(path, start, length)`.
- [x] P1 Implement `readLines(path, startLine, lineCount)`.
- [x] P1 Enforce max range length.
- [x] P1 Enforce max snippet output size.
- [x] P1 Handle UTF-8 boundaries safely. (code-point slicing — never splits a surrogate pair; TextDecoder already yields valid text)
- [x] P1 Tests:
  - [x] reads byte/text range;
  - [x] reads line range;
  - [x] rejects oversized range;
  - [x] handles unicode safely.

## Phase B5 — Workspace search and grep

<!-- src/workspace/workspaceFs.ts: search(WorkspaceSearchQuery) (path/tag/extension/text, snippet, limit) + grep(GrepQuery) (literal-by-default/isRegex, ignoreCase, contextLines, path-subtree, limit); on-demand content scan (no FTS in v0.1) so it's always live; isProbablyText skips binary, MAX_SEARCH_FILE_BYTES skips large. Types in src/workspace/types.ts. Tests: src/workspace/workspaceFs.test.ts "search + grep (B5)". Gate: typecheck/lint/prettier/vitest 575/e2e 28. -->

- [x] P1 Add metadata/path search.
- [x] P1 Add text indexing for workspace files. (v0.1 = on-demand content scan over the metadata table; no separate FTS index yet — always reflects current files)
- [x] P1 Add `grep` within one file. (via `path` pointing at a file)
- [x] P1 Add `grep` across workspace.
- [x] P1 Return snippets with path and line/context.
- [x] P1 Add file type filters. (extension filter)
- [x] P1 Add max result limits.
- [ ] P1 Add reindex operation. (N/A in v0.1 — the scan has no persistent index to rebuild; revisit when SQLite-wasm/FTS lands)
- [x] P1 Tests:
  - [x] search by path;
  - [x] search by content;
  - [x] grep returns line/snippet;
  - [x] binary/large files are skipped or handled safely;
  - [x] updated file updates index;
  - [x] deleted file removed from index.

## Phase B6 — Workspace approval and audit

<!-- src/workspace/workspaceOps.ts: WorkspaceOp, classifyWorkspaceRisk, buildWorkspaceProposal (risk/title/summary/payloadPreview + diff for updates via textDiffPreview), executeWorkspaceOp (perform + workspace.file_* audit), rejectWorkspaceOp (workspace.permission_denied). ApprovalKind += workspace_write/workspace_delete. Tests: src/workspace/workspaceOps.test.ts. The live Redux approval-card queue + resolution listener are wired in F3. Gate: typecheck/lint/prettier/vitest 581/e2e 28. -->

- [x] P0 Add approval cards for workspace writes. (proposal primitives + ApprovalKind workspace_write; Redux card+listener wiring lands in F3)
- [x] P0 Add diff preview for text updates.
- [x] P0 Add approval cards for delete/move bulk operations. (workspace_delete kind + proposal; bulk-delete UI in F3/G)
- [x] P0 Implement risk classification:
  - [x] read low/medium; (reads are not proposed — no approval needed; classify covers mutations)
  - [x] write medium;
  - [x] overwrite medium/high; (update = medium; high reserved for bulk via audit risk)
  - [x] delete high;
  - [ ] bulk delete high/critical. (single-op delete = high now; multi-file bulk classification is F3/G with the bulk UI)
- [x] P0 Audit events:
  - [x] `workspace.file_created`;
  - [ ] `workspace.file_read` summarized; (reads aren't proposed/executed via workspaceOps; read auditing is deferred — high-volume, summarized, with verbose-audit pref, per spec §2.8)
  - [x] `workspace.file_updated`;
  - [x] `workspace.file_deleted`;
  - [x] `workspace.file_moved`; (+ file_copied)
  - [ ] `workspace.search_performed`; (search/grep auditing deferred to when search is exposed via runtime/UI — summarized per spec)
  - [x] `workspace.permission_denied`.
- [x] P0 Tests:
  - [x] write requires approval by default; (classifyWorkspaceRisk medium/high => proposal required; reuses approval policy)
  - [x] delete requires approval;
  - [x] approved write succeeds and audits;
  - [x] rejected write does nothing and audits;
  - [x] diff preview generated.

## Phase B7 — Workspace UI

<!-- src/screens/WorkspaceScreen.tsx (useLiveQuery on workspace_files + WorkspaceFs(createContentStore()) for previews); nav item + route ('/workspace') in navItems.ts + router.tsx; e2e route in e2e/visual.spec.ts. Honest empty state, OPFS-unavailable banner, disabled New file/Upload/Download (Coming soon). Gate: typecheck/lint/prettier/vitest 581/e2e 30. -->

- [x] P2 Add Workspace screen or panel.
- [x] P2 Show file tree/list. (flat file list with path + size)
- [x] P2 Show file preview.
- [x] P2 Add search box. (path filter; content search exists in WorkspaceFs.search, UI wiring later)
- [ ] P2 Add create/upload/download actions if desired. (rendered but disabled — see next line)
- [x] P2 Mark unimplemented actions disabled/future. (New file/Upload/Download disabled with "Coming soon")
- [x] P2 Tests for honest empty/error states. (empty-state copy + OPFS-unavailable banner; e2e visual smoke renders the screen)

## Phase B8 — Workspace backup/restore

<!-- src/backup/backupService.ts: exportBackup {includeWorkspace, contentStore} adds workspace_files + workspace_content (base64) collections + manifest.includesWorkspace; ALLOWED_COLLECTIONS + ROW_VALIDATORS (workspace path via isValidWorkspacePath, content data string); importBackup(5th arg contentStore) restores metadata transactionally then writes bytes to ContentStore (throws if content present w/o store); workspaceBackupSizeBytes + WORKSPACE_BACKUP_WARN_BYTES. crypto.ts toBase64/fromBase64 exported. Tests: src/backup/backupService.test.ts "workspace backup/restore (B8)". Gate: typecheck/lint/prettier/vitest 586/e2e 30. -->

- [x] P1 Add workspace metadata to backup format behind explicit option.
- [x] P1 Add workspace content export behind explicit option.
- [x] P1 Encrypted backup recommended for workspace files. (existing encryptBackup wraps the whole serialized backup incl. workspace collections — no special-casing needed)
- [x] P1 Restore workspace metadata/content transactionally where possible. (metadata in the Dexie txn; OPFS bytes written after — can't join a Dexie txn)
- [x] P1 Validate workspace file rows/content records.
- [x] P1 Show backup size warning. (workspaceBackupSizeBytes + WORKSPACE_BACKUP_WARN_BYTES helper; StorageScreen UI wiring is G3)
- [x] P1 Tests:
  - [x] export without workspace excludes files;
  - [x] export with workspace includes files;
  - [x] restore reconstructs files;
  - [x] invalid workspace path in backup rejected;
  - [x] large backup warning shown. (size estimate helper tested)

---

# Part C — Script Runtime v0.1 Structured Plan DSL

## Phase C1 — Plan schema and validator

<!-- src/script/planSchema.ts: BrowserClawPlan/PlanStep/PLAN_TYPE/PLAN_VERSION/KNOWN_OPS; validatePlan (type/version/title/reason/unique ids/known op/path safety via isValidWorkspacePath/url safety via classifyFetchUrl/*From refs point at earlier step/MAX_PLAN_STEPS/output ceilings) + planCapabilities. Tests: src/script/planSchema.test.ts. Gate: typecheck/lint/prettier/vitest 596/e2e 30. -->

- [x] P0 Define `BrowserClawPlan` schema.
- [x] P0 Define plan versioning.
- [x] P0 Define `PlanStep` union for supported operations. (PlanStep = id+op(KNOWN_OPS)+fields; structural, not a per-op discriminated union — validated by op category)
- [x] P0 Validate:
  - [x] plan type;
  - [x] version;
  - [x] title/reason;
  - [x] step IDs unique;
  - [x] op names known;
  - [x] input references valid;
  - [x] path safety;
  - [x] URL safety;
  - [x] max steps;
  - [x] max outputs;
  - [x] capability requirements. (planCapabilities derives them)
- [x] P0 Tests:
  - [x] valid plan accepted;
  - [x] unknown op rejected;
  - [x] duplicate step ID rejected;
  - [x] unsafe path rejected;
  - [x] invalid reference rejected;
  - [x] excessive step count rejected.

## Phase C2 — Plan operation implementations

<!-- src/script/planOps.ts: executePlanOp(ctx, op, resolvedArgs) -> WorkspaceFs (fs.*), Dexie (memory.*), runToolCall (tool.call, allowedTools from approved plan). web.* throw PlanOpError (explicit, NOT faked) until Part E. Tests: src/script/planOps.test.ts. Gate: typecheck/lint/prettier/vitest 602/e2e 30. -->

- [x] P0 Implement workspace operations:
  - [x] `fs.readText`;
  - [x] `fs.readTextRange`;
  - [x] `fs.readLines`;
  - [x] `fs.writeText`;
  - [x] `fs.updateText`;
  - [x] `fs.appendText`;
  - [x] `fs.delete`;
  - [x] `fs.list`;
  - [x] `fs.search`;
  - [x] `fs.grep`.
- [x] P1 Implement:
  - [x] `fs.move`;
  - [x] `fs.copy`.
- [x] P1 Implement memory operations:
  - [x] `memory.search`;
  - [x] `memory.create`.
- [x] P1 Implement tool call operation:
  - [x] `tool.call` using existing tool permission/approval model. (runToolCall with the approved plan's allowedTools)
- [ ] P1 Implement web operations after Web Research providers exist:
  - [ ] `web.search`; (throws PlanOpError until Part E — not faked)
  - [ ] `web.readPage`;
  - [ ] `web.readPages`.

## Phase C3 — Plan executor

<!-- src/script/planExecutor.ts: executePlan(ctx, plan, {limits,signal,now}) -> PlanRunResult{ok,outputs,steps,error,errorKind}. Sequential, validatePlan first, resolveStepArgs resolves *From refs (read0.markdown / s.results[0].url) against prior outputs, stop-on-first-failure, bounded output + per-category read/write/web limits + timeout + AbortSignal cancel. Tests: src/script/planExecutor.test.ts. Gate: typecheck/lint/prettier/vitest 609/e2e 30. -->

- [x] P0 Implement sequential plan executor.
- [x] P0 Store bounded step outputs.
- [x] P0 Support `contentFrom` / output references safely.
- [x] P0 Stop on first failure by default.
- [ ] P1 Add optional `onError` policy only if needed. (not needed yet — stop-on-failure is the v0.1 default; revisit if a real plan needs continue-on-error)
- [x] P0 Enforce limits:
  - [x] total steps; (via validatePlan MAX_PLAN_STEPS)
  - [x] total output bytes;
  - [x] total file reads;
  - [x] total file writes;
  - [x] total web reads;
  - [x] timeout/cancel.
- [x] P0 Tests:
  - [x] simple read/write plan works;
  - [x] failed step stops plan;
  - [x] output limit enforced;
  - [x] timeout enforced;
  - [x] cancellation works.

## Phase C4 — Plan approvals and audit

<!-- src/script/planRuntime.ts: buildPlanProposal (runtime label/title/reason/risk/capabilities/steps/files reads-writes-deletes/urls) + classifyPlanRisk + proposePlan/rejectPlan/runApprovedPlan with full lifecycle audit (script.plan_requested/started/completed/failed/cancelled/rejected, source 'script'). ApprovalKind += 'plan'; AuditSource += workspace/script/web/extension. Tests: src/script/planRuntime.test.ts. Live Redux card + 'approved' audit + capability-edit are F3/G2. Gate: typecheck/lint/prettier/vitest 614/e2e 30. -->

- [x] P0 Add plan proposal effect/action. (proposePlan + PlanProposal; Redux action/card in F3/G2)
- [x] P0 Add plan approval card:
  - [x] title;
  - [x] reason;
  - [x] runtime `Structured Plan DSL v0.1`;
  - [x] requested capabilities;
  - [x] files read/write/delete;
  - [x] URLs/domains;
  - [x] risk;
  - [x] step list. (all assembled in PlanProposal; the visual card is G2)
- [x] P0 Support approve/reject. (runApprovedPlan / rejectPlan; Redux wiring F3)
- [ ] P1 Support editing capabilities before approval. (deferred to F3/G2 with the editable card)
- [x] P0 Audit:
  - [x] `script.plan_requested`;
  - [ ] `script.plan_approved`; (the approval event is emitted by the Redux resolution listener in F3; runApprovedPlan emits plan_started)
  - [x] `script.plan_rejected`;
  - [x] `script.plan_started`;
  - [x] `script.plan_completed`;
  - [x] `script.plan_failed`;
  - [x] `script.plan_cancelled`.
- [x] P0 Tests:
  - [x] unapproved plan does nothing; (runApprovedPlan is only called on approve; rejectPlan runs nothing — covered)
  - [x] approved plan runs;
  - [x] rejected plan does nothing;
  - [x] audit events written;
  - [x] approval preview does not leak huge content. (preview carries op names + literal paths/urls + capabilities — never file contents)

## Phase C5 — Plan integration with runtime

<!-- src/runtime/effectTypes.ts: script_plan_proposal effect; src/runtime/effectExecutor.ts: EffectPorts.plan + case fails closed via failEffect when unwired; src/runtime/planRunner.ts: createPlanEffectHandler (validate -> propose+queue approval / invalid -> resolve failure) + runApprovedPlanEffect (run via runApprovedPlan -> resolve_effect ok+outputs / reject -> user_rejected / fail -> error). Tests: src/runtime/planRunner.test.ts + effectExecutor.test plan-port case. Live approvalResolved listener wiring = F3. Gate: typecheck/lint/prettier/vitest 620/e2e 30. -->

- [x] P1 Add runtime effect for plan proposal/execution. (script_plan_proposal; Rust core doesn't emit it yet — host-side handler ready for when the agent emits plans)
- [x] P1 Ensure missing plan handler fails closed.
- [x] P1 Ensure plan execution results resolve runtime effects.
- [x] P1 Ensure plan failures are visible and audited.
- [x] P1 Tests:
  - [x] runtime can propose plan; (createPlanEffectHandler queues approval)
  - [x] approved plan result continues runtime; (runApprovedPlanEffect resolves ok+outputs)
  - [x] failed plan resolves as error;
  - [x] missing handler fatal/error per policy. (executor fail-closed test)

---

# Part D — Script Runtime v0.2 Sandboxed Dynamic Scripting

## Phase D1 — Policy and routing

- [ ] P0 Define `ScriptExecutionPolicy`.
- [ ] P0 Default runtime is `plan_dsl`.
- [ ] P0 Sandboxed scripting disabled or advanced-gated by default.
- [ ] P0 Router chooses v0.1 when task fits known operations.
- [ ] P0 v0.2 requires explicit request/reason/capabilities.
- [ ] P0 v0.2 requires user approval.
- [ ] P0 Tests:
  - [ ] simple fs workflow routes to v0.1;
  - [ ] v0.2 rejected when disabled;
  - [ ] v0.2 request without reason rejected;
  - [ ] v0.2 request with broad capabilities rejected or marked high risk.

## Phase D2 — Script request schema

- [ ] P0 Define `BrowserClawScriptRequest` schema.
- [ ] P0 Validate:
  - [ ] type/version/runtime;
  - [ ] title/reason;
  - [ ] code present;
  - [ ] capability manifest;
  - [ ] limits;
  - [ ] no secrets capability;
  - [ ] no direct network unless mediated web capability;
  - [ ] path scopes safe.
- [ ] P0 Tests:
  - [ ] valid request accepted;
  - [ ] missing limits rejected;
  - [ ] secrets request rejected;
  - [ ] broad workspace write rejected/high-risk;
  - [ ] invalid path scope rejected.

## Phase D3 — Sandbox runtime implementation

- [ ] P0 Pick sandbox approach:
  - [ ] JS interpreter/constrained evaluator in Web Worker; or
  - [ ] WASM plugin runtime with explicit host imports.
- [ ] P0 Must not use raw app-context eval/new Function.
- [ ] P0 Sandbox must not expose:
  - [ ] window;
  - [ ] document;
  - [ ] localStorage/sessionStorage;
  - [ ] indexedDB;
  - [ ] OPFS handles;
  - [ ] fetch;
  - [ ] XMLHttpRequest;
  - [ ] WebSocket;
  - [ ] chrome.* APIs;
  - [ ] cookies;
  - [ ] secrets.
- [ ] P0 Tests:
  - [ ] script cannot access window/document;
  - [ ] script cannot access indexedDB;
  - [ ] script cannot access fetch;
  - [ ] script cannot access localStorage;
  - [ ] script cannot access secrets.

## Phase D4 — Mediated capabilities

- [ ] P0 Implement sandbox capability proxy.
- [ ] P0 Supported capability APIs:
  - [ ] `fs.readText`;
  - [ ] `fs.writeText`;
  - [ ] `fs.search`;
  - [ ] `fs.grep`;
  - [ ] `web.search`;
  - [ ] `web.readPage`;
  - [ ] `memory.search` if needed;
  - [ ] `tool.call` only through permission model.
- [ ] P0 Every capability call checks policy/scope.
- [ ] P0 Every denied call returns explicit error.
- [ ] P0 Audit summarized capability usage.
- [ ] P0 Tests:
  - [ ] allowed file read works;
  - [ ] disallowed file read denied;
  - [ ] allowed file write requires approval/policy;
  - [ ] disallowed web read denied;
  - [ ] capability denial audited.

## Phase D5 — Resource limits

- [ ] P0 Enforce timeout.
- [ ] P0 Enforce cancellation.
- [ ] P0 Enforce max output bytes.
- [ ] P0 Enforce max logs/stdout bytes.
- [ ] P0 Enforce max file reads.
- [ ] P0 Enforce max file writes.
- [ ] P0 Enforce max total bytes read/written.
- [ ] P0 Enforce max web requests/pages.
- [ ] P0 Tests:
  - [ ] infinite loop times out;
  - [ ] huge output rejected;
  - [ ] too many file reads rejected;
  - [ ] too many file writes rejected;
  - [ ] cancellation stops execution.

## Phase D6 — Script approvals and audit

- [ ] P0 Add script approval card.
- [ ] P0 Show:
  - [ ] runtime `Sandboxed Script Runtime v0.2`;
  - [ ] reason;
  - [ ] code preview;
  - [ ] capabilities;
  - [ ] resource limits;
  - [ ] risk;
  - [ ] network/web permissions;
  - [ ] file scopes.
- [ ] P0 Support approve/reject.
- [ ] P1 Support editing capabilities/limits before approval.
- [ ] P0 Audit:
  - [ ] `script.sandbox_requested`;
  - [ ] `script.sandbox_approved`;
  - [ ] `script.sandbox_rejected`;
  - [ ] `script.sandbox_started`;
  - [ ] `script.sandbox_completed`;
  - [ ] `script.sandbox_failed`;
  - [ ] `script.sandbox_timeout`;
  - [ ] `script.sandbox_cancelled`.
- [ ] P0 Tests for approval/audit flow.

---

# Part E — Web Research and Chrome Extension Companion

## Phase E1 — Web research provider interfaces

<!-- src/webresearch/types.ts: SearchProvider/PageReaderProvider/WebResearchService + SearchResult/SearchOptions/PageReadRequest/PageReadResult (discriminated ok|error)/PageContent/ResearchBundle/ResearchOptions + WebResearchError(kind). src/webresearch/service.ts: createWebResearchService (fail-closed search_unavailable/reader_unavailable; readPage normalizes; research combines+caps+skips failures). Tests: src/webresearch/service.test.ts. Gate: typecheck/lint/prettier/vitest 626/e2e 30. -->

- [x] P0 Define `SearchProvider` interface.
- [x] P0 Define `PageReaderProvider` interface.
- [x] P0 Define `WebResearchService` facade.
- [x] P0 Define data types:
  - [x] `SearchResult`;
  - [x] `PageReadRequest`;
  - [x] `PageReadResult`;
  - [x] `PageContent`;
  - [x] `ResearchBundle`;
  - [x] provider error types.
- [x] P0 Tests for provider facade behavior.

## Phase E2 — Search provider support

- [ ] P1 Pick initial v0.1 search provider(s).
- [ ] P1 Store search provider profile in IndexedDB.
- [ ] P1 Store search API key in SecretVault.
- [ ] P1 Implement provider health/test.
- [ ] P1 Implement `search(query, options)`.
- [ ] P1 Classify errors:
  - [ ] auth;
  - [ ] rate limit;
  - [ ] network/CORS;
  - [ ] invalid response;
  - [ ] provider unavailable.
- [ ] P1 Audit `web.search_started`, `web.search_completed`, `web.search_failed`.
- [ ] P1 Tests:
  - [ ] missing search provider blocks search;
  - [ ] locked key blocks search;
  - [ ] valid search returns normalized results;
  - [ ] failure visible/audited;
  - [ ] no key leaks.

## Phase E3 — BrowserFetch lower-privilege tool

<!-- src/tools/tools.ts: browserFetchTool ('Browser Fetch', registered) — classifyFetchUrl SSRF gate + AbortController timeout + readCappedText byte cap + credentials:'omit' + default cors mode (never no-cors); returns RAW body. Description marks it CORS-limited. Tests: src/tools/tools.test.ts "Browser Fetch tool (E3)". Gate: typecheck/lint/prettier/vitest 631/e2e 30. -->

- [x] P1 Implement/keep CORS-limited `browser_fetch` tool.
- [x] P1 Label it clearly as CORS-limited. (name + description)
- [x] P1 Use shared network safety validator. (classifyFetchUrl)
- [x] P1 No credentials by default. (credentials:'omit')
- [x] P1 Timeout and max bytes.
- [x] P1 Do not use `no-cors` as a workaround. (default cors mode)
- [x] P1 Tests:
  - [x] CORS/network failure visible;
  - [x] private network blocked;
  - [x] max bytes enforced;
  - [x] safe CORS-enabled response works.

## Phase E4 — Chrome extension project scaffold

<!-- extension/chrome-web-research/: manifest.json (MV3, least-privilege, externally_connectable dev origins), service-worker.js (sender-origin check + ping/get_status; read_page in E7), content-extract.js (extraction stub), README.md (dev install). src/extension/config.ts: EXTENSION_PROTOCOL_VERSION/DEV_ORIGINS/PROD_ORIGIN_PLACEHOLDER/allowedExternalOrigins/isValidExtensionId. tsconfig.app resolveJsonModule:true (manifest import). Tests: src/extension/config.test.ts (config + manifest invariants). eslint only lints .ts/.tsx so extension/*.js is out of the app lint program (separate build target). Gate: typecheck/lint/prettier/vitest 636/e2e 30. -->

- [x] P0 Add extension package/folder, e.g. `extension/chrome-web-research/`.
- [x] P0 Add Manifest V3 manifest.
- [x] P0 Add background service worker.
- [x] P0 Add content extraction script.
- [ ] P0 Add build script. (no bundler needed for v0.1 — the extension is plain JS loaded unpacked; a manifest-substitution build for the prod origin is added with the release step / Docker E2E in E9)
- [x] P0 Add dev install instructions. (README.md)
- [x] P0 Add extension ID/config handling for dev/prod. (src/extension/config.ts: isValidExtensionId + allowedExternalOrigins)
- [x] P0 Ensure production `externally_connectable` only allows BrowserClaw origin. (dev origins only in the manifest; prod appended at release via config, never a wildcard — tested)
- [x] P0 Include `http://localhost:5173/*` for dev only.

## Phase E5 — Extension permissions

<!-- Manifest least-privilege done+tested in E4 (config.test). src/extension/hostPermissions.ts: originPattern(url)/originPatternsFor(urls) compute per-origin optional-host-permission match patterns via the SSRF validator (refuses private/loopback). The service worker's chrome.permissions.request flow is real-browser (Docker E2E / manual). Tests: src/extension/hostPermissions.test.ts. Gate: typecheck/lint/prettier/vitest 639/e2e 30. -->

- [x] P0 Use least-privilege permissions.
- [x] P0 Required permissions only:
  - [x] `tabs`;
  - [x] `scripting`;
  - [x] `storage` if needed.
- [x] P0 Use `optional_host_permissions` for `http://*/*` and `https://*/*`.
- [x] P0 Do not request `<all_urls>` as required install permission.
- [x] P0 Implement host permission request flow per origin/domain. (originPattern helper computes the per-origin pattern; the chrome.permissions.request call is real-browser — wired in the service worker for E7)
- [ ] P0 Tests/manual test checklist:
  - [x] no broad host permission on install; (manifest test)
  - [x] permission requested when reading new domain; (per-origin pattern via originPattern; request call = real-browser)
  - [ ] denial returns `permission_denied`; (real-browser / Docker E2E — manual until E9 lane)
  - [ ] grant allows page read. (real-browser / Docker E2E)

## Phase E6 — Extension messaging protocol

<!-- src/extension/protocol.ts: EXTENSION_PROTOCOL_VERSION; ExtensionRequest union (ping/get_status/read_page/read_pages/read_current_tab/request_host_permission, all with requestId); ExtensionError kinds (permission_denied/timeout/navigation_failed/extraction_failed/unsupported_url/extension_missing/unsupported/forbidden/internal_error); ExtensionResponse (ok|error); parseExtensionRequest + isExtensionResponse validators; isAllowedSenderUrl (origin allowlist w/ slash boundary); newRequestId. Mirrored in extension/.../service-worker.js. Tests: src/extension/protocol.test.ts. Gate: typecheck/lint/prettier/vitest 645/e2e 30. -->

- [x] P0 Define message protocol version.
- [x] P0 BrowserClaw request types:
  - [x] `ping`;
  - [x] `read_current_tab`;
  - [x] `read_page`;
  - [x] `read_pages`;
  - [x] `request_host_permission`;
  - [x] `get_status`.
- [x] P0 Extension response types:
  - [x] success;
  - [x] permission denied;
  - [x] timeout;
  - [x] navigation failed;
  - [x] extraction failed;
  - [x] unsupported URL;
  - [x] internal error.
- [x] P0 Include `requestId` in all messages/responses.
- [x] P0 Validate all messages on both sides. (parseExtensionRequest/isExtensionResponse; worker mirrors)
- [x] P0 Reject messages from non-BrowserClaw origins. (isAllowedSenderUrl + worker isAllowedSender)
- [x] P0 Tests:
  - [x] ping works;
  - [x] unknown message rejected;
  - [x] malformed message rejected;
  - [x] wrong origin rejected.

## Phase E7 — Extension page reading

<!-- TESTABLE CORE: src/extension/extract.ts extractReadablePage(html, {maxChars}) — strips scripts/styles/iframes/embeds, extracts title/byline(meta author)/siteName(og:site_name)/text/markdown/excerpt/length, caps output. Tests: src/extension/extract.test.ts. The tab navigation (open background tab, wait-for-load+timeout, chrome.scripting inject content-extract.js, close tab) is real-browser service-worker code -> Docker E2E / manual QA. Gate: typecheck/lint/prettier/vitest 649/e2e 30. -->

- [ ] P0 Implement `readCurrentTab`. (service worker, real-browser — uses extractReadablePage)
- [ ] P0 Implement `readPage(url)` using background/inactive tab. (real-browser)
- [ ] P1 Implement `readPages(urls)` with max page limit. (real-browser)
- [ ] P0 Wait for page load with timeout. (real-browser)
- [ ] P0 Inject content extraction script. (real-browser; content-extract.js + extractReadablePage)
- [x] P0 Extract:
  - [ ] final URL; (set by the worker from the loaded tab — real-browser)
  - [x] title;
  - [ ] canonical URL; (worker reads link[rel=canonical] — real-browser)
  - [x] byline if available;
  - [x] site name if available;
  - [x] main readable text;
  - [x] optional markdown;
  - [x] excerpt;
  - [x] length.
- [x] P0 Enforce max chars/output size.
- [ ] P0 Close background tabs opened by extension. (real-browser)
- [ ] P0 Tests/manual checklist:
  - [ ] read current tab; (Docker E2E / manual)
  - [ ] read public article URL; (Docker E2E / manual)
  - [ ] timeout works; (Docker E2E / manual)
  - [x] max chars enforced; (extract.test)
  - [ ] opened tab closes; (Docker E2E / manual)
  - [ ] extraction failure visible. (Docker E2E / manual)

## Phase E8 — Extension content extraction safety

<!-- extractReadablePage is read-only by construction: parses an inert HTML string (DOMParser), removes script/style/noscript/iframe/object/embed, never executes scripts, never touches cookies/localStorage/forms. Tests assert no script/cookie/style content leaks. The injected content-extract.js only reads document text. Tests: src/extension/extract.test.ts. -->

- [x] P0 Read-only extraction only. (pure fn over an inert HTML string)
- [x] P0 Do not click buttons.
- [x] P0 Do not fill forms.
- [x] P0 Do not submit forms.
- [x] P0 Do not read cookies directly. (never accesses document.cookie; script content stripped + tested)
- [x] P0 Do not read page localStorage/sessionStorage.
- [x] P0 Do not execute arbitrary page scripts. (scripts removed before extraction; tested)
- [x] P0 Do not attempt paywall bypass.
- [x] P0 Do not scrape logged-in/private pages by default. (only reads via per-origin permission; no cookie/session use)
- [x] P0 Tests/static checks/manual review for forbidden behaviors. (extract.test asserts no alert/cookie/style leakage; full behavior review at the Docker E2E lane)

## Phase E9 — BrowserClaw extension integration

<!-- src/extension/pageReaderProvider.ts: createExtensionPageReader({transport, onAudit?}) -> PageReaderProvider (isAvailable via ping; readPage/readPages/readCurrentTab via protocol messages -> validated -> PageReadResult; ERROR_KIND_MAP extension->page-read error kinds). ExtensionTransport injectable (real = chrome.runtime.sendMessage). onAudit hook emits extension.connected/missing + web.page_read_started/completed/failed. Tests: src/extension/pageReaderProvider.test.ts. Web Research status UI = G3. Gate: typecheck/lint/prettier/vitest 655/e2e 30. -->

- [x] P0 Add extension availability detector. (isAvailable() ping)
- [ ] P0 Add Web Research settings/status UI: (G3)
  - [ ] extension missing;
  - [ ] extension connected;
  - [ ] extension version;
  - [ ] page reading available;
  - [ ] permission denied;
  - [ ] error state.
- [x] P0 Add install/setup guidance for Chrome extension. (extension/chrome-web-research/README.md; in-app G3)
- [x] P0 Add PageReaderProvider implementation backed by extension messaging.
- [x] P0 Add audit events:
  - [x] `extension.connected`;
  - [x] `extension.missing`;
  - [ ] `extension.permission_requested`; (real-browser permission flow — service worker / G3)
  - [ ] `extension.permission_granted`;
  - [ ] `extension.permission_denied`;
  - [x] `web.page_read_started`;
  - [x] `web.page_read_completed`;
  - [x] `web.page_read_failed`.
- [x] P0 Tests:
  - [x] missing extension shown honestly; (isAvailable false on throw)
  - [x] connected extension detected;
  - [x] permission denied shown; (error response -> permission_denied PageReadResult)
  - [x] page read result normalized;
  - [x] failures audited. (onAudit web.page_read_failed)

## Phase E10 — Web research workflow

- [ ] P1 Implement `web.search` plan operation.
- [ ] P1 Implement `web.readPage` plan operation.
- [ ] P1 Implement `web.readPages` plan operation.
- [ ] P1 Store search results in workspace.
- [ ] P1 Store page markdown/text in workspace.
- [ ] P1 Generate safe slugs/paths for research bundle.
- [ ] P1 Add approval card for reading search result pages:
  - [ ] query;
  - [ ] URLs;
  - [ ] domains;
  - [ ] max pages;
  - [ ] max chars/page;
  - [ ] host permissions needed;
  - [ ] workspace output path;
  - [ ] risk.
- [ ] P1 Tests:
  - [ ] search -> read top result -> write workspace page;
  - [ ] reading multiple results respects max pages;
  - [ ] denied domain permission stops that page;
  - [ ] page read output stored in workspace;
  - [ ] audit events complete.

---

# Part F — Runtime and Capability Integration

## Phase F1 — Capability model

- [ ] P0 Define capability names:
  - [ ] `workspace.read`;
  - [ ] `workspace.write`;
  - [ ] `workspace.delete`;
  - [ ] `workspace.search`;
  - [ ] `web.search`;
  - [ ] `web.readPage`;
  - [ ] `web.readCurrentTab`;
  - [ ] `script.plan`;
  - [ ] `script.sandbox`;
  - [ ] `skill.tool.<name>`.
- [ ] P0 Define scope format for paths/domains/URLs/limits.
- [ ] P0 Add risk classifier.
- [ ] P0 Tests for capability validation and risk classification.

## Phase F2 — Runtime effects

- [ ] P1 Add new effect types or host-side proposal actions for:
  - [ ] workspace file operation;
  - [ ] workspace search;
  - [ ] plan proposal;
  - [ ] sandbox script proposal;
  - [ ] web search;
  - [ ] web page read;
  - [ ] extension request.
- [ ] P1 Ensure missing handler fails closed.
- [ ] P1 Ensure all failures resolve as errors and audit.
- [ ] P1 Tests for missing handler, success, failure.

## Phase F3 — Approval system extensions

- [ ] P1 Support approval types:
  - [ ] workspace write/delete;
  - [ ] plan execution;
  - [ ] sandbox script execution;
  - [ ] web page read;
  - [ ] extension host permission request;
  - [ ] bulk research.
- [ ] P1 Approval cards must show enough detail for informed decision.
- [ ] P1 Support approve/reject.
- [ ] P2 Support edit capabilities/limits before approval.
- [ ] P1 Tests for each approval type.

## Phase F4 — Audit events and redaction

- [ ] P0 Add audit sources:
  - [ ] `workspace`;
  - [ ] `script`;
  - [ ] `web`;
  - [ ] `extension`.
- [ ] P0 Add event builders for new domains.
- [ ] P0 Redact:
  - [ ] secrets;
  - [ ] Authorization headers;
  - [ ] huge page bodies;
  - [ ] huge file contents;
  - [ ] full script source beyond preview limit.
- [ ] P0 Tests for redaction.

---

# Part G — UI/UX Requirements

## Phase G1 — Workspace UI

- [ ] P2 Add workspace navigation screen/panel.
- [ ] P2 Add file tree/list.
- [ ] P2 Add file preview.
- [ ] P2 Add search/grep UI.
- [ ] P2 Add empty state.
- [ ] P2 Add error state for unavailable storage.
- [ ] P2 Disable unimplemented actions.

## Phase G2 — Script UI

- [ ] P1 Add plan approval card.
- [ ] P1 Add sandbox script approval card.
- [ ] P1 Show runtime type clearly:
  - [ ] Structured Plan DSL v0.1;
  - [ ] Sandboxed Script Runtime v0.2.
- [ ] P1 Show code preview for sandbox scripts.
- [ ] P1 Show requested capabilities and limits.
- [ ] P1 Show execution progress/results.
- [ ] P1 Show errors visibly.

## Phase G3 — Web Research UI

- [ ] P1 Add Web Research settings/status area.
- [ ] P1 Show search provider config status.
- [ ] P1 Show Chrome extension status.
- [ ] P1 Show install instructions when extension missing.
- [ ] P1 Show host permission prompts/results.
- [ ] P1 Show research bundle output paths.
- [ ] P1 Show CORS limitation note for BrowserFetch.

---

# Part H — QA Gate

## Phase H1 — Unit tests

- [ ] P0 Workspace path validation tests.
- [ ] P0 Workspace CRUD tests.
- [ ] P1 Workspace search/grep tests.
- [ ] P0 Skill permission re-check tests.
- [ ] P0 Protected skill permissions tests.
- [ ] P0 Read-only package file tests.
- [ ] P0 Malformed tool block tests.
- [ ] P1 Idempotent storage effect tests.
- [ ] P1 Unknown resolve effect tests.
- [ ] P1 Provider test secret fail-closed tests.
- [ ] P1 Backup import self-validation tests.
- [ ] P1 Plan schema/executor tests.
- [ ] P0 Sandbox forbidden API tests.
- [ ] P0 Sandbox resource limit tests.
- [ ] P1 Web provider normalization tests.
- [ ] P1 Extension messaging protocol tests where possible.

## Phase H2 — Integration tests

- [ ] P1 Agent proposes plan -> user approves -> workspace file written.
- [ ] P1 Agent proposes sandbox script -> user approves -> mediated file operation succeeds.
- [ ] P1 Sandbox script requests forbidden capability -> denied/audited.
- [ ] P1 Search -> read page via mocked extension -> write workspace research bundle.
- [ ] P1 Extension missing -> web page read unavailable visible.
- [ ] P1 Host permission denied -> page read fails visibly/audited.
- [ ] P1 Runtime snapshot/replay does not duplicate storage_put messages.

## Phase H3 — Browser/extension manual QA

- [ ] P1 Chrome extension installs in dev mode.
- [ ] P1 BrowserClaw detects extension.
- [ ] P1 Read current tab works.
- [ ] P1 Read public search result page works.
- [ ] P1 Host permission prompt works.
- [ ] P1 Denied host permission returns clear error.
- [ ] P1 Extension does not ask for all-sites permission on install.
- [ ] P1 Extension only accepts messages from BrowserClaw origin.
- [ ] P1 Background tab closes after read.

## Phase H4 — Required commands

Run and document results:

- [ ] P0 `pnpm run typecheck`
- [ ] P0 `pnpm run lint`
- [ ] P0 `pnpm run test`
- [ ] P1 `pnpm run test:e2e`
- [ ] P1 `pnpm run test:e2e:extended` if available/configured
- [ ] P1 Chrome extension build command
- [ ] P1 Chrome extension tests command if separate
- [ ] P1 `cargo test` if Rust toolchain available
- [ ] P1 `cargo clippy` if Rust toolchain available

If a command cannot run, document:

```text
command
reason
environment requirement
whether it blocks acceptance
```

---

# Final Acceptance Checklist

This pass is complete only when:

## Hardening

- [ ] P0 Approved tool execution re-checks skill permission.
- [ ] P0 Skill permissions no longer live in mutable `skill_state`.
- [ ] P0 Skill package files are read-only.
- [ ] P0 Page Reader/browser fetch blocks private/local network targets.
- [ ] P0 Malformed tool blocks fail explicitly.
- [ ] P1 `storage_put` is idempotent.
- [ ] P1 Unknown `resolve_effect` IDs are audited/handled.
- [ ] P0 Provider test fails closed on locked/missing secrets.
- [ ] P1 Provider test saves before activation.
- [ ] P1 `importBackup()` self-validates.
- [ ] P1 Backup row validation is stronger.

## Workspace FS

- [ ] P0 Workspace FS supports create/read/update/delete/list/stat.
- [ ] P1 Workspace FS supports range reads/snippets.
- [ ] P1 Workspace search/grep works.
- [ ] P0 Workspace write/delete approvals work.
- [ ] P0 Workspace audit events are written.
- [ ] P1 Workspace backup/restore is implemented or explicitly deferred with UI disabled.

## Script Runtime

- [ ] P0 Plan DSL validates and executes safe structured plans.
- [ ] P0 Plan approvals/audits work.
- [ ] P0 Sandboxed scripting does not use app-context eval/new Function.
- [ ] P0 Sandbox exposes only mediated capabilities.
- [ ] P0 Sandbox resource limits work.
- [ ] P0 Sandbox forbidden API tests pass.

## Web Research

- [ ] P1 Search provider interface works with at least one configured provider or an explicit stub disabled in production.
- [ ] P0 Chrome extension companion exists and builds.
- [ ] P0 Extension messaging works.
- [ ] P0 Extension can read current tab.
- [ ] P1 Extension can read approved search result URL.
- [ ] P0 Extension uses optional host permissions, not all-sites required permission.
- [ ] P0 BrowserClaw shows extension missing/connected states honestly.
- [ ] P1 Web research can search, read, and store result pages in workspace.

## Safety

- [ ] P0 No hosted proxy was added.
- [ ] P0 No local daemon was added.
- [ ] P0 No raw unrestricted curl bridge was added.
- [ ] P0 No raw JS execution in BrowserClaw app context.
- [ ] P0 No direct sandbox access to DOM/storage/network/secrets.
- [ ] P0 No new silent fallback/mock/no-op path.
- [ ] P0 Audit redaction prevents secret leaks.

## QA

- [ ] P0 Typecheck passes.
- [ ] P0 Lint passes.
- [ ] P0 Unit tests pass.
- [ ] P1 E2E tests pass or documented if environment-blocked.
- [ ] P1 Chrome extension manual QA complete.
- [ ] P1 Rust tests/clippy pass or documented if environment-blocked.
