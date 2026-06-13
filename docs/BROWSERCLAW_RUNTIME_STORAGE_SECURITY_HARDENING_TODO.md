# BrowserClaw Runtime, Storage, Provider, Skills, and Security Hardening TODO

## Phase 0 — Ground Rules and Regression Guardrails

- [x] Add a `HARDENING_NOTES.md` or update existing docs explaining: <!-- HARDENING_NOTES.md at repo root -->
  - [x] no silent fallbacks;
  - [x] no no-op effect handlers;
  - [x] no implicit mock provider;
  - [x] no fake seeded audit/memory data outside explicit demo mode;
  - [x] no decrypted secrets in Redux/logs/audit.
- [x] Add an app-wide `isDemoMode`/`isDevFallbackAllowed` configuration policy. <!-- src/config/appConfig.ts: AppConfig { isDemoMode, isDevFallbackAllowed, isMockProviderAllowed, isSafetyOverrideActive }, parseAppConfig(import.meta.env) -->
- [x] Ensure production/default builds have:
  - [x] demo mode disabled; <!-- VITE_DEMO_MODE off unless exactly 'true' -->
  - [x] reference runtime fallback disabled; <!-- isDevFallbackAllowed = isDemoMode || VITE_ALLOW_REFERENCE_RUNTIME_FALLBACK -->
  - [x] mock provider fallback disabled. <!-- isMockProviderAllowed = isDemoMode || VITE_ALLOW_MOCK_PROVIDER -->
- [x] Add a visible developer/demo banner when any demo/fallback mode is enabled. <!-- src/components/shell/SafetyOverrideBanner.tsx, mounted in AppLayout; null unless isSafetyOverrideActive -->
- [x] Add tests proving default mode fails closed. <!-- appConfig.test.ts "an empty env disables every override" / "a production-like env... stays fail closed" / "treats any non-'true' value as off" -->


## Phase 1 — Remove Unsafe Runtime Fallbacks

### 1.1 WASM Runtime Startup

- [x] Replace silent WASM-to-reference fallback in runtime startup. <!-- runtimeBoot.ts loadRuntimePort: WASM failure with dev flag off returns { port:null, mode:null }, never createReference -->
- [x] Default behavior:
  - [x] try to load WASM runtime; <!-- deps.createWasm(snapshot) -->
  - [x] on success, dispatch runtime loaded; <!-- main.tsx onLoaded -> runtimeLoaded({ mode }) -->
  - [x] on failure, dispatch runtime error; <!-- main.tsx onFailed -> runtimeFailed (status 'error', fatal true) -->
  - [x] on failure, append durable audit event; <!-- appendAudit('runtime.load_failed', ...) -> recordAudit -> db.audit_events -->
  - [x] on failure, show blocking UI error. <!-- AppLayout: if runtimeFatal return <RuntimeBlockedScreen /> -->
- [x] Add explicit dev flag:
  - [x] `VITE_ALLOW_REFERENCE_RUNTIME_FALLBACK=true`. <!-- appConfig.ts isDevFallbackAllowed = isDemoMode || VITE_ALLOW_REFERENCE_RUNTIME_FALLBACK -->
- [x] If dev fallback is enabled:
  - [x] show persistent warning banner; <!-- SafetyOverrideBanner lists "reference-runtime fallback" -->
  - [x] set runtime mode to `reference`; <!-- onFallback -> runtimeLoaded({ mode:'reference' }) -->
  - [x] append `runtime.reference_fallback_used` audit event. <!-- main.tsx appendAudit('runtime.reference_fallback_used', ...) -->
- [x] Tests:
  - [x] WASM load failure blocks in default mode. <!-- runtimeBoot.test "fails closed (no fallback) when WASM fails and the dev flag is off" + RuntimeBlockedScreen.test -->
  - [x] WASM load failure uses reference runtime only with explicit flag. <!-- runtimeBoot.test "uses the reference runtime only when the dev flag is on" + appConfig.test -->
  - [x] UI displays the correct runtime mode. <!-- Pass 25: SettingsScreen.test "shows the actual runtime mode, not a hardcoded label" (ready (wasm) vs ready (reference)) -->


### 1.2 Remove No-Op Effect Ports

- [ ] Refactor effect executor so missing ports are fatal.
- [ ] Require handlers for:
  - [ ] `llm_request`;
  - [ ] `storage_get`;
  - [ ] `storage_put`;
  - [ ] `storage_search`;
  - [ ] `skill_fs_read_text`;
  - [ ] `skill_state_get`;
  - [ ] `skill_state_put`;
  - [ ] `audit_append`;
  - [ ] `runtime_snapshot_save`.
- [ ] Unknown effect types must fail.
- [ ] Missing handlers must fail.
- [ ] Every effect failure must:
  - [ ] dispatch runtime error or effect error;
  - [ ] append durable audit event;
  - [ ] show user-visible error state.
- [ ] Tests:
  - [ ] missing storage handler fails;
  - [ ] missing skill handler fails;
  - [ ] unknown effect fails;
  - [ ] failure is audited.

## Phase 2 — Provider Configuration and SecretVault Wiring

### 2.1 Provider Profiles

- [x] Define durable `ProviderProfile` type.
- [x] Store provider profiles in IndexedDB.
- [x] Add profile CRUD service:
  - [x] create;
  - [x] update;
  - [x] delete;
  - [x] list;
  - [x] set active;
  - [x] get active.
- [x] Make Models screen read provider profiles from IndexedDB.
- [x] Make Models screen edits persist to IndexedDB.
- [x] Make provider tests use persisted profile values.
- [x] Update top status bar to show actual active provider/model.
- [x] Tests:
  - [x] edited base URL persists after reload;
  - [x] edited model persists after reload;
  - [x] provider test uses edited values.

### 2.2 Remove Implicit Mock Provider

- [x] Change provider resolver: <!-- providers/registry.ts resolveProvider switch fails closed -->
  - [x] unknown provider ID returns error; <!-- default case -> { ok:false, reason:'unknown_provider' } -->
  - [x] no provider returns setup-required error; <!-- case null -> { ok:false, reason:'not_configured' } -->
  - [x] mock provider works only when explicitly configured. <!-- case 'mock' gated on config.isMockProviderAllowed -->
- [x] Update tests that currently expect unknown provider to resolve to mock. <!-- providers.test "does NOT fall back to mock for null or unknown ids" -->
- [x] Chat must block when no provider is configured. <!-- ChatScreen disables composer via providerReady=isProviderConfigured(activeId, mockAllowed) -->
- [x] UI must show setup CTA when no provider is configured. <!-- ChatScreen renders "No provider configured" + data-testid="chat-setup-cta" href /models -->
- [x] Tests:
  - [x] unknown provider fails; <!-- providers.test registry "does NOT fall back to mock for null or unknown ids" -->
  - [x] no provider blocks chat; <!-- ChatScreen.test "blocks chat with a setup CTA when no provider is configured" -->
  - [x] explicit mock provider still works in demo/dev mode. <!-- providers.test "resolves the mock only when explicitly allowed" (mockOn) -->


### 2.3 SecretVault Provider Integration

- [x] Add provider secret reference support.
- [x] Add UI for: <!-- /security SecurityScreen (Pass 20 lock lifecycle + Pass 21 per-provider key CRUD). -->
  - [x] session-only API key; <!-- pick provider -> setSessionSecret('provider:${id}'); profile.apiKeyMode='session' -->
  - [x] encrypted stored API key; <!-- Storage=Encrypted (when canStoreEncrypted) -> putEncryptedSecret; profile.apiKeyMode='encrypted' + encryptedSecretId -->
  - [x] delete key; <!-- per-key Delete -> removeSecret; profile.apiKeyMode left intact so a later call fails closed -->
  - [x] lock; <!-- SecurityScreen "Lock" -> secretVault.lock() -->
  - [x] unlock. <!-- SecurityScreen setup (first run) / unlock (passphrase) + session-only; wrong passphrase fails closed -->
- [x] Provider test flow must retrieve key from SecretVault.
- [x] Runtime LLM flow must retrieve key from SecretVault.
- [x] Locked key must produce `secret_locked`.
- [x] Missing key must produce `secret_missing`.
- [x] Secret prompts must not leak key text. <!-- key input is type=password; SecurityScreen.test asserts the raw key is absent from the DOM and from Redux metadata -->
- [x] Tests:
  - [x] raw API key absent from Redux;
  - [x] raw API key absent from audit payloads;
  - [x] locked key blocks provider call;
  - [x] unlocked key allows provider call;
  - [x] deleting key prevents future provider call. <!-- providerKey.test: real vault store+remove -> resolveApiKey flips ok -> secret_missing -->

### 2.4 Provider Error Handling

- [x] Replace provider-error-as-assistant-message behavior. <!-- llmRunner.ts complete() catch returns early (resolve_effect ok:false) and never writes an assistant message -->
- [x] Add normalized provider error shape. <!-- ProviderError { kind: cors|auth|model_not_found|unreachable|unknown } in providers/errors.ts -->
- [x] Runtime must receive provider failures as effect errors. <!-- llmRunner submits { type:'resolve_effect', result:{ ok:false, error } } -->
- [x] Chat must show error card, not fake assistant response. <!-- ChatScreen renders data-testid="chat-error" ErrorState from state.chat.error -->
- [x] Audit must record provider failure. <!-- recordAudit type 'provider.request_failed', source 'provider', status 'failure' -->
- [x] Add CORS/possible-CORS classification. <!-- Pass 22: classifyFetchFailure() maps cross-origin fetch throws to 'cors', same-origin/non-browser to 'unreachable'; threaded through fetchOrThrow(url, run) -->
- [x] Tests:
  - [x] network failure produces provider error card; <!-- ChatScreen.test "shows a provider error card, not a fake assistant reply"; providers.test cross-origin->cors -->
  - [x] auth failure produces auth error; <!-- providers.test "maps a 401 to an auth error" -->
  - [x] model-not-found produces model error; <!-- providers.test error-mapping httpStatusToKind(404)=model_not_found -->
  - [x] provider failure does not create normal assistant message. <!-- llmRunner.test "surfaces a provider failure as an error, never a fake reply" + ChatScreen.test -->


## Phase 3 — Durable Audit Log

### 3.1 Audit Service

- [x] Implement durable audit service backed by IndexedDB. <!-- src/audit/auditService.ts + auditSink.ts write to db.audit_events (Dexie); AuditScreen reads from the durable table -->
- [x] Add APIs:
  - [x] `appendAuditEvent`; <!-- auditService.ts:130 -->
  - [x] `queryAuditEvents`; <!-- auditService.ts:140 (type/risk/source/status/limit) -->
  - [x] `getAuditEvent`; <!-- auditService.ts:157 -->
  - [x] `exportAuditCsv`. <!-- auditService.ts:191; auditEventsToCsv never emits `details` -->
- [x] Enforce sensitive data redaction. <!-- redactDetails() strips credential-like keys at any depth; auditService.ts:56 -->
- [x] Add source/status/risk fields. <!-- AuditEventRow in db/types.ts:146; AuditSource/AuditStatus/AuditRiskLevel -->
- [x] Add schema migration if needed. <!-- db.ts v3 adds source/status indices + backfillAuditDefaults() backfill -->
- [x] Tests:
  - [x] audit events persist after reload; <!-- auditService.test.ts reads back from durable table; effectExecutor.test.ts asserts durable persistence -->
  - [x] audit events query by type; <!-- auditService.test.ts queryAuditEvents type filter -->
  - [x] audit events query by risk; <!-- auditService.test.ts queryAuditEvents risk filter -->
  - [x] audit CSV exports real durable events. <!-- auditService.test.ts exportAuditCsv from durable rows, escaping, no details -->

<!-- NOTE: appendAuditEvent (auditService) is durable-only; recordAudit (auditSink) does Redux live-tail + durable put. -->


### 3.2 Remove Fake Audit Seeding

- [x] Remove fake audit seeding from Audit screen. <!-- AuditScreen.tsx reads db.audit_events via useLiveQuery only; no seed path. db.ts populate() seeds ONLY app_settings.schemaVersion — never audit rows. Verified by Explore against source. -->
- [x] Replace with empty state. <!-- AuditScreen shows "No audit events." when the durable table is empty -->
- [ ] If demo data is desired:
  - [ ] gate behind explicit demo mode;
  - [ ] mark records as demo; <!-- AuditEventRow.demo flag + buildAuditRow honor it, but no demo seeding path is wired (intentionally unused) -->
  - [ ] show demo banner.
- [ ] Tests:
  - [x] empty DB shows empty audit state; <!-- AuditScreen.test.tsx "shows an empty state when there are no events" -->
  - [ ] fake audit is not inserted in default mode; <!-- partial: db.test.ts asserts only schemaVersion is seeded; no explicit "audit_events empty after boot" assertion yet -->
  - [ ] demo mode marks seeded events as demo. <!-- not implemented: no demo audit seeding exists to mark -->

<!-- 3.2 status: the dishonesty risk (fake seeded audit) does not exist in source — the screen was built clean. Demo-mode subitems are deliberately unimplemented; mark this fully resolved only if demo seeding is ever added. -->


### 3.3 Wire Audit Events Across App

- [ ] Append audit events for:
  - [x] runtime loaded; <!-- main.tsx:119 'runtime.loaded' -->
  - [x] runtime failed; <!-- main.tsx:142 'runtime.load_failed' -->
  - [x] fallback runtime used; <!-- main.tsx:131 'runtime.reference_fallback_used' -->
  - [x] provider test success/failure; <!-- ModelsScreen.tsx handleTest: 'provider.test_succeeded' / 'provider.test_failed' (incl. unresolvable provider); ModelsScreen.test.tsx durable-audit tests -->
  - [x] LLM request start/success/failure; <!-- referenceRuntime.ts 'llm_request_sent'/'llm_response_received'/'llm_request_failed'; llmRunner.ts 'provider.request_failed' -->
  - [ ] effect emitted/resolved/failed; <!-- partial: audit_append effect routes durably (effectExecutor); generic effect lifecycle events not yet wired — tied to effect-port contract (Phase 1.2, blocked) -->
  - [ ] tool proposed/approved/rejected/edited; <!-- not wired; depends on tool effect ports (Phase 7.4, contract-blocked) -->
  - [ ] memory created/updated/deleted; <!-- not wired in app code (memory_created appears only as a test fixture) -->
  - [ ] skill installed/enabled/disabled/import failed; <!-- partial: skillManager.ts 'skill_import_failed' + skillRunner.ts 'skill.permission_denied'; install/enable/disable not wired -->
  - [ ] secret unlocked/locked/deleted; <!-- not wired -->
  - [ ] backup export/import success/failure; <!-- partial: backupService.ts 'backup.exported'/'backup.export_failed'; import path not wired -->
  - [x] model download/load/delete success/failure; <!-- modelManager.ts emits source:'model' audit events: model.download_succeeded/_failed, model.loaded/.load_failed, model.deleted/.delete_failed (modelId only, no URLs/secrets); wllama.test.ts asserts durable rows + no 'huggingface' leak -->
- [x] Ensure no raw secrets or large content bodies are recorded. <!-- redactDetails() in auditService.ts; provider/runtime audit summaries carry ids + verdicts only, never keys or message bodies; guardrail in ModelsScreen.test asserts no 'sk-' in the row -->

<!-- 3.3 status: core runtime/provider/LLM/model events wired + secret-safe. Remaining items (effect/tool/memory/skill-lifecycle/secret/backup-import) are partial or blocked on the effect-port contract (Phase 1.2/7.4) — wire incrementally as those land. -->


## Phase 4 — Runtime Snapshot Persistence

- [x] Add snapshot persistence to normal runtime flow. <!-- RuntimeHost owns a SnapshotScheduler (debounced save) wired in main.tsx bootRuntime; loadLatestSnapshot restores on boot -->
- [ ] Save snapshot:
  - [x] after user message accepted; <!-- RuntimeHost.submit() schedules a coalesced save after the turn settles (runtimeHost.ts) -->
  - [ ] after each effect emitted; <!-- not wired: saves once per turn, not per effect — tied to effect-port lifecycle (Phase 1.2, contract-blocked) -->
  - [ ] after each effect resolved; <!-- not wired (same as above) -->
  - [ ] after runtime enters idle; <!-- reference runtime has no idle/error state machine to hook -->
  - [ ] after runtime enters error;
  - [x] before unload when possible. <!-- main.tsx 'pagehide' listener -> host.flushSnapshot() -->
- [x] Add snapshot compatibility check. <!-- SNAPSHOT_SCHEMA_VERSION (referenceRuntime.ts) stamped on every write (runtimeHost.saveSnapshot + effectExecutor); loadLatestSnapshot gates on version and discards mismatches -->
- [x] Add corrupted snapshot handling. <!-- main.tsx withSnapshotRestore() try/catch -> start fresh + audit; loadLatestSnapshot drops incompatible/unversioned rows so they can't retry forever -->
- [x] Add visible restore warning if snapshot incompatible/corrupted. <!-- runtimeSlice.snapshotIssue ('incompatible'|'restore_failed') set at boot (main.tsx) before runtimeLoaded (which deliberately doesn't clear it); SnapshotRestoreBanner (dismissible, role=alert) rendered in AppLayout; runtimeReset/dismiss clear it -->
- [ ] Add audit events:
  - [ ] snapshot saved; <!-- intentionally omitted: a per-turn save audit would spam the log; revisit if a discrete save signal is wanted -->
  - [x] snapshot restore success; <!-- main.tsx 'runtime.snapshot_restored' -->
  - [x] snapshot restore failed; <!-- main.tsx 'runtime.snapshot_restore_failed' (+ 'runtime.snapshot_save_failed' for save errors) -->
  - [x] snapshot incompatible; <!-- main.tsx 'runtime.snapshot_incompatible' on a version mismatch (this pass) -->
- [ ] Tests:
  - [x] reload restores runtime state; <!-- runtimeHost.test.ts "persists and restores a snapshot deterministically"; referenceRuntime.test.ts restore -->
  - [x] corrupted snapshot does not crash silently; <!-- runtimeHost.test.ts discards incompatible + pre-versioning snapshots; withSnapshotRestore catches deserialize throws -->
  - [x] incompatible snapshot is audited. <!-- main.tsx emits 'runtime.snapshot_incompatible'; runtimeHost.test.ts asserts the load reports 'incompatible' + drops the row -->

<!-- Phase 4 status: core save/restore + compatibility gate + corruption handling + audit + VISIBLE restore warning all wired. Remaining: per-effect/idle/error save triggers (blocked on the effect-port contract, Phase 1.2) and the deliberately-omitted per-turn 'snapshot_saved' audit. -->


## Phase 5 — Storage Effects and Memory Hardening

### 5.1 Storage Effect Handlers

- [ ] Implement real handlers for:
  - [ ] `storage_get`;
  - [ ] `storage_put`;
  - [ ] `storage_search`.
- [ ] Validate collection names.
- [ ] Validate row shape per collection.
- [ ] Reject unknown collections.
- [ ] Audit storage failures.
- [ ] Tests:
  - [ ] storage_put persists valid record;
  - [ ] storage_put rejects unknown collection;
  - [ ] storage_search returns expected records;
  - [ ] invalid storage effect is audited.

### 5.2 Remove Fake Memory Seeding

<!-- Implemented across earlier passes; boxes reconciled in Pass 19 with the
     missing guardrail test added. Seeding is gated by appConfig.isDemoMode
     (MemoriesScreen.tsx ~L50), which defaults false (appConfig.ts; only
     VITE_DEMO_MODE=true enables it). A one-time v4 migration (db.ts ~L108)
     deletes only UNTOUCHED prior seeds via isUnmodifiedSampleMemory(). -->
- [x] Remove fake memory seeding from Memories screen.
- [x] Add empty memory state. <!-- EmptyState: "No memories yet." vs "No memories match the current filters." -->
- [x] Gate demo memories behind explicit demo mode if needed.
- [x] Mark demo memories as demo. <!-- SAMPLE_MEMORIES all carry demo:true (sampleMemories.test.ts) + "Demo" Badge in the UI -->
- [x] Tests:
  - [x] empty DB shows empty state; <!-- MemoriesScreen.test.tsx: "a fresh non-demo DB shows the empty state and seeds nothing" -->
  - [x] fake memories are not inserted by default. <!-- same test asserts db.memories.count() === 0 after render -->

### 5.3 Complete Memory Filters and Provenance

<!-- Filters are now pure + wired: src/memories/filterMemories.ts (filterMemories
     + deriveMemoryFacets), state in memoriesSlice, applied in MemoriesScreen.
     The old Sensitivity <Select> was a decorative no-op (no onChange) — now real. -->
- [x] Implement tag filter.
- [x] Implement source filter.
- [x] Implement created-by filter.
- [x] Implement sensitivity filter.
- [x] Implement pinned filter if UI exposes it. <!-- "Pinned only" checkbox -->
- [ ] Persist provenance:
  - [ ] source conversation ID; <!-- BLOCKED: no memory-write pipeline exists yet (no runtime/effect path creates memories), so there is no writer to populate conversation/message/skill provenance. MemoryRow already persists source/createdBy/createdAt/lastUsedAt via Dexie; the conversation/message/skill-source fields need a memory-creation effect first (same class of gap as 5.1 storage handlers / 7.4 tool-execution — needs a claw-schema/WASM contract addition). Adding unwritten fields now would be speculative. -->
  - [ ] source message ID;
  - [x] created by; <!-- already persisted on MemoryRow -->
  - [ ] skill/tool source;
  - [x] created at; <!-- already persisted on MemoryRow -->
  - [x] last used at. <!-- field persists; not yet *written* by a real retrieval (see below) -->
- [ ] Implement retrieval history based on real retrieval events. <!-- BLOCKED: no memory-retrieval pipeline exists. lastUsedAt is never written by any real code path (grep confirms only demo seeds set it), so the "Recently used"/"Retrieval history" panels are correctly EMPTY in a normal build (honest-when-empty) and only show demo seed data in demo mode. Wiring real retrieval needs the runtime memory-read effect first. -->
- [ ] Tests:
  - [x] each filter works; <!-- filterMemories.test.ts (unit, per-filter + AND) + MemoriesScreen.test.tsx (wired created-by filter + clear) -->
  - [ ] provenance persists after reload; <!-- blocked with provenance writer above -->
  - [ ] retrieval history records real retrieval. <!-- blocked with retrieval pipeline above -->

## Phase 6 — Backup / Restore Hardening

### 6.1 Backup Format and Validation

- [x] Define backup manifest schema.
- [x] Define allowed backup collections.
- [x] Define row validators for every importable collection. <!-- KEY_FIELDS: app_settings[key], skill_files[skillId,path], skill_state[skillId,key], else [id]; every row must be a plain object with non-empty string key fields. -->
- [x] Enforce schema version compatibility. <!-- reject schemaVersion > DB_VERSION or non-numeric; older accepted (Dexie migrates). -->
- [x] Enforce record count limits.
- [x] Enforce record size limits.
- [x] Enforce total import size limit.
- [x] Reject unknown collections.
- [x] Reject malformed rows.
- [x] Reject backups containing likely raw decrypted secrets. <!-- containsLikelyRawSecret: plaintext-secret field names (excludes apiKeyMode/encryptedSecretId) + credential-shaped values (sk-/sk-ant-/AKIA/ghp_/ya29./JWT/xox). -->
- [x] Tests:
  - [x] unknown collection rejected;
  - [x] malformed collection rejected;
  - [x] invalid row rejected;
  - [x] unsupported version rejected;
  - [x] oversized backup rejected.

### 6.2 Transactional Import

- [x] Implement import preview. <!-- StorageScreen restore Dialog shows the validated summary before any write. -->
- [ ] Show:
  - [x] collections;
  - [x] record counts;
  - [ ] conflicts; <!-- DEFERRED: per-record id-collision counts need reading existing keys per collection; preview shows counts + secrets presence today. -->
  - [x] encrypted secrets present or absent;
  - [ ] model references; <!-- DEFERRED with conflicts: model_catalog/model_cache_index counts already listed; a dedicated "references" callout pending. -->
- [x] Require explicit import confirmation.
- [x] Implement merge strategy.
- [x] Implement replace strategy.
- [x] Run import in transaction. <!-- importBackup wraps all collections in one Dexie 'rw' transaction. -->
- [x] Roll back on failure.
- [x] Tests:
  - [x] failed import leaves DB unchanged;
  - [x] merge preserves non-conflicting records;
  - [x] replace clears selected collections only.

### 6.3 Backup Export Accuracy

- [x] Record backup history only after export actually succeeds. <!-- runBackupExport records history + success audit ONLY after deps.download() returns; StorageScreen throws if createObjectURL is missing. -->
- [x] If browser download/createObjectURL fails:
  - [x] show error;
  - [x] audit failure;
  - [x] do not record success.
- [x] Label plaintext exports clearly. <!-- warning line on StorageScreen + audit summary says "plaintext" vs "includes encrypted secrets". -->
- [ ] Add optional encrypted backup export if claiming encryption. <!-- DEFERRED: current export is labeled plaintext (not claiming encryption); a fully-encrypted .clawbackup needs a passphrase-KDF flow — separate task. -->
- [x] Tests:
  - [x] export success records history;
  - [x] export failure does not record success;
  - [ ] encrypted export can be imported if implemented. <!-- deferred with encrypted export above -->


## Phase 7 — Skills and Skill Filesystem Hardening

### 7.1 Strict Skill Import

- [x] Reject `SKILL.md` missing required frontmatter:
  - [x] `name`;
  - [x] `description`;
  - [x] `version`.
- [x] Validate skill name.
- [x] Validate version.
- [x] Validate permissions.
- [x] Reject unknown permission fields unless explicitly allowed.
- [x] Imported skills start disabled unless user enables them.
- [ ] Show permission review before install. <!-- needs skills import UI -->
- [x] Tests:
  - [x] missing name rejected;
  - [x] missing description rejected;
  - [x] invalid name rejected;
  - [x] unknown permission rejected;
  - [x] imported skill disabled by default.

### 7.2 Skill Filesystem Safety

- [ ] Ensure package files are read-only. <!-- needs a package-file flag; later -->
- [x] Ensure mutable state is private per skill.
- [x] Move permissions out of mutable skill state.
- [x] Add reserved state keys:
  - [x] `__permissions__`;
  - [x] `__manifest__`;
  - [x] `__system__`;
  - [x] `__audit__`;
  - [x] `__secrets__`.
- [x] Reject writes to reserved keys.
- [x] Harden path validation:
  - [x] reject `..`;
  - [x] reject encoded traversal;
  - [x] reject absolute paths;
  - [x] reject null bytes;
  - [x] reject backslash traversal;
  - [x] normalize paths before checking.
- [x] Tests:
  - [x] traversal rejected;
  - [x] encoded traversal rejected;
  - [x] absolute path rejected;
  - [x] reserved key write rejected;
  - [x] skill cannot mutate permissions.

### 7.3 Skill Install/Reinstall/Enable

- [x] On reinstall, remove stale package files.
- [x] Ask whether to preserve or clear skill state on reinstall. <!-- install() takes { clearState? }; default preserves, refreshes __permissions__. UI surfacing of the choice deferred until a reinstall flow exists. -->
- [x] Enable/disable must fail if skill does not exist.
- [x] Audit only successful enable/disable as success.
- [x] Audit failures as failures.
- [x] Tests:
  - [x] stale files removed on reinstall;
  - [x] missing skill enable fails;
  - [x] missing skill disable fails;
  - [x] failed enable does not audit success.

### 7.4 Runtime Permission Enforcement

- [ ] Enforce skill permissions during tool execution. <!-- BLOCKED: the tool_call_proposal effect carries no skill_id (effectTypes.ts), so the runtime tool path can't be tied to a skill's declared tools yet. Needs a claw-schema/WASM contract change to add skill_id, like the 5.1 storage-handler gap. -->
- [x] Enforce skill filesystem permissions during reads/writes. <!-- skillRunner.ts routes skill_fs_read_text/skill_state_get/skill_state_put through the permission-scoped SkillFs; wired as ctx.ports.skill in main.tsx (was an unwired no-op). -->
- [x] Do not rely only on UI display. <!-- enforcement lives in SkillFs/skillRunner data layer; disabled/unknown skills fail closed. -->
- [ ] Tests:
  - [ ] skill cannot call undeclared tool; <!-- deferred with the tool-execution bullet above -->
  - [x] skill cannot read undeclared path;
  - [x] skill cannot write undeclared state path;
  - [x] permission denial is audited.

## Phase 8 — wllama and Local Model Hardening

### 8.1 wllama Runtime Assets

- [ ] Stop silently loading wllama WASM from CDN by default.
- [ ] Choose one:
  - [ ] bundle/vendor wllama runtime asset; or
  - [ ] pin exact version and verify integrity; or
  - [ ] require explicit user consent for CDN loading.
- [ ] Add offline/runtime availability status.
- [ ] Audit wllama runtime load success/failure.
- [ ] Tests:
  - [ ] wllama unavailable state shown;
  - [ ] CDN use is explicit if retained;
  - [ ] load failure is visible and audited.

### 8.2 Model Download Manager

- [ ] Implement real model download queue state.
- [ ] Implement accurate progress.
- [ ] Implement cancel.
- [ ] Implement pause only if truly supported; otherwise disable UI.
- [ ] Check storage quota before download.
- [ ] Handle quota failure during download.
- [ ] Avoid corrupt cache metadata on failed download.
- [ ] Delete cache removes actual cached data and metadata.
- [ ] Load/unload status must reflect real engine state.
- [ ] Tests:
  - [ ] quota preflight blocks too-large model;
  - [ ] failed download does not mark model cached;
  - [ ] cancel updates state honestly;
  - [ ] delete cache removes cache record;
  - [ ] loaded status requires actual loaded model.

### 8.3 User Hugging Face Model Support

- [ ] Add form for user-provided Hugging Face GGUF repo/file.
- [ ] Validate URL/repo/file shape.
- [ ] Show size/license if discoverable.
- [ ] Warn when metadata cannot be fetched.
- [ ] Do not proxy model downloads through app server.
- [ ] Tests:
  - [ ] valid HF reference accepted;
  - [ ] invalid HF reference rejected;
  - [ ] download URL points to HF, not app server.

## Phase 9 — Onboarding, Settings, and Models UI Persistence

### 9.1 Onboarding

- [x] Persist onboarding completion. <!-- OnboardingScreen.finish() -> setOnboardingComplete(db,true) writes app_settings['onboardingComplete']; src/settings/appSettings.ts getSetting/setSetting + getOnboardingComplete/setOnboardingComplete -->
- [ ] Persist selected inference mode. <!-- still local useState(mode); not yet written to app_settings -->
- [x] Persist selected active provider. <!-- OnboardingScreen.finish() remote branch calls setActiveProviderId(db, provider) so restoreActiveProvider picks it up after reload; OnboardingScreen.test "persists the remote provider selection durably" asserts getActiveProviderId(db) -->
- [ ] Persist storage persistence result. <!-- requestPersistentStorage updates Redux only; not persisted to app_settings -->
- [ ] Persist selected/default model.
- [x] On refresh, do not repeat onboarding if completed. <!-- main.tsx restoreOnboardingState() reads the flag at boot, dispatches onboardingCompleted() then hydrated(); IndexRedirect (index route) sends completed users to /chat, first-run to /onboarding; only the index route is gated so deep links are untouched -->
- [ ] If setup incomplete, resume correct step. <!-- step index is not persisted yet; incomplete onboarding restarts at step 0 -->
- [ ] Tests:
  - [x] onboarding completion persists; <!-- OnboardingScreen.test "finishes into chat" asserts getOnboardingComplete(db) is true after finish; appSettings.test round-trips; IndexRedirect.test covers the index-route decision -->
  - [ ] selected mode persists;
  - [ ] refresh resumes incomplete onboarding.

<!-- 9.1 status: completion + active provider now persist durably; completion drives the index route (first-run vs returning) via IndexRedirect + boot rehydrate (hydrated gate avoids a first-paint bounce). Remaining: persist storage-persistence result + step index (small app_settings writes). Inference mode is deliberately NOT persisted — nothing consumes it post-onboarding yet, so storing it would be a speculative/inert field (revisit when a consumer exists). -->

### 9.2 Settings

- [ ] Make Settings screen read from IndexedDB.
- [ ] Make Settings controls write to IndexedDB.
- [ ] Implement settings for:
  - [ ] theme;
  - [ ] default provider;
  - [ ] fallback provider;
  - [ ] lock timeout;
  - [ ] approval policy;
  - [ ] backup settings;
  - [ ] skill install policy;
  - [ ] developer/demo/fallback mode.
- [x] Settings button in top bar navigates to `/settings`. <!-- AppLayout.tsx now wires topBar.onOpenSettings to navigate('/settings'); previously a silent no-op because AppLayout never passed the prop to AppShell/TopStatusBar. -->
- [ ] Tests:
  - [ ] settings persist after reload;
  - [x] top bar Settings button navigates; <!-- AppLayout.test.tsx: clicking the top-bar Settings button lands on /settings. -->
  - [ ] approval policy affects approval behavior.

### 9.3 Models Screen

- [ ] Replace `defaultValue`-only fields with controlled persisted form state.
- [ ] Save provider profile edits.
- [ ] Fix provider health ID mapping.
- [ ] Provider health must reflect real provider test state.
- [ ] Disable unimplemented actions or mark them coming later.
- [ ] Tests:
  - [ ] profile form saves;
  - [ ] provider health ID mapping correct for `llama-server`;
  - [ ] unimplemented model actions disabled.

## Phase 10 — UI Honesty Pass

- [ ] Audit all visible buttons/actions.
- [ ] For each action:
  - [ ] implement it; or
  - [ ] disable it; or
  - [ ] mark it as coming later.
- [ ] Remove or gate fake/demo UI data.
- [ ] Add empty states for:
  - [ ] no providers;
  - [ ] no memories;
  - [ ] no audit events;
  - [ ] no skills;
  - [ ] no backups;
  - [ ] no downloaded models.
- [ ] Add error states for:
  - [ ] runtime failed;
  - [ ] storage unavailable;
  - [ ] provider missing;
  - [ ] secret locked;
  - [ ] model unavailable;
  - [ ] backup import failed;
  - [ ] skill import failed.
- [ ] Tests:
  - [ ] no-op buttons are absent/disabled;
  - [ ] empty states render honestly;
  - [ ] error states render visibly.

## Phase 11 — QA and Test Hardening

### 11.1 Remove Tests That Enshrine Bad Behavior

- [ ] Update tests expecting unknown provider to become mock.
- [ ] Update tests expecting mock response unless explicit mock provider selected.
- [ ] Remove tests that rely on fake seeded audit/memory data.
- [ ] Add negative tests for unsafe fallback behavior.

### 11.2 Add Security Regression Tests

- [ ] Raw API key not in Redux.
- [ ] Raw API key not in audit.
- [ ] Raw API key not in localStorage.
- [ ] Provider Authorization header not logged.
- [ ] Backup import rejects raw secret-looking fields if not encrypted.
- [ ] Skill cannot access reserved keys.
- [ ] Skill cannot path-traverse.
- [ ] Runtime cannot ignore missing handlers.

### 11.3 Add Integration Tests

- [ ] Onboarding -> provider setup -> chat.
- [ ] Provider failure -> visible error -> audit failure.
- [ ] Memory write approval -> memory persisted -> audit persisted.
- [ ] Backup export -> import preview -> restore.
- [ ] Skill import -> permission review -> enable -> audit.
- [ ] Reload -> runtime snapshot restored.
- [ ] wllama model download failure -> truthful model status.

### 11.4 Required Commands

- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm run test`
- [ ] `npm run test:e2e` if present
- [ ] `cargo test` for Rust crates if cargo workspace present
- [ ] `cargo clippy` if available
- [ ] Document any command that cannot run and why.

## Phase 12 — Acceptance Checklist

This hardening pass is complete only when all of these are true:

- [ ] App does not silently fall back from WASM runtime.
- [ ] App does not silently fall back to mock provider.
- [ ] Missing effect handlers fail visibly.
- [ ] Provider failures are not converted into assistant messages.
- [ ] Provider profiles persist and drive actual provider calls.
- [ ] SecretVault is wired into provider calls.
- [ ] No decrypted secrets enter Redux/logs/audit.
- [ ] Audit log is durable and truthful.
- [ ] Fake audit/memory seeding is removed or demo-gated.
- [ ] Runtime snapshots persist during normal flow.
- [ ] Backup import is allowlisted, validated, and transactional.
- [ ] Backup export history records only true success.
- [ ] Skills are strictly validated.
- [ ] Skill filesystem is path-safe and reserved-key-safe.
- [ ] Skill permissions are enforced at runtime.
- [ ] wllama status is truthful.
- [ ] Settings/onboarding/models changes persist after reload.
- [ ] All visible controls are functional, disabled, or marked future.
- [ ] Tests catch the unsafe behaviors identified in this review.

