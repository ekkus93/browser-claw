# BrowserClaw Runtime, Storage, Provider, Skills, and Security Hardening TODO

## Phase 0 — Ground Rules and Regression Guardrails

- [ ] Add a `HARDENING_NOTES.md` or update existing docs explaining:
  - [ ] no silent fallbacks;
  - [ ] no no-op effect handlers;
  - [ ] no implicit mock provider;
  - [ ] no fake seeded audit/memory data outside explicit demo mode;
  - [ ] no decrypted secrets in Redux/logs/audit.
- [ ] Add an app-wide `isDemoMode`/`isDevFallbackAllowed` configuration policy.
- [ ] Ensure production/default builds have:
  - [ ] demo mode disabled;
  - [ ] reference runtime fallback disabled;
  - [ ] mock provider fallback disabled.
- [ ] Add a visible developer/demo banner when any demo/fallback mode is enabled.
- [ ] Add tests proving default mode fails closed.

## Phase 1 — Remove Unsafe Runtime Fallbacks

### 1.1 WASM Runtime Startup

- [ ] Replace silent WASM-to-reference fallback in runtime startup.
- [ ] Default behavior:
  - [ ] try to load WASM runtime;
  - [ ] on success, dispatch runtime loaded;
  - [ ] on failure, dispatch runtime error;
  - [ ] on failure, append durable audit event;
  - [ ] on failure, show blocking UI error.
- [ ] Add explicit dev flag:
  - [ ] `VITE_ALLOW_REFERENCE_RUNTIME_FALLBACK=true`.
- [ ] If dev fallback is enabled:
  - [ ] show persistent warning banner;
  - [ ] set runtime mode to `reference`;
  - [ ] append `runtime.reference_fallback_used` audit event.
- [ ] Tests:
  - [ ] WASM load failure blocks in default mode.
  - [ ] WASM load failure uses reference runtime only with explicit flag.
  - [ ] UI displays the correct runtime mode.

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

- [ ] Implement durable audit service backed by IndexedDB.
- [ ] Add APIs:
  - [ ] `appendAuditEvent`;
  - [ ] `queryAuditEvents`;
  - [ ] `getAuditEvent`;
  - [ ] `exportAuditCsv`.
- [ ] Enforce sensitive data redaction.
- [ ] Add source/status/risk fields.
- [ ] Add schema migration if needed.
- [ ] Tests:
  - [ ] audit events persist after reload;
  - [ ] audit events query by type;
  - [ ] audit events query by risk;
  - [ ] audit CSV exports real durable events.

### 3.2 Remove Fake Audit Seeding

- [ ] Remove fake audit seeding from Audit screen.
- [ ] Replace with empty state.
- [ ] If demo data is desired:
  - [ ] gate behind explicit demo mode;
  - [ ] mark records as demo;
  - [ ] show demo banner.
- [ ] Tests:
  - [ ] empty DB shows empty audit state;
  - [ ] fake audit is not inserted in default mode;
  - [ ] demo mode marks seeded events as demo.

### 3.3 Wire Audit Events Across App

- [ ] Append audit events for:
  - [ ] runtime loaded;
  - [ ] runtime failed;
  - [ ] fallback runtime used;
  - [ ] provider test success/failure;
  - [ ] LLM request start/success/failure;
  - [ ] effect emitted/resolved/failed;
  - [ ] tool proposed/approved/rejected/edited;
  - [ ] memory created/updated/deleted;
  - [ ] skill installed/enabled/disabled/import failed;
  - [ ] secret unlocked/locked/deleted;
  - [ ] backup export/import success/failure;
  - [ ] model download/load/delete success/failure.
- [ ] Ensure no raw secrets or large content bodies are recorded.

## Phase 4 — Runtime Snapshot Persistence

- [ ] Add snapshot persistence to normal runtime flow.
- [ ] Save snapshot:
  - [ ] after user message accepted;
  - [ ] after each effect emitted;
  - [ ] after each effect resolved;
  - [ ] after runtime enters idle;
  - [ ] after runtime enters error;
  - [ ] before unload when possible.
- [ ] Add snapshot compatibility check.
- [ ] Add corrupted snapshot handling.
- [ ] Add visible restore warning if snapshot incompatible/corrupted.
- [ ] Add audit events:
  - [ ] snapshot saved;
  - [ ] snapshot restore success;
  - [ ] snapshot restore failed;
  - [ ] snapshot incompatible.
- [ ] Tests:
  - [ ] reload restores runtime state;
  - [ ] corrupted snapshot does not crash silently;
  - [ ] incompatible snapshot is audited.

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

- [ ] Persist onboarding completion.
- [ ] Persist selected inference mode.
- [ ] Persist selected active provider.
- [ ] Persist storage persistence result.
- [ ] Persist selected/default model.
- [ ] On refresh, do not repeat onboarding if completed.
- [ ] If setup incomplete, resume correct step.
- [ ] Tests:
  - [ ] onboarding completion persists;
  - [ ] selected mode persists;
  - [ ] refresh resumes incomplete onboarding.

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
- [ ] Settings button in top bar navigates to `/settings`.
- [ ] Tests:
  - [ ] settings persist after reload;
  - [ ] top bar Settings button navigates;
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

