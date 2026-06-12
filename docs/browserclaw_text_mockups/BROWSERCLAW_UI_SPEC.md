# BrowserClaw UI Implementation Spec

## Purpose

Implement the BrowserClaw web UI as a desktop-class, browser-only, local-first AI agent console.

The mockups in `svg/` are Figma-importable screen references. They are not production UI code. Implement the app as real React components using the visual layout, terminology, information architecture, and interaction patterns shown in the mockups.

## Core Architecture

Use:

- React + TypeScript + Vite.
- Redux Toolkit as the UI/runtime control plane.
- Rust/WASM as the deterministic agent runtime.
- IndexedDB/OPFS for durable storage.
- wllama as the first browser-local GGUF model provider.
- Provider adapters for OpenAI, Anthropic, OpenAI-compatible APIs, Ollama, and llama-server.
- Virtual skill filesystem for Pi/OpenClaw-style skills.

State ownership:

- Redux Toolkit: UI/session orchestration, active run state, provider health, model download progress, approval queue, selected records, recent audit feed.
- IndexedDB/OPFS: durable data, conversations, messages, memories, skills, skill files, skill state, audit events, settings, encrypted secrets, model cache metadata.
- Rust/WASM: deterministic runtime state machine, effect generation, tool validation, rules, schedules, snapshot/restore.
- SecretVault: decrypted API keys in memory only. Never put decrypted secrets in Redux, audit logs, localStorage, or console logs.

## Routes and Screens

| Route | Screen | SVG |
|---|---|---|
| `/onboarding` | First-run setup wizard | `svg/01_onboarding.svg` |
| `/chat` | Chat / Workbench | `svg/02_chat_workbench.svg` |
| `/models` | Model/provider manager | `svg/03_models.svg` |
| `/storage` | Storage / backup / restore | `svg/04_storage_backup.svg` |
| `/skills` | Skill manager | `svg/05_skills.svg` |
| `/memories` | Memory manager | `svg/06_memories.svg` |
| `/audit` | Audit log | `svg/07_audit.svg` |
| `/settings` | Settings | `svg/08_settings.svg` |
| `/workflow` | User workflow explainer | `svg/09_user_workflow.svg` |

## Shared Layout

Every screen should use the same AppShell:

- BrowserClaw brand/logo in top-left.
- Left nav with Chat, Models, Storage, Skills, Memories, Audit, Settings.
- Top status area with:
  - active model/provider badge;
  - storage usage indicator;
  - Settings button.
- Runtime status card at bottom-left.
- Main content area.
- Optional right inspector panel.

Right inspector tabs where applicable:

- Tool Calls
- Context
- Memory
- Skills
- Audit

## First-Run Setup

The first run flow configures the local workspace.

Steps:

1. Choose inference mode:
   - browser-local model with wllama;
   - connect to Ollama or llama-server;
   - use OpenAI / Anthropic.
2. Set up storage:
   - create IndexedDB database;
   - request persistent browser storage;
   - show quota estimate.
3. Configure provider:
   - select/download local GGUF;
   - test local endpoint;
   - configure remote provider key.
4. Finish:
   - create default workspace;
   - install bundled skills;
   - route to Chat.

## Chat / Workbench

Chat is the primary user intent surface.

Required elements:

- Message thread.
- Composer with attach button and slash-command hint.
- Inline approval cards for side effects.
- Tool call status.
- Context/memory/skills/audit inspector.
- Runtime status footer.

Approval cards must support:

- approve;
- edit;
- reject;
- show risk;
- show exact data to be written/sent/executed.

No meaningful side effect should happen silently in v0.1.

## Models

Provider sections:

- Remote Providers:
  - OpenAI;
  - Anthropic;
  - OpenAI-compatible endpoint.
- Local Endpoints:
  - Ollama;
  - llama-server.
- Browser-Local Models:
  - wllama GGUF models from Hugging Face.

Each provider should support:

- base URL;
- model;
- API key mode;
- encrypted key reference;
- test provider button;
- status badges:
  - Connected;
  - Not configured;
  - CORS issue;
  - Auth failed;
  - Model not found;
  - Endpoint unreachable.

wllama model manager must support:

- Hugging Face repo/file reference;
- model size;
- download queue;
- progress;
- load/unload;
- delete cache;
- quota warning.

## Storage / Backup

Required features:

- IndexedDB usage card.
- Model cache usage card.
- Persistent storage status card.
- Export backup.
- Import backup.
- Backup history.
- Local data health.
- Storage recommendations.
- Placeholder for future encrypted Google Drive backup.

Backup format:

- `.clawbackup` archive.
- Manifest with schema/app version.
- JSONL for large collections.
- Optional encrypted secrets.
- Include model references, not GGUF/model files by default.
- Include skills and skill state.

## Skills

Support safe Pi/OpenClaw-style skills.

v0.1 skill types:

- bundled instruction skills;
- imported `.clawskill`;
- imported `SKILL.md`.

Virtual skill filesystem:

- `SkillPackageStore`: installed skill packages.
- `SkillAssetStore`: read-only skill package files.
- `SkillStateStore`: private per-skill mutable state.
- `SkillFs` API: safe path-based reads/writes only inside approved namespaces.

Do not support:

- arbitrary POSIX filesystem;
- arbitrary path access;
- raw IndexedDB/OPFS access;
- global shared writable dirs;
- user file access without picker approval;
- arbitrary JS execution.

Skill details tabs:

- Overview
- Instructions
- Files
- Permissions
- State
- Audit

## Memories

Memory page requirements:

- Search.
- Filters:
  - tags;
  - source;
  - created by;
  - sensitivity.
- Memory list.
- Editable detail panel.
- Pin/delete/edit actions.
- Provenance:
  - source conversation;
  - source message;
  - created by;
  - created timestamp;
  - last used timestamp.
- Related memories.
- Retrieval history.

## Audit

Audit log is mandatory.

Events to record:

- runtime initialized;
- model loaded/unloaded;
- model download started/completed/failed;
- LLM request sent;
- LLM response received;
- tool call proposed;
- tool call approved/rejected/edited;
- tool executed;
- memory created/updated/deleted;
- skill installed/enabled/disabled;
- secret unlocked/locked;
- backup exported/imported;
- provider test success/failure.

Audit page needs filters, event list, expandable detail, JSON details panel, summary metrics, risk breakdown, recent approvals, and CSV export.

## Settings

Settings sections:

- General
- Models
- Security
- Storage
- Skills
- Developer

Security settings must include:

- key storage mode;
- lock timeout;
- require approval by default;
- browser-direct API key warning;
- network allowlist.

Developer settings should include:

- export logs;
- log level;
- dev mode;
- reset runtime.

## Design System

Use `design_tokens.json` as the canonical reference.

Primary look:

- background: `#F6F8FB`
- surface: `#FFFFFF`
- text: `#101828`
- muted: `#667085`
- primary: `#2563EB`
- success: `#16A34A`
- warning: `#F59E0B`
- danger: `#DC2626`

Use Inter or a similar sans-serif font.

## Accessibility

- Full keyboard navigation.
- Visible focus rings.
- Semantic headings.
- Buttons and controls with accessible labels.
- Approval actions reachable via keyboard.
- Color cannot be the only status signal.
- Dialogs trap focus and restore focus on close.

## Acceptance Criteria

- All routes render with shared AppShell.
- Redux controls live UI/runtime state.
- Durable data persists through reload.
- Runtime snapshots are persisted.
- No decrypted secret ever appears in Redux state, logs, audit payloads, or localStorage.
- Backup export/import works.
- Provider tests show useful error states.
- wllama model manager supports download/load/delete flows.
- Skill import and permission display are implemented.
- Audit log records every meaningful event.
