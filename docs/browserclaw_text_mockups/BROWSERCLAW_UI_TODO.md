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
- [ ] Add AppShell.
- [ ] Add TopStatusBar.
- [ ] Add SidebarNav.
- [ ] Add RightInspectorPanel.
- [ ] Add StatusFooter.
- [ ] Add shared components:
  - [ ] Button
  - [ ] Card
  - [ ] Badge
  - [ ] Input
  - [ ] Select
  - [ ] Toggle
  - [ ] Tabs
  - [ ] Dialog
  - [ ] Progress
  - [ ] Toast
  - [ ] EmptyState
  - [ ] ErrorState

## Phase 2 — Redux Control Plane

- [ ] Configure Redux store.
- [ ] Add listener middleware.
- [ ] Add slices:
  - [ ] app
  - [ ] runtime
  - [ ] chat
  - [ ] approvals
  - [ ] providers
  - [ ] models
  - [ ] skills
  - [ ] memories
  - [ ] storage
  - [ ] audit
  - [ ] secrets metadata only
- [ ] Ensure raw/decrypted secrets are never stored in Redux.
- [ ] Add runtime event/action naming conventions.

## Phase 3 — IndexedDB/OPFS Storage

- [ ] Create Dexie schema.
- [ ] Add migrations.
- [ ] Add stores:
  - [ ] app_settings
  - [ ] provider_profiles
  - [ ] encrypted_secrets
  - [ ] conversations
  - [ ] messages
  - [ ] memories
  - [ ] todos
  - [ ] rules
  - [ ] schedules
  - [ ] skills
  - [ ] skill_files
  - [ ] skill_state
  - [ ] audit_events
  - [ ] runtime_snapshots
  - [ ] model_catalog
  - [ ] model_cache_index
  - [ ] backup_history
- [ ] Add storage quota service.
- [ ] Add persistent storage request service.
- [ ] Add storage health checks.

## Phase 4 — SecretVault

- [ ] Implement in-memory SecretVault.
- [ ] Support session-only keys.
- [ ] Support encrypted stored keys.
- [ ] Implement Web Crypto AES-GCM encryption.
- [ ] Implement passphrase-derived key flow.
- [ ] Add lock timeout.
- [ ] Add unlock/lock audit events.
- [ ] Add tests that verify secrets do not reach Redux/logs.

## Phase 5 — Rust/WASM Runtime Stub

- [ ] Create Rust workspace.
- [ ] Add `claw-core`.
- [ ] Add `claw-wasm`.
- [ ] Add `claw-schema`.
- [ ] Add `claw-testkit`.
- [ ] Implement wasm-bindgen API.
- [ ] Implement effect model:
  - [ ] llm_request
  - [ ] storage_get
  - [ ] storage_put
  - [ ] storage_search
  - [ ] tool_call_proposal
  - [ ] skill_fs_read_text
  - [ ] skill_state_get
  - [ ] skill_state_put
  - [ ] audit_append
  - [ ] runtime_snapshot_save
- [ ] Wire effects to Redux listener middleware.
- [ ] Persist snapshots.

## Phase 6 — Screens

- [ ] `/onboarding` from `01_onboarding.svg`.
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
