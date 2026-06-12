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
- [x] Add shared components:
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
- [x] Add migrations.
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
- [x] `/chat` from `02_chat_workbench.svg`.
- [x] `/models` from `03_models.svg`.
- [x] `/storage` from `04_storage_backup.svg`.
- [x] `/skills` from `05_skills.svg`.
- [x] `/memories` from `06_memories.svg`.
- [x] `/audit` from `07_audit.svg`.
- [x] `/settings` from `08_settings.svg`.
- [x] `/workflow` from `09_user_workflow.svg`.

## Phase 7 — Provider System

- [x] Define normalized LLM provider interface.
- [x] Implement mock provider.
- [x] Implement OpenAI-compatible provider.
- [x] Implement OpenAI preset.
- [x] Implement Anthropic preset.
- [x] Implement Ollama preset.
- [x] Implement llama-server preset.
- [x] Implement provider health tests.
- [x] Normalize CORS/auth/model/network errors.

## Phase 8 — wllama

- [x] Add wllama integration.
- [x] Run wllama in a Web Worker.
- [x] Add Hugging Face GGUF model references.
- [x] Implement model download queue.
- [x] Implement progress UI.
- [x] Implement load/unload.
- [x] Implement cache deletion.
- [x] Handle storage quota failures.
- [x] Add clear compatibility warnings.

## Phase 9 — Backup/Restore

- [x] Implement `.clawbackup` export.
- [x] Include manifest.
- [x] Export collections as JSONL.
- [x] Optionally include encrypted secrets.
- [x] Include model references, not model files.
- [x] Include installed skills and skill state.
- [x] Implement import validation.
- [x] Implement restore preview.
- [x] Implement conflict handling.
- [x] Add backup history.

## Phase 10 — Skills

- [x] Implement `.clawskill` import.
- [x] Implement `SKILL.md` import.
- [x] Parse frontmatter.
- [x] Show install permission review.
- [x] Implement enable/disable.
- [x] Implement SkillPackageStore.
- [x] Implement SkillAssetStore.
- [x] Implement SkillStateStore.
- [x] Implement safe SkillFs API.
- [x] Enforce permissions.
- [x] Add skill audit events.

## Phase 11 — Memories

- [x] Implement memory search.
- [x] Implement filters.
- [x] Implement memory detail editor.
- [x] Implement provenance.
- [x] Implement pin/delete/edit.
- [x] Implement retrieval history.

## Phase 12 — Audit

- [x] Implement audit filters.
- [x] Implement event table/list.
- [x] Implement expandable details.
- [x] Implement JSON detail panel.
- [x] Implement summary metrics.
- [x] Implement risk breakdown.
- [x] Implement CSV export.

## Phase 13 — QA

- [x] Run typecheck.
- [x] Run lint.
- [x] Run tests.
- [x] Test keyboard navigation.
- [x] Test reload persistence.
- [x] Test backup export/import.
- [x] Test provider error states.
- [x] Test no decrypted secrets in Redux.
- [x] Test skill filesystem isolation.
- [x] Test model quota error handling.
