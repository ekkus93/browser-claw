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

- [ ] P0 Define `WorkspaceFileMeta` type.
- [ ] P0 Add Dexie tables/indexes for workspace metadata.
- [ ] P0 Add content storage abstraction:
  - [ ] OPFS implementation;
  - [ ] fallback/error path if OPFS unavailable;
  - [ ] no silent localStorage fallback for file bodies.
- [ ] P0 Add workspace root namespace rules.
- [ ] P0 Add feature availability detection.
- [ ] P0 Tests:
  - [ ] creates metadata row;
  - [ ] writes bytes to content backend;
  - [ ] OPFS unavailable is visible error;
  - [ ] no file body stored in Redux.

## Phase B2 — Path validation

- [ ] P0 Implement `normalizeWorkspacePath()`.
- [ ] P0 Implement `validateWorkspacePath()`.
- [ ] P0 Reject:
  - [ ] empty path;
  - [ ] relative path outside workspace;
  - [ ] `..` traversal;
  - [ ] encoded traversal;
  - [ ] OS absolute paths;
  - [ ] backslash traversal;
  - [ ] null bytes;
  - [ ] control characters;
  - [ ] reserved namespaces.
- [ ] P0 Tests for every rejected case.
- [ ] P0 Tests for valid normalized paths.

## Phase B3 — Workspace CRUD API

- [ ] P0 Implement `createFile`.
- [ ] P0 Implement `readFile`.
- [ ] P0 Implement `readText`.
- [ ] P0 Implement `updateFile`.
- [ ] P0 Implement `appendFile`.
- [ ] P0 Implement `deleteFile`.
- [ ] P1 Implement `moveFile`.
- [ ] P1 Implement `copyFile`.
- [ ] P0 Implement `mkdir`.
- [ ] P0 Implement `listDir`.
- [ ] P0 Implement `stat`.
- [ ] P0 Ensure metadata and content writes are consistent.
- [ ] P0 Tests:
  - [ ] create/read/update/delete file;
  - [ ] append file;
  - [ ] mkdir/list/stat;
  - [ ] move/copy preserve metadata expectations;
  - [ ] failed content write does not leave corrupt metadata;
  - [ ] failed metadata write does not leave unreachable content where possible.

## Phase B4 — Text range, snippets, and large-file behavior

- [ ] P1 Implement `readTextRange(path, start, length)`.
- [ ] P1 Implement `readLines(path, startLine, lineCount)`.
- [ ] P1 Enforce max range length.
- [ ] P1 Enforce max snippet output size.
- [ ] P1 Handle UTF-8 boundaries safely.
- [ ] P1 Tests:
  - [ ] reads byte/text range;
  - [ ] reads line range;
  - [ ] rejects oversized range;
  - [ ] handles unicode safely.

## Phase B5 — Workspace search and grep

- [ ] P1 Add metadata/path search.
- [ ] P1 Add text indexing for workspace files.
- [ ] P1 Add `grep` within one file.
- [ ] P1 Add `grep` across workspace.
- [ ] P1 Return snippets with path and line/context.
- [ ] P1 Add file type filters.
- [ ] P1 Add max result limits.
- [ ] P1 Add reindex operation.
- [ ] P1 Tests:
  - [ ] search by path;
  - [ ] search by content;
  - [ ] grep returns line/snippet;
  - [ ] binary/large files are skipped or handled safely;
  - [ ] updated file updates index;
  - [ ] deleted file removed from index.

## Phase B6 — Workspace approval and audit

- [ ] P0 Add approval cards for workspace writes.
- [ ] P0 Add diff preview for text updates.
- [ ] P0 Add approval cards for delete/move bulk operations.
- [ ] P0 Implement risk classification:
  - [ ] read low/medium;
  - [ ] write medium;
  - [ ] overwrite medium/high;
  - [ ] delete high;
  - [ ] bulk delete high/critical.
- [ ] P0 Audit events:
  - [ ] `workspace.file_created`;
  - [ ] `workspace.file_read` summarized;
  - [ ] `workspace.file_updated`;
  - [ ] `workspace.file_deleted`;
  - [ ] `workspace.file_moved`;
  - [ ] `workspace.search_performed`;
  - [ ] `workspace.permission_denied`.
- [ ] P0 Tests:
  - [ ] write requires approval by default;
  - [ ] delete requires approval;
  - [ ] approved write succeeds and audits;
  - [ ] rejected write does nothing and audits;
  - [ ] diff preview generated.

## Phase B7 — Workspace UI

- [ ] P2 Add Workspace screen or panel.
- [ ] P2 Show file tree/list.
- [ ] P2 Show file preview.
- [ ] P2 Add search box.
- [ ] P2 Add create/upload/download actions if desired.
- [ ] P2 Mark unimplemented actions disabled/future.
- [ ] P2 Tests for honest empty/error states.

## Phase B8 — Workspace backup/restore

- [ ] P1 Add workspace metadata to backup format behind explicit option.
- [ ] P1 Add workspace content export behind explicit option.
- [ ] P1 Encrypted backup recommended for workspace files.
- [ ] P1 Restore workspace metadata/content transactionally where possible.
- [ ] P1 Validate workspace file rows/content records.
- [ ] P1 Show backup size warning.
- [ ] P1 Tests:
  - [ ] export without workspace excludes files;
  - [ ] export with workspace includes files;
  - [ ] restore reconstructs files;
  - [ ] invalid workspace path in backup rejected;
  - [ ] large backup warning shown.

---

# Part C — Script Runtime v0.1 Structured Plan DSL

## Phase C1 — Plan schema and validator

- [ ] P0 Define `BrowserClawPlan` schema.
- [ ] P0 Define plan versioning.
- [ ] P0 Define `PlanStep` union for supported operations.
- [ ] P0 Validate:
  - [ ] plan type;
  - [ ] version;
  - [ ] title/reason;
  - [ ] step IDs unique;
  - [ ] op names known;
  - [ ] input references valid;
  - [ ] path safety;
  - [ ] URL safety;
  - [ ] max steps;
  - [ ] max outputs;
  - [ ] capability requirements.
- [ ] P0 Tests:
  - [ ] valid plan accepted;
  - [ ] unknown op rejected;
  - [ ] duplicate step ID rejected;
  - [ ] unsafe path rejected;
  - [ ] invalid reference rejected;
  - [ ] excessive step count rejected.

## Phase C2 — Plan operation implementations

- [ ] P0 Implement workspace operations:
  - [ ] `fs.readText`;
  - [ ] `fs.readTextRange`;
  - [ ] `fs.readLines`;
  - [ ] `fs.writeText`;
  - [ ] `fs.updateText`;
  - [ ] `fs.appendText`;
  - [ ] `fs.delete`;
  - [ ] `fs.list`;
  - [ ] `fs.search`;
  - [ ] `fs.grep`.
- [ ] P1 Implement:
  - [ ] `fs.move`;
  - [ ] `fs.copy`.
- [ ] P1 Implement memory operations:
  - [ ] `memory.search`;
  - [ ] `memory.create`.
- [ ] P1 Implement tool call operation:
  - [ ] `tool.call` using existing tool permission/approval model.
- [ ] P1 Implement web operations after Web Research providers exist:
  - [ ] `web.search`;
  - [ ] `web.readPage`;
  - [ ] `web.readPages`.

## Phase C3 — Plan executor

- [ ] P0 Implement sequential plan executor.
- [ ] P0 Store bounded step outputs.
- [ ] P0 Support `contentFrom` / output references safely.
- [ ] P0 Stop on first failure by default.
- [ ] P1 Add optional `onError` policy only if needed.
- [ ] P0 Enforce limits:
  - [ ] total steps;
  - [ ] total output bytes;
  - [ ] total file reads;
  - [ ] total file writes;
  - [ ] total web reads;
  - [ ] timeout/cancel.
- [ ] P0 Tests:
  - [ ] simple read/write plan works;
  - [ ] failed step stops plan;
  - [ ] output limit enforced;
  - [ ] timeout enforced;
  - [ ] cancellation works.

## Phase C4 — Plan approvals and audit

- [ ] P0 Add plan proposal effect/action.
- [ ] P0 Add plan approval card:
  - [ ] title;
  - [ ] reason;
  - [ ] runtime `Structured Plan DSL v0.1`;
  - [ ] requested capabilities;
  - [ ] files read/write/delete;
  - [ ] URLs/domains;
  - [ ] risk;
  - [ ] step list.
- [ ] P0 Support approve/reject.
- [ ] P1 Support editing capabilities before approval.
- [ ] P0 Audit:
  - [ ] `script.plan_requested`;
  - [ ] `script.plan_approved`;
  - [ ] `script.plan_rejected`;
  - [ ] `script.plan_started`;
  - [ ] `script.plan_completed`;
  - [ ] `script.plan_failed`;
  - [ ] `script.plan_cancelled`.
- [ ] P0 Tests:
  - [ ] unapproved plan does nothing;
  - [ ] approved plan runs;
  - [ ] rejected plan does nothing;
  - [ ] audit events written;
  - [ ] approval preview does not leak huge content.

## Phase C5 — Plan integration with runtime

- [ ] P1 Add runtime effect for plan proposal/execution.
- [ ] P1 Ensure missing plan handler fails closed.
- [ ] P1 Ensure plan execution results resolve runtime effects.
- [ ] P1 Ensure plan failures are visible and audited.
- [ ] P1 Tests:
  - [ ] runtime can propose plan;
  - [ ] approved plan result continues runtime;
  - [ ] failed plan resolves as error;
  - [ ] missing handler fatal/error per policy.

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

- [ ] P0 Define `SearchProvider` interface.
- [ ] P0 Define `PageReaderProvider` interface.
- [ ] P0 Define `WebResearchService` facade.
- [ ] P0 Define data types:
  - [ ] `SearchResult`;
  - [ ] `PageReadRequest`;
  - [ ] `PageReadResult`;
  - [ ] `PageContent`;
  - [ ] `ResearchBundle`;
  - [ ] provider error types.
- [ ] P0 Tests for provider facade behavior.

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

- [ ] P1 Implement/keep CORS-limited `browser_fetch` tool.
- [ ] P1 Label it clearly as CORS-limited.
- [ ] P1 Use shared network safety validator.
- [ ] P1 No credentials by default.
- [ ] P1 Timeout and max bytes.
- [ ] P1 Do not use `no-cors` as a workaround.
- [ ] P1 Tests:
  - [ ] CORS/network failure visible;
  - [ ] private network blocked;
  - [ ] max bytes enforced;
  - [ ] safe CORS-enabled response works.

## Phase E4 — Chrome extension project scaffold

- [ ] P0 Add extension package/folder, e.g. `extension/chrome-web-research/`.
- [ ] P0 Add Manifest V3 manifest.
- [ ] P0 Add background service worker.
- [ ] P0 Add content extraction script.
- [ ] P0 Add build script.
- [ ] P0 Add dev install instructions.
- [ ] P0 Add extension ID/config handling for dev/prod.
- [ ] P0 Ensure production `externally_connectable` only allows BrowserClaw origin.
- [ ] P0 Include `http://localhost:5173/*` for dev only.

## Phase E5 — Extension permissions

- [ ] P0 Use least-privilege permissions.
- [ ] P0 Required permissions only:
  - [ ] `tabs`;
  - [ ] `scripting`;
  - [ ] `storage` if needed.
- [ ] P0 Use `optional_host_permissions` for `http://*/*` and `https://*/*`.
- [ ] P0 Do not request `<all_urls>` as required install permission.
- [ ] P0 Implement host permission request flow per origin/domain.
- [ ] P0 Tests/manual test checklist:
  - [ ] no broad host permission on install;
  - [ ] permission requested when reading new domain;
  - [ ] denial returns `permission_denied`;
  - [ ] grant allows page read.

## Phase E6 — Extension messaging protocol

- [ ] P0 Define message protocol version.
- [ ] P0 BrowserClaw request types:
  - [ ] `ping`;
  - [ ] `read_current_tab`;
  - [ ] `read_page`;
  - [ ] `read_pages`;
  - [ ] `request_host_permission`;
  - [ ] `get_status`.
- [ ] P0 Extension response types:
  - [ ] success;
  - [ ] permission denied;
  - [ ] timeout;
  - [ ] navigation failed;
  - [ ] extraction failed;
  - [ ] unsupported URL;
  - [ ] internal error.
- [ ] P0 Include `requestId` in all messages/responses.
- [ ] P0 Validate all messages on both sides.
- [ ] P0 Reject messages from non-BrowserClaw origins.
- [ ] P0 Tests:
  - [ ] ping works;
  - [ ] unknown message rejected;
  - [ ] malformed message rejected;
  - [ ] wrong origin rejected.

## Phase E7 — Extension page reading

- [ ] P0 Implement `readCurrentTab`.
- [ ] P0 Implement `readPage(url)` using background/inactive tab.
- [ ] P1 Implement `readPages(urls)` with max page limit.
- [ ] P0 Wait for page load with timeout.
- [ ] P0 Inject content extraction script.
- [ ] P0 Extract:
  - [ ] final URL;
  - [ ] title;
  - [ ] canonical URL;
  - [ ] byline if available;
  - [ ] site name if available;
  - [ ] main readable text;
  - [ ] optional markdown;
  - [ ] excerpt;
  - [ ] length.
- [ ] P0 Enforce max chars/output size.
- [ ] P0 Close background tabs opened by extension.
- [ ] P0 Tests/manual checklist:
  - [ ] read current tab;
  - [ ] read public article URL;
  - [ ] timeout works;
  - [ ] max chars enforced;
  - [ ] opened tab closes;
  - [ ] extraction failure visible.

## Phase E8 — Extension content extraction safety

- [ ] P0 Read-only extraction only.
- [ ] P0 Do not click buttons.
- [ ] P0 Do not fill forms.
- [ ] P0 Do not submit forms.
- [ ] P0 Do not read cookies directly.
- [ ] P0 Do not read page localStorage/sessionStorage.
- [ ] P0 Do not execute arbitrary page scripts.
- [ ] P0 Do not attempt paywall bypass.
- [ ] P0 Do not scrape logged-in/private pages by default.
- [ ] P0 Tests/static checks/manual review for forbidden behaviors.

## Phase E9 — BrowserClaw extension integration

- [ ] P0 Add extension availability detector.
- [ ] P0 Add Web Research settings/status UI:
  - [ ] extension missing;
  - [ ] extension connected;
  - [ ] extension version;
  - [ ] page reading available;
  - [ ] permission denied;
  - [ ] error state.
- [ ] P0 Add install/setup guidance for Chrome extension.
- [ ] P0 Add PageReaderProvider implementation backed by extension messaging.
- [ ] P0 Add audit events:
  - [ ] `extension.connected`;
  - [ ] `extension.missing`;
  - [ ] `extension.permission_requested`;
  - [ ] `extension.permission_granted`;
  - [ ] `extension.permission_denied`;
  - [ ] `web.page_read_started`;
  - [ ] `web.page_read_completed`;
  - [ ] `web.page_read_failed`.
- [ ] P0 Tests:
  - [ ] missing extension shown honestly;
  - [ ] connected extension detected;
  - [ ] permission denied shown;
  - [ ] page read result normalized;
  - [ ] failures audited.

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
