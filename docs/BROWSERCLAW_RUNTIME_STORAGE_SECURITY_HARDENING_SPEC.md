# BrowserClaw Runtime, Storage, Provider, Skills, and Security Hardening Spec

## Purpose

This document defines the next hardening pass for BrowserClaw.

The current codebase has a strong scaffold: React/Vite UI, Redux slices, Dexie schema, Rust/WASM crates, provider adapters, wllama integration, backup code, skill parsing, SecretVault, and multiple screens.

However, the implementation still has several dangerous or misleading behaviors:

- silent fallbacks;
- no-op effect handlers;
- mock provider fallback;
- provider failures converted into ordinary assistant messages;
- fake seeded audit/memory data;
- provider settings not durably wired;
- SecretVault not wired into provider calls;
- runtime snapshots not automatically persisted;
- backup import validation too weak;
- skill import and skill filesystem enforcement too permissive;
- UI controls that look functional but are not actually persisted or connected.

This pass is about making the app **honest, durable, and fail-safe**.

The goal is not to add more UI surface area. The goal is to make the existing architecture real.

## Non-Goals

Do not add:

- new chat integrations such as Telegram, Discord, Slack, etc.;
- Google Drive sync yet;
- marketplace/registry support;
- multi-user accounts;
- complex workflow editor;
- new visual redesign;
- new providers beyond the planned set;
- arbitrary executable skills;
- arbitrary JavaScript execution;
- real POSIX filesystem access.

Do not paper over missing implementations with mock behavior, default demo data, or catch-all fallback code.

## Hardening Principles

### 1. Fail closed

If something required for correctness is missing, broken, or unconfigured, the app must fail visibly.

Examples:

- Rust/WASM runtime fails to load.
- LLM provider is missing.
- Effect handler port is missing.
- Storage write fails.
- Backup import is malformed.
- Skill permission check fails.
- Provider API key is locked or missing.

In these cases, do not silently continue.

### 2. No hidden fallback behavior

Fallbacks must be explicit, visible, and preferably developer-only.

Disallowed default behavior:

- falling back from WASM runtime to TypeScript reference runtime;
- falling back from unknown provider to mock provider;
- ignoring missing effect handlers;
- converting provider errors into normal assistant text;
- seeding fake audit or memory data into real stores;
- defaulting invalid skill metadata to `untitled-skill`;
- skipping malformed backup collections.

Allowed behavior:

- explicit demo mode;
- explicit mock provider selected by the user/developer;
- explicit dev-only reference runtime mode;
- clear setup prompt when no provider is configured;
- visible error card with retry/fix actions.

### 3. Durable truth belongs in IndexedDB/OPFS

Redux is the UI/runtime control plane. It is not the durable database.

Durable data must live in IndexedDB/OPFS:

- conversations;
- messages;
- memories;
- provider profiles;
- encrypted secrets;
- skills;
- skill files;
- skill state;
- audit events;
- runtime snapshots;
- model catalog/cache index;
- backup history;
- app settings.

Redux may mirror recent or selected records, but reload must restore durable state.

### 4. Secrets must stay out of Redux, logs, and audit payloads

Decrypted secrets must only live in the in-memory SecretVault.

Never place decrypted API keys or OAuth tokens in:

- Redux state;
- Redux DevTools;
- console logs;
- audit event payloads;
- runtime snapshots;
- backup files except encrypted blobs explicitly selected by the user;
- localStorage;
- URL query strings;
- error messages.

### 5. Audit log must be truthful

Audit events must represent real actions and real failures.

The app must not create fake audit events outside an explicit demo mode.

All meaningful events should be persisted to IndexedDB:

- runtime initialized;
- runtime failed;
- LLM request started/succeeded/failed;
- provider test succeeded/failed;
- tool call proposed;
- tool call approved/rejected/edited;
- tool executed/succeeded/failed;
- storage write succeeded/failed;
- memory created/updated/deleted;
- skill installed/enabled/disabled/rejected;
- secret unlocked/locked;
- backup exported/imported/failed;
- model download started/progress/completed/failed;
- WASM runtime loaded/failed;
- reference runtime used, only if explicit dev mode.

### 6. The UI must not lie

If a control is displayed, it should either:

- work;
- be disabled with a reason;
- be explicitly marked as future/placeholder.

Avoid UI that appears complete but only updates local component state.

## Required Architectural Changes

## 1. Runtime Startup

### Current Problem

The app silently falls back from the Rust/WASM runtime to the TypeScript reference runtime if WASM fails to load.

### Required Behavior

Default behavior:

- Attempt to load Rust/WASM runtime.
- If load succeeds:
  - dispatch runtime loaded event;
  - append durable audit event;
  - continue.
- If load fails:
  - set runtime status to `error`;
  - show blocking runtime error banner/card;
  - append durable audit failure;
  - do not silently continue with TypeScript reference runtime.

Developer behavior:

- A reference runtime fallback may exist only when an explicit environment flag is enabled:

```text
VITE_ALLOW_REFERENCE_RUNTIME_FALLBACK=true
```

If this flag is enabled and fallback is used:

- display a persistent yellow warning banner;
- append audit event `runtime.reference_fallback_used`;
- show runtime mode as `Reference runtime`, not `WASM`.

### Acceptance Criteria

- WASM load failure blocks normal runtime in production/default mode.
- No user can unknowingly run the reference runtime.
- Tests verify default fail-closed behavior.
- Tests verify explicit dev fallback behavior only when flag is set.

## 2. Runtime Effect Execution

### Current Problem

Effect ports are optional and missing ports no-op silently.

### Required Behavior

Effect execution must be fail-closed.

Every effect must have:

- a registered handler;
- a success result or an explicit error result;
- an audit event;
- a runtime state transition.

Effect handling rules:

- `llm_request` requires LLM provider handler.
- `storage_get`, `storage_put`, `storage_search` require storage handler.
- `skill_fs_read_text`, `skill_state_get`, `skill_state_put` require skill handler.
- `audit_append` requires audit handler.
- unknown effect types are fatal runtime errors.
- missing handler is fatal runtime error.

### Required Error Shape

Use a normalized error result:

```ts
type RuntimeEffectError = {
  ok: false;
  error: {
    kind:
      | 'missing_handler'
      | 'unknown_effect'
      | 'provider_error'
      | 'storage_error'
      | 'skill_error'
      | 'permission_denied'
      | 'validation_error'
      | 'runtime_error';
    message: string;
    retryable: boolean;
    details?: Record<string, unknown>;
  };
};
```

### Acceptance Criteria

- Missing effect handler cannot be ignored.
- Unknown effect cannot be ignored.
- Every failed effect appends a durable audit event.
- UI shows failed effect state.
- Runtime does not incorrectly transition as if effect succeeded.

## 3. Provider System

### Current Problem

Unknown or missing providers fall back to the mock provider. Provider UI settings are not durably wired. Provider failures are converted into assistant messages.

### Required Behavior

Provider selection must be explicit.

Provider types:

- `mock`, dev/demo only;
- `openai`;
- `anthropic`;
- `openai-compatible`;
- `ollama`;
- `llama-server`;
- `wllama`.

Provider profile records must be stored in IndexedDB.

Example:

```ts
type ProviderProfile = {
  id: string;
  kind:
    | 'mock'
    | 'openai'
    | 'anthropic'
    | 'openai-compatible'
    | 'ollama'
    | 'llama-server'
    | 'wllama';
  displayName: string;
  baseUrl?: string;
  model: string;
  enabled: boolean;
  secretRef?: string;
  secretMode?: 'none' | 'session' | 'encrypted';
  corsStatus?: 'unknown' | 'ok' | 'blocked';
  lastTest?: {
    ok: boolean;
    at: string;
    latencyMs?: number;
    errorKind?: string;
    message?: string;
  };
};
```

### Provider Resolution Rules

- If no active provider exists:
  - block chat;
  - show setup prompt;
  - do not use mock.
- If active provider ID is unknown:
  - show configuration error;
  - do not use mock.
- Mock provider may run only if:
  - provider kind is explicitly `mock`; and
  - demo/dev mode is enabled or user explicitly selected mock mode.

### Provider Error Handling

Provider errors must remain errors.

Do not convert provider failures into normal assistant messages.

Instead:

- dispatch provider failure;
- append audit event;
- resolve runtime effect with error;
- show error card in chat;
- keep retry/fix action available.

### CORS Handling

Normalize browser/network failures as specifically as possible:

- CORS/preflight blocked;
- endpoint unreachable;
- auth failed;
- model not found;
- invalid response;
- timeout;
- rate-limited.

If exact CORS detection is not reliable, use:

```text
browser_request_failed_possible_cors
```

and explain possible causes in UI.

### Acceptance Criteria

- No implicit mock fallback.
- Models page persists edited provider settings.
- Provider tests use persisted settings, not hardcoded presets.
- Provider calls use persisted profile and SecretVault secrets.
- Provider failures do not create fake assistant responses.

## 4. SecretVault Integration

### Current Problem

SecretVault exists but is not fully wired into provider setup and runtime calls.

### Required Behavior

The Models/Settings UI must support:

- session-only API key;
- encrypted stored API key;
- deleting stored key;
- lock/unlock;
- provider test using unlocked key;
- runtime LLM request using unlocked key.

Secret flow:

1. User enters API key.
2. User chooses:
   - session-only; or
   - encrypted stored key.
3. If encrypted:
   - user provides passphrase;
   - key is encrypted with Web Crypto;
   - encrypted blob is persisted to IndexedDB.
4. During provider call:
   - runtime asks provider adapter;
   - provider adapter requests secret from SecretVault by `secretRef`;
   - if locked/missing:
     - provider call fails with `secret_locked` or `secret_missing`;
     - UI prompts user to unlock/enter key.
5. Decrypted key never enters Redux.

### Acceptance Criteria

- Provider profile can reference `secretRef`.
- Provider test can use SecretVault key.
- Runtime LLM request can use SecretVault key.
- Locked key produces visible unlock prompt.
- Tests prove raw key is absent from Redux state and audit payload.

## 5. Audit Persistence

### Current Problem

Audit is a Redux-only recent feed and screens seed fake events.

### Required Behavior

Audit events must be persisted to IndexedDB.

Audit service API:

```ts
appendAuditEvent(event: AuditEventInput): Promise<AuditEvent>
queryAuditEvents(filter: AuditFilter): Promise<AuditEvent[]>
getAuditEvent(id: string): Promise<AuditEvent | undefined>
exportAuditCsv(filter: AuditFilter): Promise<Blob>
```

Audit event shape:

```ts
type AuditEvent = {
  id: string;
  timestamp: string;
  type: string;
  source: 'user' | 'runtime' | 'provider' | 'storage' | 'skill' | 'backup' | 'model' | 'system';
  conversationId?: string;
  providerId?: string;
  skillId?: string;
  toolName?: string;
  risk: 'low' | 'medium' | 'high' | 'critical';
  status: 'success' | 'failure' | 'pending' | 'rejected';
  summary: string;
  details?: Record<string, unknown>;
};
```

Sensitive data redaction:

- no raw prompt content by default unless explicitly allowed;
- no raw API keys;
- no decrypted secrets;
- no full uploaded document content;
- no unredacted Authorization headers.

### Acceptance Criteria

- No fake audit seeding outside explicit demo mode.
- Audit screen reads from Dexie.
- Every meaningful runtime/provider/storage/skill/backup event is persisted.
- Audit filters operate against durable data.
- CSV export exports real audit data only.

## 6. Memory Persistence and Demo Data

### Current Problem

Memory screen seeds sample fake memories into the real memory store.

### Required Behavior

No sample memory seeding into real stores unless explicit demo mode is enabled.

Memory source must be truthful:

- user-created;
- agent-created after approval;
- imported backup;
- explicit demo data.

Memory filters must work:

- tags;
- source;
- created by;
- sensitivity;
- pinned;
- date range if present.

Provenance must show:

- source conversation/message where available;
- created by;
- created at;
- last used at;
- skill/tool source if applicable.

### Acceptance Criteria

- New app with no memories shows empty state, not fake memories.
- Demo data requires explicit demo mode.
- Filters actually filter.
- Memory writes require approval unless policy allows otherwise.
- Retrieval events update retrieval history and audit log.

## 7. Runtime Snapshots

### Current Problem

Snapshot save/load exists but is not automatically used during normal operation.

### Required Behavior

Runtime snapshots must be persisted during normal runtime operation.

Triggers:

- after user message accepted;
- after each effect emitted;
- after each effect resolved;
- after runtime enters idle/error/waiting state;
- before page unload where possible.

Snapshot record:

```ts
type RuntimeSnapshotRecord = {
  id: string;
  conversationId?: string;
  runtimeVersion: string;
  createdAt: string;
  stateJson: string;
};
```

Restore flow:

- load latest compatible snapshot on app start;
- if incompatible:
  - append audit warning;
  - start fresh runtime;
  - do not crash silently.
- if corrupted:
  - preserve corrupted record for diagnostics;
  - show visible warning;
  - start fresh only after user confirmation or safe fallback policy.

### Acceptance Criteria

- Reload restores current conversation/runtime state.
- Snapshot save failures are visible and audited.
- Snapshot incompatibility is visible and audited.

## 8. Backup / Restore Hardening

### Current Problem

Backup import validation is too weak and can bulk-write arbitrary collections.

### Required Behavior

Backup import must be schema-validated and fail closed.

Backup archive format:

```text
browserclaw-backup.clawbackup
├── manifest.json
├── collections/
│   ├── conversations.jsonl
│   ├── messages.jsonl
│   ├── memories.jsonl
│   ├── skills.jsonl
│   ├── skill_files.jsonl
│   ├── skill_state.jsonl
│   ├── provider_profiles.jsonl
│   ├── encrypted_secrets.jsonl
│   ├── audit_events.jsonl
│   ├── app_settings.jsonl
│   └── model_catalog.jsonl
└── model_refs.json
```

If current implementation remains JSON-based for now, it must still enforce:

- known format;
- schema version compatibility;
- allowed collection names only;
- required row fields;
- row count limits;
- record size limits;
- total import size limits;
- conflict preview;
- import transaction;
- rollback on failure;
- explicit replace/merge strategy;
- no silent skipped collections.

### Import Validation

Reject backup if:

- unknown top-level format;
- missing manifest;
- unsupported schema version;
- unknown collection;
- collection value has wrong shape;
- row validation fails;
- encrypted secrets are included but user declines secret import;
- backup appears to contain raw decrypted secrets.

### Backup Encryption

Local export may be plaintext only if clearly labeled.

If UI says “encrypted backup,” implement encryption.

Required modes:

- plaintext local export with warning;
- encrypted export with passphrase, preferred.

### Acceptance Criteria

- Malformed backup fails with clear error.
- Unknown collections fail.
- Invalid rows fail.
- Replace/merge strategy is honored.
- Import runs transactionally.
- Backup history records only actual completed exports/imports.
- Browser download failure does not record success.

## 9. Skills and Skill Filesystem Hardening

### Current Problem

Skill metadata defaults invalid skills to `untitled-skill`. Skill permissions can be influenced via mutable skill state. Enable/disable may audit success even if no skill was updated.

### Required Behavior

Skill import must validate strictly.

Required `SKILL.md` frontmatter:

```yaml
name: summarize-pdf
description: Summarize PDF documents
version: 1.0.0
```

Rules:

- missing required fields = reject import;
- invalid name = reject import;
- unsupported version = reject or warn with explicit user approval;
- unknown permissions = reject or require review;
- imported skill starts disabled unless user explicitly enables it;
- install requires permission review.

Skill filesystem:

- package files are read-only;
- skill state is private;
- system-reserved keys cannot be written by skills;
- permissions cannot be stored in mutable skill state;
- permissions must live in immutable skill install metadata or separate protected store;
- path traversal must be blocked;
- encoded traversal must be blocked;
- absolute paths must be blocked;
- null bytes and weird path separators must be blocked.

Reserved keys:

```text
__permissions__
__manifest__
__system__
__audit__
__secrets__
```

Skill reinstall:

- clear old package files not present in new package;
- preserve skill state only if user selects preserve;
- audit reinstall outcome.

Skill enable/disable:

- fail if skill does not exist;
- audit only after successful update;
- UI reflects failure.

### Acceptance Criteria

- Invalid skill is rejected, not defaulted.
- Skills cannot modify permissions through state.
- Reinstall removes stale files.
- Enable/disable missing skill fails visibly.
- Permission enforcement occurs at runtime/tool execution, not only in UI display.

## 10. wllama and Browser-Local Model Hardening

### Current Problem

wllama WASM may be fetched from a CDN. Large GGUF handling is not robust. Model queue controls are incomplete.

### Required Behavior

wllama runtime assets must be controlled.

Preferred:

- bundle/vendor wllama runtime assets with the app; or
- pin exact version and integrity-check remote assets; or
- require explicit user consent for CDN runtime loading.

Model weights may still be downloaded from Hugging Face.

Model download manager must:

- track actual download progress;
- handle cancellation;
- handle quota errors before and during download;
- support delete cache;
- support load/unload status;
- reject unsupported file sizes/runtime combos with clear warning;
- audit model download/load/delete events.

Provider status:

- wllama unavailable;
- model not downloaded;
- model loading;
- model loaded;
- model failed;
- quota insufficient;
- browser feature unsupported.

### Acceptance Criteria

- wllama provider cannot appear connected unless runtime and model are loaded.
- CDN runtime loading is eliminated or explicitly acknowledged.
- Model actions produce truthful status and audit events.
- Quota failure produces visible error and does not corrupt cache metadata.

## 11. Onboarding and Settings Persistence

### Current Problem

Onboarding and many settings are local UI state only.

### Required Behavior

Onboarding completion and choices must persist to IndexedDB.

Persist:

- onboarding completed;
- selected inference mode;
- active provider ID;
- selected/default model;
- storage persistence request result;
- demo mode flag;
- security settings;
- approval policy.

Settings screen must read/write durable app settings.

Top status bar must use durable/current provider and storage state.

Settings button must navigate to `/settings`.

### Acceptance Criteria

- Refresh does not reset onboarding.
- Onboarding selected provider becomes active provider.
- Settings persist through reload.
- Top bar status matches actual active provider/model.
- Settings controls either work or are disabled/marked future.

## 12. UI Honesty and Placeholder Policy

### Required Behavior

Any unimplemented control must be:

- hidden;
- disabled with explanatory tooltip; or
- marked “Coming later.”

Do not show fake working controls.

Examples:

- Pause model download if not implemented: disable and label “Pause not implemented yet.”
- Google Drive: show “Coming later.”
- Workflow editor: do not show until implemented.
- Provider profile editing: if shown, it must persist.

### Acceptance Criteria

- User-visible controls are audited and functional, or clearly marked future.
- No action button silently does nothing.

## 13. QA Requirements

Tests must prove real behavior, not demo fallback behavior.

Required tests:

### Runtime

- WASM failure blocks in default mode.
- WASM failure uses reference runtime only with explicit dev flag.
- Missing effect handler produces runtime error.
- Unknown effect produces runtime error.
- Provider error resolves as error, not assistant message.

### Provider

- Unknown provider fails.
- No provider configured blocks chat.
- Mock provider works only when explicitly configured.
- Provider profile persisted edits affect provider test.
- Locked SecretVault key blocks provider call with unlock prompt.
- Raw key never appears in Redux.

### Audit

- Audit events persist to Dexie.
- Audit screen does not seed fake events.
- Failed provider call creates failure audit.
- Failed backup import creates failure audit.

### Backup

- Unknown collection rejected.
- Invalid row rejected.
- Import transaction rolls back on failure.
- Export history records only successful export.
- Encrypted export/import works if implemented.

### Skills

- Missing required skill metadata rejected.
- Path traversal rejected.
- Encoded traversal rejected.
- Reserved state keys rejected.
- Skill cannot alter permissions.
- Reinstall clears stale package files.
- Missing skill enable/disable fails.

### Memories

- No fake seeded memories.
- Filters work.
- Provenance persists.
- Retrieval history records actual retrieval.

### UI

- Settings button navigates.
- Onboarding persists.
- Models form persists provider profile.
- Placeholder controls are disabled or labeled.

## Migration Notes

Existing demo data should not be silently deleted. If the current app has seeded fake data in a developer environment, add a one-time migration that:

- detects records marked as demo/sample;
- removes them only if safe; or
- labels them as demo and asks user to delete.

If sample records lack a demo marker, do not automatically delete user data. Instead, stop creating new fake records and provide a cleanup command/manual migration for development databases.

## Completion Definition

This hardening pass is complete only when:

- default app has no hidden fallback behavior;
- provider configuration is durable;
- secrets are wired but never leaked;
- audit is durable and truthful;
- runtime snapshots persist;
- backup import is schema-validated and transactional;
- skills are strictly validated and capability-enforced;
- model provider status is truthful;
- screens persist their settings;
- tests enforce the above behavior.

