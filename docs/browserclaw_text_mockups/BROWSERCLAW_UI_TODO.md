# BrowserClaw UI/App TODO

## Phase 0 — Setup

- [x] Create React + TypeScript + Vite app.
- [x] Add Tailwind CSS.
- [x] Add Redux Toolkit.
- [x] Add router.
- [x] Add Dexie.
- [x] Add test framework.
- [x] Enable strict TypeScript.
- [x] Add lint/format scripts.

## Phase 1 — Design System

- [x] Implement tokens from `design_tokens.json`.
- [x] Add AppShell.
- [x] Add TopStatusBar.
- [x] Add SidebarNav.
- [x] Add RightInspectorPanel.
- [x] Add StatusFooter.
- [ ] Add shared components:
  - [x] Button
  - [x] Card
  - [x] Badge
  - [x] Input
  - [x] Select
  - [x] Toggle
  - [x] Tabs
  - [x] Dialog
  - [x] Progress
  - [x] Toast
  - [x] EmptyState
  - [x] ErrorState

## Phase 2 — Redux Control Plane

- [x] Configure Redux store.
- [x] Add listener middleware.
- [x] Add slices:
  - [x] app
  - [x] runtime
  - [x] chat
  - [x] approvals
  - [x] providers
  - [x] models
  - [x] skills
  - [x] memories
  - [x] storage
  - [x] audit
  - [x] secrets metadata only
- [x] Ensure raw/decrypted secrets are never stored in Redux.
- [x] Add runtime event/action naming conventions.

## Phase 3 — IndexedDB/OPFS Storage

- [x] Create Dexie schema.
- [ ] Add migrations.
- [x] Add stores:
  - [x] app_settings
  - [x] provider_profiles
  - [x] encrypted_secrets
  - [x] conversations
  - [x] messages
  - [x] memories
  - [x] todos
  - [x] rules
  - [x] schedules
  - [x] skills
  - [x] skill_files
  - [x] skill_state
  - [x] audit_events
  - [x] runtime_snapshots
  - [x] model_catalog
  - [x] model_cache_index
  - [x] backup_history
- [x] Add storage quota service.
- [x] Add persistent storage request service.
- [x] Add storage health checks.

## Phase 4 — SecretVault

- [x] Implement in-memory SecretVault.
- [x] Support session-only keys.
- [x] Support encrypted stored keys.
- [x] Implement Web Crypto AES-GCM encryption.
- [x] Implement passphrase-derived key flow.
- [x] Add lock timeout.
- [x] Add unlock/lock audit events.
- [x] Add tests that verify secrets do not reach Redux/logs.

## Phase 5 — Rust/WASM Runtime Stub

- [x] Create Rust workspace.
- [x] Add `claw-core`.
- [x] Add `claw-wasm`.
- [x] Add `claw-schema`.
- [x] Add `claw-testkit`.
- [x] Implement wasm-bindgen API.
- [x] Implement effect model:
  - [x] llm_request
  - [x] storage_get
  - [x] storage_put
  - [x] storage_search
  - [x] tool_call_proposal
  - [x] skill_fs_read_text
  - [x] skill_state_get
  - [x] skill_state_put
  - [x] audit_append
  - [x] runtime_snapshot_save
- [x] Wire effects to Redux listener middleware.
- [x] Persist snapshots.

## Phase 6 — Screens

- [x] `/onboarding` from `01_onboarding.svg`.
- [ ] `/chat` from `02_chat_workbench.svg`.
- [ ] `/models` from `03_models.svg`.
- [ ] `/storage` from `04_storage_backup.svg`.
- [ ] `/skills` from `05_skills.svg`.
- [ ] `/memories` from `06_memories.svg`.
- [ ] `/audit` from `07_audit.svg`.
- [ ] `/settings` from `08_settings.svg`.
- [ ] `/workflow` from `09_user_workflow.svg`.

## Phase 7 — Provider System

- [ ] Define normalized LLM provider interface.
- [ ] Implement mock provider.
- [ ] Implement OpenAI-compatible provider.
- [ ] Implement OpenAI preset.
- [ ] Implement Anthropic preset.
- [ ] Implement Ollama preset.
- [ ] Implement llama-server preset.
- [ ] Implement provider health tests.
- [ ] Normalize CORS/auth/model/network errors.

## Phase 8 — wllama

- [ ] Add wllama integration.
- [ ] Run wllama in a Web Worker.
- [ ] Add Hugging Face GGUF model references.
- [ ] Implement model download queue.
- [ ] Implement progress UI.
- [ ] Implement load/unload.
- [ ] Implement cache deletion.
- [ ] Handle storage quota failures.
- [ ] Add clear compatibility warnings.

## Phase 9 — Backup/Restore

- [ ] Implement `.clawbackup` export.
- [ ] Include manifest.
- [ ] Export collections as JSONL.
- [ ] Optionally include encrypted secrets.
- [ ] Include model references, not model files.
- [ ] Include installed skills and skill state.
- [ ] Implement import validation.
- [ ] Implement restore preview.
- [ ] Implement conflict handling.
- [ ] Add backup history.

## Phase 10 — Skills

- [ ] Implement `.clawskill` import.
- [ ] Implement `SKILL.md` import.
- [ ] Parse frontmatter.
- [ ] Show install permission review.
- [ ] Implement enable/disable.
- [ ] Implement SkillPackageStore.
- [ ] Implement SkillAssetStore.
- [ ] Implement SkillStateStore.
- [ ] Implement safe SkillFs API.
- [ ] Enforce permissions.
- [ ] Add skill audit events.

## Phase 11 — Memories

- [ ] Implement memory search.
- [ ] Implement filters.
- [ ] Implement memory detail editor.
- [ ] Implement provenance.
- [ ] Implement pin/delete/edit.
- [ ] Implement retrieval history.

## Phase 12 — Audit

- [ ] Implement audit filters.
- [ ] Implement event table/list.
- [ ] Implement expandable details.
- [ ] Implement JSON detail panel.
- [ ] Implement summary metrics.
- [ ] Implement risk breakdown.
- [ ] Implement CSV export.

## Phase 13 — QA

- [ ] Run typecheck.
- [ ] Run lint.
- [ ] Run tests.
- [ ] Test keyboard navigation.
- [ ] Test reload persistence.
- [ ] Test backup export/import.
- [ ] Test provider error states.
- [ ] Test no decrypted secrets in Redux.
- [ ] Test skill filesystem isolation.
- [ ] Test model quota error handling.
