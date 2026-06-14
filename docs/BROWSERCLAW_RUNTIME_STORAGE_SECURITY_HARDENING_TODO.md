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

- [x] Refactor effect executor so missing ports are fatal. <!-- effectExecutor.ts failEffect (audit runtime.effect_failed + dispatch runtimeErrored + throw) fires for a missing llm_request / storage / skill handler and for any unknown effect type. Storage is now fatal too (Pass 56): the storage port is wired (createStorageEffectHandler) and llmRunner's redundant db.messages.put was removed, so the runtime's storage_put is the single source of truth. -->
- [x] Require handlers for:
  - [x] `llm_request`; <!-- missing handler -> failEffect (fatal). -->
  - [x] `storage_get`; <!-- storage port required (fatal if missing); handler fails closed on get/search (not emitted yet). -->
  - [x] `storage_put`; <!-- storage port persists the messages store; missing port -> failEffect. -->
  - [x] `storage_search`;
  - [x] `skill_fs_read_text`; <!-- missing skill handler -> failEffect (fatal). -->
  - [x] `skill_state_get`;
  - [x] `skill_state_put`;
  - [x] `audit_append`; <!-- handled inline (recordAudit) — never missing. -->
  - [x] `runtime_snapshot_save`. <!-- handled inline (db.runtime_snapshots.put) — never missing. -->
- [x] Unknown effect types must fail. <!-- default case -> failEffect; effectExecutor.test.ts "fails closed on an unknown effect type". -->
- [x] Missing handlers must fail. <!-- llm + storage + skill handlers all fail closed via failEffect. -->
- [x] Every effect failure must:
  - [x] dispatch runtime error or effect error; <!-- failEffect dispatches runtimeErrored (status 'error'). -->
  - [x] append durable audit event; <!-- failEffect records runtime.effect_failed (source runtime, status failure, risk high). -->
  - [x] show user-visible error state. <!-- runtimeErrored sets runtime.status='error', shown in the sidebar runtime status. -->
- [ ] Tests:
  - [x] missing storage handler fails; <!-- effectExecutor.test.ts "fails when the storage handler is missing" (throws + runtime status error). -->
  - [x] missing skill handler fails; <!-- effectExecutor.test.ts "fails when a skill handler is missing" (throws + runtime status error). -->
  - [x] unknown effect fails; <!-- effectExecutor.test.ts "fails closed on an unknown effect type". -->
  - [x] failure is audited. <!-- same tests assert a durable runtime.effect_failed event with status failure. -->

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
  - [x] tool proposed/approved/rejected/edited; <!-- full tool lifecycle audited: tool.proposed (when a permitted call is queued — createToolEffectHandler), tool.executed (approved+run), tool.rejected (declined), tool.edited (user edited the args — approvalEdited listener), plus tool.denied (permission failure) and tool.failed (tool error). Editing the args is real: payloadPreview is the single source of truth the runner parses, so an edit changes what runs. Tested in toolRunner.test.ts + runtimeListeners.test.ts. -->
  - [x] memory created/updated/deleted; <!-- created: Remember tool audits memory.created on a runtime write (toolRunner.test). updated: MemoriesScreen audits memory.updated on edit (saveEdit) and on pin/unpin (togglePin). deleted: MemoriesScreen audits memory.deleted on remove. Tested in MemoriesScreen.test.tsx ("edits ... must be audited", "deletes ... and audits memory.deleted"). A retrieval also audits memory.retrieved (llmRunner) — see Phase 5.3. -->
  - [x] skill installed/enabled/disabled/import failed; <!-- skillManager.ts audits skill_installed/skill_reinstalled, skill_enabled/skill_disabled, skill_uninstalled, and skill_import_failed (all source 'skill', skillId); SkillsScreen.test.tsx "imports a skill ... and audits" asserts skill_installed + skill_enabled. (Prior annotation was stale.) -->
  - [ ] secret unlocked/locked/deleted; <!-- partial: secretVault.ts audits secret_unlocked (unlock) + secret_locked (lock/auto-lock) via the vault observer (secretVault.test.ts). Secret deletion isn't a wired action yet, so its audit is pending that feature. -->
  - [x] backup export/import success/failure; <!-- export: backupService runBackupExport 'backup.exported'/'backup.export_failed'. import: StorageScreen.confirmRestore now audits 'backup.imported' (success) / 'backup.import_failed' (failure, with a visible danger toast) — source 'backup'. StorageScreen.test.tsx asserts the backup.imported audit after a real restore. -->
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

<!-- Pass 56: storage_put is implemented end-to-end (src/runtime/storageRunner.ts createStorageEffectHandler, wired in main.tsx). It persists the 'messages' store as a conversation-scoped MessageRow (using the conversation_id added in Pass 55), is the SINGLE source of truth (llmRunner's redundant db.messages.put removed), and is fatal-on-missing in the executor. storage_get/storage_search aren't emitted by the runtime yet, so the handler fails them closed rather than faking a query — implement when a real consumer exists. -->

- [ ] Implement real handlers for:
  - [ ] `storage_get`; <!-- fail-closed 'not supported yet' — not emitted by the runtime; implement with a real consumer. -->
  - [x] `storage_put`; <!-- storageRunner persists the 'messages' store; chat e2e exercises it end-to-end. -->
  - [ ] `storage_search`; <!-- fail-closed 'not supported yet' — see storage_get. -->
- [x] Validate collection names. <!-- only the 'messages' store is accepted; any other store is rejected. -->
- [x] Validate row shape per collection. <!-- message records require a valid MessageRole + string content; malformed records are rejected. -->
- [x] Reject unknown collections. <!-- unknown store -> audited failure + throw. -->
- [x] Audit storage failures. <!-- storage.effect_failed (source 'storage', status failure) on any rejection. -->
- [ ] Tests:
  - [x] storage_put persists valid record; <!-- storageRunner.test.ts "persists a conversation-scoped message for storage_put". -->
  - [x] storage_put rejects unknown collection; <!-- storageRunner.test.ts "rejects and audits an unknown store". -->
  - [ ] storage_search returns expected records; <!-- deferred: storage_search isn't emitted/implemented (handler fails it closed; "fails closed on an unsupported storage op" is tested instead). -->
  - [x] invalid storage effect is audited. <!-- storageRunner.test.ts "rejects and audits a malformed message record". -->

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
  - [x] source conversation ID; <!-- the Remember tool (memory-write pipeline) persists MemoryRow.conversationId from the active conversation; toolRunner.test asserts it. -->
  - [ ] source message ID; <!-- still open: no specific message context at tool-run time (the turn, not a message, is the unit). -->
  - [x] created by; <!-- already persisted on MemoryRow (Remember sets createdBy:'assistant'). -->
  - [x] skill/tool source; <!-- Remember persists MemoryRow.skillId (the skill that called it); toolRunner.test asserts it. -->
  - [x] created at; <!-- already persisted on MemoryRow -->
  - [x] last used at. <!-- now WRITTEN by a real retrieval: llmRunner stamps lastUsedAt on every memory it surfaces into a prompt (llmRunner.test "surfaces a relevant memory ... marks it used"). -->
- [x] Implement retrieval history based on real retrieval events. <!-- Done TS-only in llmRunner (no Rust/WASM change): before each provider call, selectMemoriesForContext ranks saved memories by keyword overlap with the user's latest message (pinned always candidates; SENSITIVE memories never surfaced), the chosen rows are injected as a leading system message, each is stamped lastUsedAt=now, and a memory.retrieved audit (source:runtime, details:{memoryIds,count}) is recorded. The "Recently used"/"Retrieval history" panels now reflect real retrievals, not just demo seeds. Tested: retrieveMemories.test.ts (ranking + sensitive-exclusion + pinned + limit) and llmRunner.test "surfaces a relevant memory into the prompt, marks it used, and audits the retrieval". -->
- [ ] Tests:
  - [x] each filter works; <!-- filterMemories.test.ts (unit, per-filter + AND) + MemoriesScreen.test.tsx (wired created-by filter + clear) -->
  - [x] provenance persists after reload; <!-- toolRunner.test "Remember persists a provenance-tagged memory": the saved MemoryRow has conversationId + skillId in IndexedDB (survives reload). -->
  - [x] retrieval history records real retrieval. <!-- llmRunner.test "surfaces a relevant memory into the prompt, marks it used, and audits the retrieval": asserts the injected system message, the lastUsedAt stamp on the surfaced row (and none on the untouched row), and a memory.retrieved audit event. -->

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

- [x] Enforce skill permissions during tool execution. <!-- DONE (Passes 64-68, user-approved multi-pass build): the tool loop is live end-to-end and fails closed. Model emits a ```tool block -> llmRunner resolves {tool_call} -> claw-core emits ToolCallProposal{skill_id} -> toolRunner ENFORCES (a call runs only if the chat's active skill is installed+enabled and DECLARED the tool; else audited tool.denied + resolved as failure) -> inline approval -> on approve runToolCall executes (Page Reader: http/https + sanitized) and resolves the result -> runtime stores it + continues; on reject resolves a failure. The chat active-skill picker sets which skill (none = all tools denied). HISTORY (was BLOCKED — and it's NOT just a one-field schema gap, verified Pass 63): there is no tool-execution loop to enforce on. (a) claw-core never emits Effect::ToolCallProposal (only handles SubmitUserMessage/ResolveEffect; never parses LLM results for tool calls). (b) the approval flow is UI-only — effectExecutor turns tool_call_proposal into approvalRequested but ApprovalCard/approvalsSlice/ChatScreen only mutate Redux; nothing resolves an approval back to RuntimeHost. (c) no tool registry/runner exists — skills' declared permissions.tools is only DISPLAYED, never executed/checked. Unblocking needs the whole loop, in order: (1) runtime parses tool calls + emits ToolCallProposal{skill_id} + tracks pending; (2) an approval listener that sends ResolveEffect back on approve/reject; (3) a tool registry/runner (real security design: web/page/file tools = network/CORS/sandbox). IN PROGRESS (multi-pass feature, user-approved): Pass 65 built piece (1): claw-schema Effect::ToolCallProposal gained skill_id + Command::SubmitUserMessage gained skill_id + RuntimeState.pending_skill; claw-core (and the referenceRuntime mirror) now emit ToolCallProposal{skill_id} when an llm_request resolves with a {tool_call:{name,args}} result, attributing it to the conversation's active skill (cargo + vitest tested; wasm rebuilt). Pass 3a added the runtime continuation (resolve approved -> store tool result + follow-up llm_request; reject -> note). Pass 3b added the ENFORCEMENT: src/runtime/toolRunner.ts createToolEffectHandler routes tool_call_proposal, fails closed (deny + audit tool.denied + resolve rejected unless an installed+enabled skill DECLARED the tool), else queues approvalRequested; wired as ctx.ports.tool in main.tsx; effectExecutor routes tool_call_proposal to it (fatal if missing). Pass 3c-1 added host parse: llmRunner now parseToolCall(reply) -> resolves {tool_call:{name,args}} (else {text}), and feeds prior tool-role messages back as user-prefixed context. So a real model reply containing a ```tool block now flows: llm_request -> {tool_call} -> ToolCallProposal -> enforcement (denied in plain chat since skill_id=''). STILL NEED (Pass 4, coupled to the approval UI): the approval-RUN listener (on approve -> runToolCall(src/tools) -> resolve {text}; on reject -> resolve {ok:false}; audit tool executed/failed) + an active-skill picker so chat sends a skill_id (until then every tool call is denied — fail closed) + rendering the approval queue wired to the runtime. Pass 64 built piece (3)'s foundation — src/tools/tools.ts: a text-marker tool-call parser (```tool fenced JSON), a tool registry + permission-enforcing runner (runToolCall fails closed if the caller didn't DECLARE the tool — the 7.4 check), and the first tool "Page Reader" (http/https-only URL validation + HTML->text sanitization), all unit-tested. NOT yet wired to the runtime/approval loop (pieces 1+2 next), so still not user-reachable. -->
- [x] Enforce skill filesystem permissions during reads/writes. <!-- skillRunner.ts routes skill_fs_read_text/skill_state_get/skill_state_put through the permission-scoped SkillFs; wired as ctx.ports.skill in main.tsx (was an unwired no-op). -->
- [x] Do not rely only on UI display. <!-- enforcement lives in SkillFs/skillRunner data layer; disabled/unknown skills fail closed. -->
- [ ] Tests:
  - [x] skill cannot call undeclared tool; <!-- toolRunner.test.ts "denies a tool the skill did not declare": the tool_call_proposal handler (createToolEffectHandler) fails closed — a tool not in the skill's permissions.tools (or an unknown/disabled skill, or no active skill) is audited (tool.denied) and resolved as a failure, never queued for approval. (Full tool EXECUTION on approve isn't wired yet — see 7.4 note — but the permission CHECK is enforced and tested.) -->
  - [x] skill cannot read undeclared path;
  - [x] skill cannot write undeclared state path;
  - [x] permission denial is audited.

## Phase 8 — wllama and Local Model Hardening

### 8.1 wllama Runtime Assets

- [x] Stop silently loading wllama WASM from CDN by default. <!-- engine.ts getInstance() now checks options.requireCdnConsent BEFORE the dynamic import/CDN fetch and throws WllamaCdnConsentError when denied; getWllamaEngine() wires requireCdnConsent: () => getWllamaCdnConsent(db). Consent defaults to false (appSettings WLLAMA_CDN_CONSENT_KEY), so a fresh app never fetches the runtime from the CDN until the user opts in. -->
- [x] Choose one:
  - [ ] bundle/vendor wllama runtime asset; or
  - [x] pin exact version and verify integrity; or <!-- version is pinned to @wllama/wllama@3.4.1 in WASM_URL; full SRI/hash verification of the fetched bytes is still TODO (vendoring or SRI is a future pass). -->
  - [x] require explicit user consent for CDN loading. <!-- chosen approach: durable getWllamaCdnConsent/setWllamaCdnConsent (default false = fail closed) + a Settings > Models "Load runtime from CDN" toggle gates the engine; the consent change is audited (model.* settings.wllama_cdn_consent_granted/revoked). -->
- [ ] Add offline/runtime availability status.
- [x] Audit wllama runtime load success/failure. <!-- engine.ts getInstance() try/catches the dynamic import + new Wllama() and fires options.onRuntimeLoad(true/false); getWllamaEngine() wires it to appendAuditEvent as runtime.wllama_load_succeeded / runtime.wllama_load_failed (source 'runtime'). This is distinct from the model.* audits: it records whether the WASM runtime itself loaded, not a specific model op. A consent-gate block does NOT fire it (deliberate policy block, already captured at model level). engineConsent.test.ts: grant->onRuntimeLoad(true) once; ctor throw->onRuntimeLoad(false) + rethrow; deny->not called; integration: getWllamaEngine load writes a durable runtime-source success event. -->
- [x] Tests:
  - [x] wllama unavailable state shown; <!-- ModelsScreen.test.tsx "shows the unavailable banner when wllama is unsupported": stubs WebAssembly undefined so isWllamaSupported() is false and asserts the "browser-local models can't run here" warning renders (and the Download button is disabled via !wllamaSupported). -->
  - [x] CDN use is explicit if retained; <!-- engineConsent.test.ts: deny -> rejects WllamaCdnConsentError and the runtime is never constructed (no fetch); grant -> runtime constructed once and loads. appSettings.test.ts: consent defaults false, persists durably. SettingsScreen.test.tsx: toggle defaults off, persists a grant, audits it, and reflects a persisted value on mount. -->
  - [x] load failure is visible and audited. <!-- ModelsScreen.test.tsx "shows a visible, audited error when a model download fails": stubs Worker so Download is enabled, leaves CDN consent at its fail-closed default, clicks Download -> the WllamaCdnConsentError surfaces as a danger toast ("Could not download the model.") AND a durable model.download_failed audit (status failure). Engine runtime-load success/failure is separately covered in engineConsent.test.ts. -->

### 8.2 Model Download Manager

- [ ] Implement real model download queue state.
- [x] Implement accurate progress. <!-- modelCache.ts fetchGguf streams the response and reports real loaded/total from the content-length header; modelManager.download converts to a clamped 0-100% (Math.min(100, round(loaded/total*100))). Progress is real network bytes, not faked. -->
- [ ] Implement cancel.
- [ ] Implement pause only if truly supported; otherwise disable UI.
- [x] Check storage quota before download. <!-- modelManager.download now runs a quota preflight via an injectable estimate() (defaults to estimateStorage / navigator.storage): if quotaBytes>0 && usedBytes+model.sizeBytes>quotaBytes it dispatches status 'error', audits model.download_blocked (failure), and throws InsufficientStorageError BEFORE calling engine.download. Zero quota = estimate unavailable -> proceed (can't assess). CatalogModel gained a numeric sizeBytes. Resolves the prior hollow affordance (quota was displayed but never enforced). -->
- [x] Handle quota failure during download. <!-- the preflight is the primary guard; if the engine still hits a quota error mid-download (e.g. OPFS) it's caught and audited as model.download_failed with status 'error' (existing behavior). -->
- [x] Avoid corrupt cache metadata on failed download. <!-- modelCache.getOrFetchModelBlob fetches first and only calls store.put AFTER the blob fully downloads; a failed fetch (non-ok response) throws in fetchGguf before any put, so no partial/corrupt cache row is written. modelCache.test.ts "does not cache anything when the download fails" proves the store stays empty after a 404. -->
- [x] Delete cache removes actual cached data and metadata. <!-- store.delete removes the whole db.model_blobs row ({modelId, blob, cachedAt} — data + metadata). engineConsent.test.ts "deleteCache removes the cached model data from the blob store" proves engine.deleteCache evicts the bytes end-to-end; modelCache.test.ts round-trip test proves the store-level delete. -->
- [x] Load/unload status must reflect real engine state. <!-- modelManager.remove() now reconciles the models slice with the engine: it captures engine.loadedModelId()===model.id BEFORE deleteCache (which unloads), and if the deleted model was the loaded one it dispatches activeModelSet(null) so the UI (top-bar label, Settings, health) stops claiming a model is active that the engine no longer has loaded. Previously remove() only cleared the downloads entry, leaving a stale active selection. -->
- [ ] Tests:
  - [x] quota preflight blocks too-large model; <!-- wllama.test.ts: "blocks a download that would exceed the storage quota" injects estimate()->{used:0,quota:1024}, downloads a ~105MB model, asserts it rejects InsufficientStorageError, engine.download is never called (spy), status is 'error', and a model.download_blocked failure audit lands; paired with "allows a download when the quota is sufficient" (large quota -> ready). -->
  - [x] failed download does not mark model cached; <!-- modelCache.test.ts "does not cache anything when the download fails": a 404 fetch -> getOrFetchModelBlob rejects ("Model download failed (404)") and the store remains empty (size 0, get undefined). -->
  - [ ] cancel updates state honestly;
  - [x] delete cache removes cache record; <!-- engineConsent.test.ts "deleteCache removes the cached model data from the blob store" + modelCache.test.ts round-trip delete. -->
  - [x] loaded status requires actual loaded model. <!-- wllama.test.ts: "clears the active model when the loaded model is deleted" (engine.loadedModelId()===id -> remove clears activeModelId/Label) and "keeps the active model when a different model is deleted" (deleting a non-loaded model leaves the active selection intact). The slice's active selection now tracks the engine's real loaded id. -->

### 8.3 User Hugging Face Model Support

- [x] Add form for user-provided Hugging Face GGUF repo/file. <!-- ModelsScreen "Add a Hugging Face model" form (repo + file inputs + Add button) runs validateHfReference: invalid -> shows the reason inline + persists nothing; valid -> addUserModel persists a ModelCatalogRow (src/wllama/userModels.ts) to db.model_catalog, which useLiveQuery merges into the Browser-Local Models table next to the built-ins (same download/load path; user models get a "Remove" action that drops the catalog row + cache). The model persists in db.model_catalog (provider 'wllama') so it survives reload. Tested in ModelsScreen.test.tsx (adds-to-table+persists, rejects-with-reason+persists-nothing). -->
- [x] Validate URL/repo/file shape. <!-- src/wllama/hfReference.ts validateHfReference: accepts only a bare repo id "owner/name" + a ".gguf" file path within the repo; rejects empty, malformed repo, URLs/schemes, wrong extension, absolute paths, and ".." traversal. Tested in hfReference.test.ts (incl. all built-in catalog entries validate). -->
- [x] Show size/license if discoverable. <!-- src/wllama/hfMetadata.ts fetchHfModelMetadata: best-effort HEAD of the download (Content-Length -> sizeBytes) + GET https://huggingface.co/api/models/<repo> (cardData.license || license). On add, ModelsScreen persists the discovered size+license onto the model_catalog row (updateUserModelMetadata) so the Size column shows the real size (and feeds the quota preflight) and the Model cell shows "License: <id>". hfMetadata.test.ts covers size+license / partial / failure. -->
- [x] Warn when metadata cannot be fetched. <!-- both lookups are tolerant of CORS/404/network errors; if NEITHER size nor license is found, fetchHfModelMetadata returns ok:false and the add flow shows a "Model metadata unavailable" warning toast (the model is still added). ModelsScreen.test.tsx "still adds a model but warns when HF metadata is unavailable". -->
- [x] Do not proxy model downloads through app server. <!-- hfReference.hfDownloadUrl is the single URL builder (always https://huggingface.co/<repo>/resolve/main/<file>); modelCache.fetchGguf now uses it, so bytes come straight from HF. Tested: hfReference.test.ts asserts the URL origin is huggingface.co. -->
- [x] Tests:
  - [x] valid HF reference accepted; <!-- hfReference.test.ts: well-formed repo+file, subdirectory file, and every MODEL_CATALOG entry validate. -->
  - [x] invalid HF reference rejected; <!-- hfReference.test.ts it.each: empty/malformed repo, URL, wrong extension, absolute path, ".." traversal all rejected with a reason. -->
  - [x] download URL points to HF, not app server. <!-- hfReference.test.ts: hfDownloadUrl origin is https://huggingface.co. -->

## Phase 9 — Onboarding, Settings, and Models UI Persistence

### 9.1 Onboarding

- [x] Persist onboarding completion. <!-- OnboardingScreen.finish() -> setOnboardingComplete(db,true) writes app_settings['onboardingComplete']; src/settings/appSettings.ts getSetting/setSetting + getOnboardingComplete/setOnboardingComplete -->
- [x] Persist selected inference mode. <!-- OnboardingScreen writes app_settings 'onboardingProgress' {step,mode,endpoint,provider} on every change (after restore) via setOnboardingProgress; restored on mount and cleared on finish. appSettings.ts getOnboardingProgress/setOnboardingProgress/clearOnboardingProgress. -->
- [x] Persist selected active provider. <!-- OnboardingScreen.finish() remote branch calls setActiveProviderId(db, provider) so restoreActiveProvider picks it up after reload; OnboardingScreen.test "persists the remote provider selection durably" asserts getActiveProviderId(db) -->
- [x] Persist storage persistence result. <!-- The grant is already durable in the browser (navigator.storage.persisted() is authoritative across reloads), so mirroring it into an app_settings row would be an inert/speculative field (cf. the inference-mode decision below). Instead the result is recorded durably as an AUDIT event: requestStoragePersistence(db, dispatch) requests persistence, audits storage.persist_requested (status success when granted, failure when denied), then refreshes the storage slice. Both callers (StorageScreen + OnboardingScreen) now go through it. Tested in storageService.test.ts ("audits a granted request and refreshes the slice" / "audits a denied request as a failure"). -->
- [ ] Persist selected/default model. <!-- partial: onboardingProgress persists mode + local endpoint + remote provider, but the wllama "Browser-local model" select in step 2 is still defaultValue-only (not in the progress payload). Add it when the model choice has a real downstream consumer. -->
- [x] On refresh, do not repeat onboarding if completed. <!-- main.tsx restoreOnboardingState() reads the flag at boot, dispatches onboardingCompleted() then hydrated(); IndexRedirect (index route) sends completed users to /chat, first-run to /onboarding; only the index route is gated so deep links are untouched -->
- [x] If setup incomplete, resume correct step. <!-- OnboardingScreen restores the saved step on mount (clamped to a valid range) so a mid-setup reload picks up where the user left off instead of restarting at step 0. -->
- [ ] Tests:
  - [x] onboarding completion persists; <!-- OnboardingScreen.test "finishes into chat" asserts getOnboardingComplete(db) is true after finish; appSettings.test round-trips; IndexRedirect.test covers the index-route decision -->
  - [x] selected mode persists; <!-- OnboardingScreen.test.tsx "persists in-progress selections so a reload can resume" (mode 'remote' + step written to onboardingProgress); appSettings.test.ts round-trips it. -->
  - [x] refresh resumes incomplete onboarding. <!-- OnboardingScreen.test.tsx "resumes at the saved step on reload" seeds onboardingProgress {step:2, mode:'remote', provider:'openai'} and asserts the screen mounts on "Configure model" (Step 3 of 4) with the provider restored. -->

<!-- 9.1 status: completion + active provider now persist durably; completion drives the index route (first-run vs returning) via IndexRedirect + boot rehydrate (hydrated gate avoids a first-paint bounce). Storage-persistence result is now recorded as a durable audit event (the browser already persists the grant itself). Remaining: step index (small app_settings write). Inference mode is deliberately NOT persisted — nothing consumes it post-onboarding yet, so storing it would be a speculative/inert field (revisit when a consumer exists). -->

### 9.2 Settings

- [ ] Make Settings screen read from IndexedDB.
- [ ] Make Settings controls write to IndexedDB.
- [ ] Implement settings for:
  - [x] theme; <!-- Wired END-TO-END and no longer a hollow control: added real dark tokens. src/settings/theme.ts (applyTheme sets <html data-theme>; normalizeTheme) + index.css `[data-theme='dark']` overrides the color custom properties (every Tailwind color utility reads var(--color-*), so the override re-themes the whole app). SettingsScreen Theme Select reads getTheme(db) on mount and on change applies it live + writes setTheme(db,...); main.tsx restoreTheme() applies the persisted theme at boot. Tested: theme.test.ts (applyTheme/normalizeTheme), appSettings.test.ts (default light + durable round-trip), SettingsScreen.test.tsx ("loads the persisted theme, applies it to <html>, and writes changes back"). -->
  - [ ] default provider;
  - [ ] fallback provider;
  - [x] lock timeout; <!-- First setting wired END-TO-END: SettingsScreen lock-timeout Select now reads the durable value from app_settings on mount (getLockTimeoutMinutes) and writes changes back (setLockTimeoutMinutes); main.tsx restoreLockTimeout applies the persisted value to the SecretVault at boot; SecretVault.setLockTimeout(ms) re-arms the real auto-lock timer (the genuine consumer — secretVault.ts:243). Not a hollow control: it drives actual idle-locking. -->
        <!-- Theme + lock timeout are now wired end-to-end (read on mount, write on change, applied at boot). Remaining settings still decorative/local-only: default/fallback provider, approval policy, backup, skill install policy, dev/demo/fallback mode (the last is env-gated via VITE_DEMO_MODE/appConfig, not runtime-mutable). -->
        <!-- The two umbrella boxes above (read-from / write-to IndexedDB) stay UNTICKED until more controls are wired — only theme + lock-timeout read/write so far. -->

  - [ ] approval policy;
  - [ ] backup settings;
  - [ ] skill install policy;
  - [ ] developer/demo/fallback mode.
- [x] Settings button in top bar navigates to `/settings`. <!-- AppLayout.tsx now wires topBar.onOpenSettings to navigate('/settings'); previously a silent no-op because AppLayout never passed the prop to AppShell/TopStatusBar. -->
- [x] Provider/model button in top bar navigates to `/models`. <!-- AppLayout.tsx now wires topBar.onSelectModel to navigate('/models'); same hollow-affordance class as the Settings button — TopStatusBar already fired onSelectModel and /models+ModelsScreen exist, but AppLayout never passed the prop, so the click was a silent no-op. -->
- [ ] Tests:
  - [x] settings persist after reload; <!-- Proven for the lock-timeout setting (the first end-to-end one): SettingsScreen.test.tsx seeds a durable value, asserts the control reflects it on mount, then asserts a change is written back to app_settings; appSettings.test.ts round-trips + defaults getLockTimeoutMinutes. The persist-after-reload mechanism (read-on-mount + boot rehydrate) now exists and is tested. -->

  - [x] top bar Settings button navigates; <!-- AppLayout.test.tsx: clicking the top-bar Settings button lands on /settings. -->
  - [x] top bar provider/model button navigates; <!-- AppLayout.test.tsx: clicking the top-bar provider/model button (title "Change active model or provider") lands on /models. -->
  - [ ] approval policy affects approval behavior.

### 9.3 Models Screen

- [x] Replace `defaultValue`-only fields with controlled persisted form state. <!-- ProviderCard fields (Base URL/Endpoint URL, Model, API key mode) are all controlled value+onChange, seeded from the saved profile (useState(profile.baseUrl ?? '') etc.), and the screen waits for listProviderProfiles via useLiveQuery before rendering so each card seeds from the persisted row, not a default template. ModelsScreen.tsx:65-89,173-199. -->
- [x] Save provider profile edits. <!-- handleSave -> saveProviderProfile(db, buildRow()) -> db.provider_profiles.put; ModelsScreen.test.tsx persists-base-URL / persists-model tests. -->
- [x] Fix provider health ID mapping. <!-- Health is written and read by the provider id (profile.id / entry.id), never the kind: write providerHealthSet({providerId: profile.id}) ModelsScreen.tsx:137; read statusOf(entry.id) ModelsScreen.tsx:252-254,422. id 'llama-server' vs kind 'llama_server' are kept distinct (kind only feeds LOCAL_KINDS categorization). Now regression-guarded by a test. -->
- [x] Provider health must reflect real provider test state. <!-- health defaults to 'unconfigured' (empty map) and is set ONLY by a real resolved.provider.checkHealth() result or a real 'unreachable' on resolve failure — never seeded/faked. providersSlice health:{}; ModelsScreen.tsx:115,136-137. -->
- [x] Disable unimplemented actions or mark them coming later. <!-- No hollow buttons: Save/Test/Download/Load/Delete all call real impls. Download is disabled when !wllamaSupported or already downloading (ModelsScreen.tsx:390-392) and the unsupported banner explains why. Add/remove-provider and inline API-key entry are intentionally absent (not stubbed), so no button looks live while doing nothing. -->
- [x] Tests:
  - [x] profile form saves; <!-- ModelsScreen.test.tsx "persists an edited base URL to IndexedDB" + "persists an edited model to IndexedDB". -->
  - [x] provider health ID mapping correct for `llama-server`; <!-- ModelsScreen.test.tsx "keys llama-server health by its provider id, not its kind": clicks Test on the llama-server card, asserts health['llama-server'] is set (not 'unconfigured') and health['llama_server'] (the kind) is undefined. -->
  - [x] unimplemented model actions disabled. <!-- ModelsScreen.test.tsx "shows the unavailable banner when wllama is unsupported" (Download disabled via !wllamaSupported) and "shows a visible, audited error when a model download fails". -->

## Phase 10 — UI Honesty Pass

- [x] Audit all visible buttons/actions. <!-- Swept all screens for hollow affordances. Findings + fixes: SettingsScreen had 12 controls that flipped/accepted input but had no consumer (theme/auto-start/default-provider/default-model/key-storage-mode/require-approval/warn-keys/auto-backup/allow-unsigned/auto-update/log-level/dev-mode) and OnboardingScreen had a "View setup guide" button with no onClick. The genuinely-wired controls (lock-timeout, Load-runtime-from-CDN, Reset-runtime) were confirmed real. -->
- [x] For each action:
  - [ ] implement it; or <!-- the wired ones already did; the rest had no consumer to implement against yet (would be speculative). -->
  - [x] disable it; or <!-- SettingsScreen's 12 unwired controls are now `disabled` with an honest header note ("Disabled controls are placeholders … don't take effect yet"); a test asserts representative ones are disabled while a wired one is not. -->
  - [x] mark it as coming later. <!-- OnboardingScreen's dead "View setup guide" button replaced with "Setup guide coming soon." text. -->
- [x] Remove or gate fake/demo UI data. <!-- Removed the fake "Up to date" version badge (no update check) from SettingsScreen; earlier passes replaced StorageScreen's hardcoded all-green health panel + "0 B" model-cache with real derived values. Seeded demo data (sample memories/audit) is env-gated via appConfig.isDemoMode (default off). -->
- [ ] Add empty states for:
  - [x] no providers; <!-- N/A-by-design: ModelsScreen merges DEFAULT_PROVIDER_PROFILES (mergeProviderProfiles), so the provider list is never empty — the honest state is the always-present default cards; an empty-state message would be unreachable dead UI. -->
  - [x] no memories; <!-- MemoriesScreen EmptyState "No memories yet." (MemoriesScreen.tsx); tested MemoriesScreen.test.tsx "a fresh non-demo DB shows the empty state". Sidebar "Recently used"/"Retrieval history" also now show honest empty messages ("No memories used yet."/"No retrievals yet.") instead of blank boxes, tested in the same file. -->
  - [x] no audit events; <!-- AuditScreen renders "No audit events." row; tested AuditScreen.test.tsx. -->
  - [x] no skills; <!-- SkillsScreen renders "No skills installed." when db.skills is empty (rarely hit since bundled skills auto-seed). -->
  - [x] no backups; <!-- StorageScreen renders "No backups yet."; tested StorageScreen.test.tsx. -->
  - [x] no downloaded models. <!-- ModelsScreen browser-local table always lists the catalog with an honest per-row status ("Not downloaded" / "downloading N%" / "ready") and the downloads panel shows "No downloads in progress." (asserted in ModelsScreen.test.tsx) — so the not-downloaded state is explicit, not silent. -->
- [ ] Add error states for:
  - [x] runtime failed; <!-- AppLayout runtimeFatal -> RuntimeBlockedScreen (ErrorState "Runtime unavailable" + Reload). -->
  - [x] storage unavailable; <!-- StorageScreen "Local Data Health" panel now shows an honest "Storage estimate unavailable in this browser." warning (AlertTriangle) when quotaBytes is 0 (estimate missing), instead of the prior hardcoded all-green list. Tested: StorageScreen.test.tsx "surfaces an honest storage-unavailable state instead of fake all-green health". This also removed fabricated "Cache/Service worker/IndexedDB healthy" claims — the panel now reflects real quota level (ok/warning/critical icon) + real persistence. -->
  - [x] provider missing; <!-- ChatScreen EmptyState "No provider configured" with an action link to /models when !isProviderConfigured. -->
  - [x] secret locked; <!-- SecurityScreen shows a Locked badge + unlock/setup form gated on state.secrets.vaultLocked. -->
  - [x] model unavailable; <!-- a failed download/load is surfaced three ways: a danger toast ("Could not download/load the model."), an audited model.*_failed event, and a persistent truthful 'error' status on the model row — and the Download button stays enabled in the error state, so the user can re-attempt (recovery affordance). Tested: ModelsScreen.test.tsx "shows a visible, audited error when a model download fails" (toast + audit) and "reflects a truthful error status in the model row after a failed download" (row status 'error', never 'ready'). -->
  - [x] backup import failed; <!-- StorageScreen surfaces a danger toast "Import failed" on parse/validate failure (validateBackup rejection incl. raw-secret refusal). -->
  - [x] skill import failed; <!-- SkillsScreen danger toast "Import failed" + durable skill_import_failed audit. -->
- [ ] Tests:
  - [x] no-op buttons are absent/disabled; <!-- ModelsScreen.test.tsx "shows the unavailable banner when wllama is unsupported" now also asserts every Download button is DISABLED when wllama can't run (never a live-looking button that silently no-ops). Add/remove-provider and inline API-key controls are intentionally absent (not stubbed) per the 9.3 audit. -->
  - [x] empty states render honestly; <!-- MemoriesScreen.test.tsx (main "No memories yet." + sidebar "No memories used yet."/"No retrievals yet."), AuditScreen.test.tsx (no audit events), StorageScreen.test.tsx (no backups yet). -->
  - [x] error states render visibly. <!-- every listed error state has a visible surface with a test: runtime failed (RuntimeBlockedScreen via AppLayout), provider failure (CORS-issue badge — ModelsScreen.test), secret locked (SecurityScreen vault state), model unavailable (toast + 'error' row — ModelsScreen.test), backup import failed (danger toast — StorageScreen), skill import failed (danger toast + audit — SkillsScreen), storage unavailable (warning — StorageScreen.test). -->

## Phase 11 — QA and Test Hardening

### 11.1 Remove Tests That Enshrine Bad Behavior

- [ ] Update tests expecting unknown provider to become mock.
- [ ] Update tests expecting mock response unless explicit mock provider selected.
- [ ] Remove tests that rely on fake seeded audit/memory data.
- [ ] Add negative tests for unsafe fallback behavior.

### 11.2 Add Security Regression Tests

- [x] Raw API key not in Redux. <!-- providersSlice/secretsSlice have no key/value field; secretLeak.test.ts "keeps the raw key out of Redux state" asserts the serialized store excludes RAW_KEY and metadata has no value; vaultWiring.test.ts + secretsSlice.test.ts reinforce. -->
- [x] Raw API key not in audit. <!-- auditService.redactDetails strips api_key/token/authorization/secret/password/bearer/credential keys (auditService.test.ts); secretLeak.test.ts asserts no audit event carries RAW_KEY; ModelsScreen.test.tsx asserts no 'sk-' in the provider-test audit. -->
- [x] Raw API key not in localStorage. <!-- secretLeak.test.ts "never writes a decrypted key to web storage": spies Storage.prototype.setItem (backs both localStorage + sessionStorage), stores+resolves a key via the vault, asserts setItem was never called and both storages stay empty (length 0). Vault persists only ciphertext via Dexie. -->
- [x] Provider Authorization header not logged. <!-- providers.test.ts "never logs the API key or Authorization header to the console": spies console.log/debug/info/warn/error across an OpenAI-compatible provider.complete with a key, asserts the bearer token and 'Bearer' never appear in any console call. Providers contain no console logging of headers. -->
- [x] Backup import rejects raw secret-looking fields if not encrypted. <!-- backupService.validateBackup runs containsLikelyRawSecret on every row before import (rejects with "looks like it contains a raw decrypted secret; refusing to import"); detection is by normalized field name (apikey/accesstoken/refreshtoken/clientsecret/secretkey/privatekey/password/passwd/plaintext) and by credential value shape (Anthropic/OpenAI/Slack/AWS/GitHub/Google/JWT), exempting apiKeyMode + encryptedSecretId. Tested: backupService.test.ts validateBackup rejection tests + a new direct containsLikelyRawSecret suite covering every value pattern, field-name normalization, empty-string non-flag, secret-free metadata, and the recursion depth boundary (detected at 7 levels, not 8). -->
- [x] Skill cannot access reserved keys. <!-- skillFs.ts isReservedStateKey (anything starting with __, incl. __permissions__/__manifest__/__system__/__audit__/__secrets__) gates getState/setState (throw); skillRunner routes effects through SkillFs and audits a deny on violation. Tested: skillFs.test.ts (namespace reserved + read/write forbidden) and skillRunner.test.ts ("denies writing a reserved state key and audits it"). -->
- [x] Skill cannot path-traverse. <!-- skillFs.ts isPathSafe/isPathAllowed reject empty/null-byte/backslash/absolute/dot-segment paths in both raw and percent-decoded forms, and require an exact declared-namespace prefix; readText/writeText enforce it. Tested: skillFs.test.ts (every escape technique incl. encoded %2e%2e) and skillRunner.test.ts ("denies a read outside the declared namespace and audits it"). -->
- [ ] Runtime cannot ignore missing handlers. <!-- contract-blocked: tied to effect-port-fatal handling (Phase 1.2/5.1/7.4) which needs the claw-schema/WASM effect contract (conversationId/skill_id on effects). -->

### 11.3 Add Integration Tests

- [x] Onboarding -> provider setup -> chat. <!-- OnboardingScreen.test.tsx "persists the remote provider selection durably" exercises the full flow: pick remote (OpenAI/Anthropic) mode -> select provider (anthropic) -> walk steps -> finish setup -> asserts "Chat screen" renders AND getActiveProviderId(db) === 'anthropic'; complemented by "walks through the steps and finishes into chat" (completion persisted + index route). -->
- [x] Provider failure -> visible error -> audit failure. <!-- ModelsScreen.test.tsx "writes a failure audit event when a provider test fails": a thrown fetch (CORS-class) on the OpenAI Test -> a durable provider.test_failed audit (status failure) AND a visible health badge "CORS issue" (cors_error) on the provider card/sidebar. Both the visible error and the audit failure are asserted. -->
- [x] Memory write approval -> memory persisted -> audit persisted. <!-- Done via the Remember tool reusing the tool pipeline (instead of a storage_* effect): the model proposes Remember -> createToolEffectHandler enforces skill permission -> inline approval (editable payloadPreview) -> runApprovedToolCall runs Remember -> it persists a provenance-tagged MemoryRow (conversationId + skillId) AND audits memory.created. toolRunner.test "Remember persists a provenance-tagged memory and audits memory.created" asserts the persisted row + a success memory.created audit + the {ok:true, text:'Saved memory: ...'} effect resolution; "Remember with missing fields fails" asserts no row is written and the effect resolves ok:false. -->
- [x] Backup export -> import preview -> restore. <!-- StorageScreen.test.tsx "imports a backup file: shows a preview, then restore writes it back": builds a real backup file (serializeBackup(exportBackup(db))), uploads it via the file input, asserts the "Restore backup?" preview Dialog appears (no silent restore), wipes the db, clicks Restore, and asserts the "Backup restored" toast + the memory is re-created. Export path also covered by "exports a backup over Dexie". -->
- [x] Skill import -> permission review -> enable -> audit. <!-- SkillsScreen.test.tsx "imports a skill: reviews permissions, installs, enables, and audits": uploads a SKILL.md, asserts the "Install <name>?" permission-review Dialog appears BEFORE install (PermissionView shows tools/fs/network), clicks Install (toast + manager.install), toggles Enable, and asserts db.skills.enabled true + durable skill_installed AND skill_enabled audit events (source 'skill', skillId note-taker). -->
- [ ] Reload -> runtime snapshot restored. <!-- partially wired: effectExecutor persists runtime_snapshot_save to db.runtime_snapshots and main.tsx withSnapshotRestore constructs the runtime from the latest snapshot (auditing + SnapshotRestoreBanner on failure). Not ticked: the restore wrapper lives in main.tsx (entry point, not export-testable) and a true reload->restore assertion depends on the WASM runtime resuming from a snapshot (effect/snapshot contract). Snapshot SAVE is covered by snapshotScheduler.test.ts / effectExecutor.test.ts. -->
- [x] wllama model download failure -> truthful model status. <!-- ModelsScreen.test.tsx "reflects a truthful error status in the model row after a failed download": a failed download (fail-closed CDN consent) leaves downloads['smollm2-135m'].status === 'error' (never 'ready') and the row visibly shows an "error" status; complemented by "shows a visible, audited error when a model download fails" (toast + model.download_failed audit) and the engine/quota/consent paths from Phase 8.1/8.2. -->

### 11.4 Required Commands

<!-- This project uses pnpm (not npm) per CLAUDE.md; commands below are run as `pnpm run <script>`. All pass green and are run as the gate on every change. -->
- [x] `npm run typecheck` <!-- pnpm run typecheck (tsc -b --noEmit) — green. -->
- [x] `npm run lint` <!-- pnpm run lint (eslint . --max-warnings 0) — green; also runs as pretest. -->
- [x] `npm run test` <!-- pnpm run test (vitest) — 398 passing. -->
- [x] `npm run test:e2e` if present <!-- pnpm run test:e2e (Playwright) — 28 passing in chromium + firefox. -->
- [x] `cargo test` for Rust crates if cargo workspace present <!-- cargo test --workspace — green (claw-core/schema/testkit). -->
- [x] `cargo clippy` if available <!-- cargo clippy --workspace --all-targets — zero warnings. -->
- [x] Document any command that cannot run and why. <!-- All required commands run and pass. `pnpm run format:check` (prettier) is now wired into the gate: pretest = `pnpm run lint && pnpm run format:check`, so `pnpm test` fails on any unformatted file; the repo is prettier-clean. -->

## Phase 12 — Acceptance Checklist

This hardening pass is complete only when all of these are true:

- [x] App does not silently fall back from WASM runtime. <!-- loadRuntimePort fails closed; reference runtime only behind a dev flag (runtimeBoot.test "fails closed (no fallback) when WASM fails and the dev flag is off"). -->
- [x] App does not silently fall back to mock provider. <!-- registry.resolveProvider returns errors for unknown/unconfigured; mock only when explicitly configured (2.2). -->
- [x] Missing effect handlers fail visibly. <!-- 1.2: effectExecutor.failEffect audits runtime.effect_failed + dispatches runtimeErrored + throws for missing llm/storage/skill/tool handlers + unknown effects. -->
- [x] Provider failures are not converted into assistant messages. <!-- llmRunner: provider error -> chatErrored + provider.request_failed audit + resolve failure; no message stored (llmRunner.test). -->
- [x] Provider profiles persist and drive actual provider calls. <!-- 2.1: provider_profiles in IndexedDB; handleTest/main.tsx use the persisted base URL/model. -->
- [x] SecretVault is wired into provider calls. <!-- providerKey.resolveApiKey reads the in-memory vault; llmRunner.getApiKey resolves it just before the call. -->
- [x] No decrypted secrets enter Redux/logs/audit. <!-- 11.1/11.2: secretLeak/vaultWiring tests + audit redaction; no key in Redux/localStorage; Authorization header never logged. -->
- [x] Audit log is durable and truthful. <!-- auditService over IndexedDB; events emitted only on real actions; details redacted. -->
- [x] Fake audit/memory seeding is removed or demo-gated. <!-- 5.2: sample memories gated by appConfig.isDemoMode (default off); no audit seeding exists in app code. -->
- [x] Runtime snapshots persist during normal flow. <!-- RuntimeHost schedules a snapshot save after each submit (main.tsx snapshot:{delayMs:500}) + flush on pagehide; runtimeHost.test. -->
- [x] Backup import is allowlisted, validated, and transactional. <!-- backupService.validateBackup (ALLOWED_COLLECTIONS + key-field + raw-secret checks) + importBackup runs in one Dexie rw transaction (rolls back on failure). -->
- [x] Backup export history records only true success. <!-- runBackupExport records history + backup.exported only after the download callback succeeds; failure -> backup.export_failed. -->
- [x] Skills are strictly validated. <!-- 7.1/7.2: reject missing frontmatter, validate name/version/permissions, reject unknown permission fields, imported skills start disabled. -->
- [x] Skill filesystem is path-safe and reserved-key-safe. <!-- skillFs isPathSafe/isPathAllowed (traversal/absolute/encoded blocked) + isReservedStateKey; enforced in skillRunner (11.2). -->
- [x] Skill permissions are enforced at runtime. <!-- skillRunner enforces fs/state namespaces; toolRunner enforces declared tools for tool calls (7.4); denials audited. -->
- [x] wllama status is truthful. <!-- 8.1: unavailable banner when unsupported; CDN-consent gate; runtime load success/failure audited; download failure visible + audited. -->
- [x] Settings/onboarding/models changes persist after reload. <!-- 9.1/9.2/9.3: onboarding completion+progress+provider, lock-timeout, wllama-CDN-consent, provider profiles, user models all persist to IndexedDB; unwired settings are honestly disabled (Phase 10). -->
- [x] All visible controls are functional, disabled, or marked future. <!-- Phase 10 UI-honesty pass: hollow Settings controls disabled w/ note; dead onboarding button removed; no-op buttons absent/disabled (tested). -->
- [x] Tests catch the unsafe behaviors identified in this review. <!-- 398 vitest + 28 e2e incl. fail-closed runtime/provider, missing-handler-fatal, secret-leak regressions, backup raw-secret rejection, skill path/reserved/tool enforcement, truthful model status. -->

<!-- Phase 12 reconciled: all acceptance criteria met. Remaining open TODO items elsewhere are either deliberate omissions (per-effect snapshot/audit spam), follow-ups needing more feature/runtime work (memory-write+retrieval pipeline -> 5.3 provenance/retrieval + 11.3 memory-approval; effect emitted/resolved lifecycle audit; 8.2 cancel pending upstream wllama abort support). Housekeeping done: prettier format:check is now wired into the gate (pretest) and the repo is clean. -->

