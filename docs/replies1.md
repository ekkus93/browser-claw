# Replies to Claude Code — Hardening Spec/TODO Round 1

These are the answers to the questions/issues in `responses1(24).md`.

Bottom line: the implementation agent’s review is fair. The hardening spec direction remains correct, but a few items should be sized and ordered more precisely before implementation starts.

The most important rule remains:

> Do not hide broken behavior behind fallbacks, demo data, or mock responses. If the app cannot do the real thing, show the user the truth and fail visibly.

---

## High-level response

Yes, the hardening pass is intentionally larger than the previous UI scaffold pass. The current app has many of the right files and screens, but it is still too optimistic and too quiet when something fails.

The next implementation pass should prioritize:

1. unsafe fallback removal;
2. security and secret-leak regression tests;
3. provider resolution and SecretVault wiring;
4. durable, truthful audit logging;
5. skill permission hardening;
6. backup/restore validation;
7. snapshot persistence;
8. UI persistence/honesty cleanup.

Do not start by polishing UI screens. Start by making the app fail closed and report real failures.

---

# Q1. Execution model and ordering

## Decision

Use a **Ralph loop** style implementation:

```text
one bounded task
→ implement
→ run full available gate
→ fix regressions
→ commit
→ move to next bounded task
```

But do **not** blindly follow the original phase order. Reprioritize so the security-critical and correctness-critical issues land first.

## Required implementation order

Use this order:

### Pass 1 — Safety foundation

1. Add explicit mode/config policy:
   - `isDemoMode`;
   - `isDevFallbackAllowed`;
   - `isMockProviderAllowed`;
   - environment flag parsing;
   - visible demo/fallback banner.

2. Add regression tests for forbidden defaults:
   - no reference runtime fallback by default;
   - no implicit mock provider;
   - no missing effect-handler no-op;
   - no fake audit/memory seeding;
   - no raw secrets in Redux/logs/audit.

This gives us a safety net before changing behavior.

### Pass 2 — Fail-closed runtime/provider behavior

3. Remove implicit WASM → reference runtime fallback.
4. Remove implicit mock-provider fallback.
5. Make missing effect handlers fatal.
6. Stop converting provider failures into normal assistant messages.

These are the biggest “lying app” behaviors.

### Pass 3 — Durable audit minimum

7. Build the durable audit service.
8. Wire minimum critical audit events:
   - runtime load/failure;
   - fallback mode used;
   - provider test success/failure;
   - provider call success/failure;
   - effect failure;
   - secret unlock/lock;
   - skill install/enable/disable failure;
   - backup import/export failure.

Do not wait until every possible audit event is wired before continuing. Get the durable service in place early, then add more event types as features are hardened.

### Pass 4 — Provider profiles + SecretVault

9. Make provider profiles durable.
10. Wire Models UI to persisted provider profiles.
11. Wire SecretVault into provider tests and runtime provider calls.
12. Implement locked/missing secret failure UX.

### Pass 5 — Skill permission hardening

13. Move permissions out of mutable skill state.
14. Block reserved keys.
15. Strictly validate imported skills.
16. Harden path validation.
17. Make enable/disable/reinstall truthful.

This is security-critical and should happen before less critical UI persistence work.

### Pass 6 — Fake data removal

18. Remove fake audit seeding.
19. Remove fake memory seeding.
20. Add honest empty states.
21. Optionally support explicitly marked demo mode.

### Pass 7 — Backup/restore hardening

22. Keep current JSON format for this pass.
23. Add allowlist, row validation, version validation, preview, transaction, rollback, and conflict strategy.
24. Fix backup history so only real successful exports/imports are recorded.

### Pass 8 — Snapshot persistence

25. Wire snapshot triggers.
26. Coalesce snapshot writes.
27. Add corrupted/incompatible snapshot handling.

### Pass 9 — wllama hardening

28. Stop silent CDN runtime loading by default.
29. Make model download/cache status truthful.
30. Implement or disable pause/cancel actions.

### Pass 10 — UI persistence and honesty

31. Persist onboarding.
32. Persist settings.
33. Persist Models form edits.
34. Wire top bar controls.
35. Disable or label unimplemented controls.

### Pass 11 — Full QA pass

36. Run the full available gate.
37. Update docs and TODO checkboxes only after verified behavior.

## Rationale

This gets the dangerous behavior out first. UI persistence is important, but a pretty UI around unsafe runtime/provider/skill behavior is the wrong priority.

---

# Q2. Audit event shape conflict and schema migration

## Decision

Use a **reconciled shape**, not the original spec shape verbatim.

Keep `at: number` as the canonical persisted timestamp for IndexedDB range queries and sorting. The implementer is right that this is better than ISO strings as the indexed primary time field.

Add the new fields from the spec.

## Canonical durable audit event type

Use this as the new durable shape:

```ts
export type AuditRisk = 'info' | 'low' | 'medium' | 'high' | 'critical';

export type AuditStatus =
  | 'success'
  | 'failure'
  | 'pending'
  | 'rejected'
  | 'cancelled';

export type AuditSource =
  | 'user'
  | 'runtime'
  | 'provider'
  | 'storage'
  | 'skill'
  | 'backup'
  | 'model'
  | 'system';

export type AuditEventRow = {
  id: string;

  // Canonical IndexedDB-sortable timestamp.
  at: number;

  // Optional derived convenience field is allowed but not required.
  // UI/export can derive new Date(at).toISOString().
  timestamp?: string;

  type: string;
  source: AuditSource;
  risk: AuditRisk;
  status: AuditStatus;
  summary: string;

  conversationId?: string;
  providerId?: string;
  skillId?: string;
  toolName?: string;
  modelId?: string;
  effectId?: string;
  runId?: string;

  details?: Record<string, unknown>;

  // Optional marker for demo/dev records only.
  demo?: boolean;
};
```

## Risk enum decision

Use:

```ts
'info' | 'low' | 'medium' | 'high' | 'critical'
```

Reason:

- `info` is useful for purely informational lifecycle events, such as runtime loaded or settings changed.
- `critical` is useful for severe failures, such as secret exposure prevention, failed security invariant, malformed restore attack, or impossible runtime state.
- Keeping both avoids forcing every non-risk event into `low`.

## Migration decision

Add a Dexie schema migration.

Migration rules:

- Existing rows with `at` keep their numeric timestamp.
- Existing rows without `source` get `source: 'system'` or best inferred source.
- Existing rows without `status` get `status: 'success'` only if they represent an already completed event; otherwise use `status: 'pending'`.
- Existing rows with old `risk: 'info'` remain `info`.
- Existing rows without `details` get `{}` or undefined.
- Do not invent sensitive details.

## UI/export decision

The Audit screen can display ISO strings, but derive them from `at`.

CSV export can include both:

```text
at,timestamp,type,source,risk,status,summary
```

where `timestamp = new Date(at).toISOString()`.

---

# Q3. WASM fail-closed severity

## Decision

Use **hard block by default**.

If Rust/WASM fails to load in default mode:

- chat must not run;
- runtime status must become `error`;
- the app must show a blocking runtime error card;
- an audit failure must be persisted if the audit service is available;
- the app must not silently switch to the TypeScript reference runtime.

## Reference runtime policy

The TypeScript reference runtime is allowed only in explicit dev/demo mode.

Supported mechanisms:

```text
VITE_ALLOW_REFERENCE_RUNTIME_FALLBACK=true
```

Optionally also:

```text
VITE_DEMO_MODE=true
```

If the reference runtime is used:

- show a persistent yellow warning banner;
- show runtime mode as `Reference runtime`;
- append `runtime.reference_fallback_used`;
- make it obvious that this is not the production runtime.

## No normal runtime opt-in fallback

Do **not** add a normal-user “continue with reference runtime” button in production/default mode.

Reason:

The whole point of this hardening pass is to stop the app from quietly behaving differently than expected. A runtime opt-in button could be added later as a carefully designed troubleshooting feature, but not in this pass.

For older or locked-down browsers where WASM is unavailable, the honest behavior is:

```text
BrowserClaw requires the Rust/WASM runtime. This browser could not load it.
```

Then show diagnostic details and supported-browser guidance.

---

# Q4. Backup format

## Decision

For this pass, **keep the current single-JSON backup format and harden it**.

Do not migrate to the `.clawbackup` archive format yet.

## Reason

The archive format is the better long-term design, but migrating now adds scope and risks breaking any existing exported backups.

This hardening pass should focus on:

- validation;
- allowlisting;
- preview;
- transaction;
- rollback;
- conflict strategy;
- accurate history;
- no silent skips.

## Required current-format hardening

Keep the current structure approximately like:

```ts
type BrowserClawBackup = {
  manifest: {
    format: 'browserclaw-backup';
    version: number;
    appVersion?: string;
    createdAt: string;
  };
  collections: Record<string, unknown[]>;
};
```

But enforce:

- allowed collection names only;
- per-collection row validators;
- schema version compatibility;
- row count limits;
- record size limits;
- total import size limit;
- conflict preview;
- explicit merge/replace strategy;
- transaction;
- rollback on failure;
- no silent skipped collections.

## Archive format status

Add a future TODO/note:

```text
Future backup v2 may move to .clawbackup archive format:
manifest.json + collections/*.jsonl + model_refs.json
```

But do not implement that in this pass.

---

# Q5. Snapshot trigger frequency

## Decision

Yes, coalescing/debouncing is acceptable and preferred.

Do **not** write to IndexedDB literally after every tiny transition if that causes excessive writes.

## Required behavior

Implement a snapshot scheduler with these semantics:

- mark runtime snapshot dirty after:
  - user message accepted;
  - effect emitted;
  - effect resolved;
  - runtime idle;
  - runtime error.
- coalesce writes with a short debounce, for example 250–1000 ms.
- flush immediately on:
  - runtime idle;
  - runtime error;
  - before unload/pagehide when possible;
  - explicit app shutdown/reset.
- never silently drop snapshot save failures.

## Acceptance target

The app does not need a snapshot for every micro-transition. It needs reliable recovery to the latest settled or near-settled runtime state.

## Audit policy

Do not spam the audit log for every successful debounced snapshot save. Instead:

- audit snapshot restore success/failure;
- audit snapshot save failure;
- optionally audit snapshot saved in debug/dev mode only.

---

# Q6. Cleanup of already-seeded sample data

## Decision

Yes, delete the known fixed sample memory IDs as a one-time migration.

Because the sample memories were written by the app itself with known fixed IDs, deleting exactly those IDs is reasonable.

## Rules

Delete only the exact known sample IDs, for example:

```text
mem-1
mem-2
mem-3
...
```

Only if their contents still match the known sample titles/summaries closely enough to avoid deleting user-edited records.

Recommended safety check:

```ts
const knownSample = row.id === 'mem-1'
  && row.title === 'Rust/WASM architecture overview'
  && row.createdBy === 'agent'
  && row.source looks like the seeded sample source;
```

If the ID matches but content has been edited, do not delete automatically. Instead:

- mark as possible sample;
- show cleanup option; or
- leave it alone.

## For audit sample data

Audit sample data was Redux-only according to Claude Code’s review, so there is no durable cleanup needed unless some other path persisted it.

Remove the fake Audit screen seeding and show an empty state.

## Future demo data

If demo data remains useful:

- gate it behind explicit demo mode;
- mark records with `demo: true`;
- show demo banner;
- provide “Clear demo data.”

---

# Q7. Provider error taxonomy

## Decision

Yes. Extend the existing `ProviderError` taxonomy and map it into the effect-error shape.

Do **not** maintain two unrelated error vocabularies.

## Layering

Use provider-level errors for provider adapters:

```ts
type ProviderErrorKind =
  | 'cors_blocked'
  | 'browser_request_failed_possible_cors'
  | 'unreachable'
  | 'timeout'
  | 'auth_failed'
  | 'rate_limited'
  | 'model_not_found'
  | 'invalid_request'
  | 'invalid_response'
  | 'secret_locked'
  | 'secret_missing'
  | 'provider_not_configured'
  | 'unknown_provider'
  | 'internal';
```

Then wrap provider errors in runtime effect errors:

```ts
type RuntimeEffectError = {
  ok: false;
  error: {
    kind: 'provider_error';
    providerKind: ProviderErrorKind;
    message: string;
    retryable: boolean;
    details?: Record<string, unknown>;
  };
};
```

For non-provider failures, use the effect-level categories:

```ts
'missing_handler'
'unknown_effect'
'storage_error'
'skill_error'
'permission_denied'
'validation_error'
'runtime_error'
```

## UI behavior

The UI should display the provider-specific kind when it helps the user:

- `auth_failed`: ask user to check/unlock API key.
- `model_not_found`: ask user to check model name.
- `browser_request_failed_possible_cors`: explain CORS/network ambiguity.
- `secret_locked`: show unlock action.
- `provider_not_configured`: show setup action.

## Audit behavior

Audit both levels when useful:

```ts
type: 'provider.request.failed'
details: {
  effectKind: 'provider_error',
  providerKind: 'auth_failed',
  providerId: 'openai-main'
}
```

Never include secrets or Authorization headers.

---

# Smaller corrections to TODO

## Use pnpm, not npm

Agreed. The QA commands should be updated to use `pnpm`.

Replace:

```text
npm run typecheck
npm run lint
npm run test
```

with:

```text
pnpm run typecheck
pnpm run lint
pnpm run test
```

If the repo has a zero-warning lint gate, keep it.

## Add extended e2e suite

Agreed. Add:

```text
pnpm run test:e2e:extended
```

if present.

Because this suite may require real WASM, real wllama, browser features, and/or network model downloads, it should be treated as a hardening gate where practical, but failures due to missing local prerequisites must be documented clearly.

Recommended QA list:

```text
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run test:e2e
pnpm run test:e2e:extended
cargo test
cargo clippy
```

If any command cannot run, document:

- command;
- reason;
- environment requirement;
- whether this blocks acceptance.

## `runtime_snapshot_save` handler timing

Agreed. Register the snapshot handler before making missing handlers fatal for any runtime path that can emit that effect.

If the reference runtime does not emit `runtime_snapshot_save` yet, that is fine. But the handler must exist in the effect handler registry before we enforce fail-closed behavior globally.

Implementation order inside Phase 1.2:

1. define effect handler registry;
2. register handlers for current effect set;
3. register snapshot handler stub/real implementation;
4. add fail-closed missing-handler check;
5. add tests.

---

# Additional clarifications for implementation

## Audit service sizing

Claude Code is right that durable audit is a large subsystem, not a small cleanup.

Treat it as its own bounded subsystem:

```text
Audit Service MVP:
- durable append;
- query by filters;
- recent feed mirror to Redux;
- Audit screen reads durable data;
- fake seeding removed;
- critical events wired.

Audit Service Full:
- all event types wired;
- CSV export;
- summary/risk metrics;
- redaction tests;
- retention/export polish.
```

The MVP should land early. The full event coverage can be completed across later phases.

## SecretVault sizing

Claude Code is right that the vault already exists. Do not rebuild it from scratch.

Scope should be:

- provider profile references `secretRef`;
- Models UI can create/update/delete secrets;
- provider tests retrieve secrets;
- runtime LLM requests retrieve secrets;
- locked/missing secret states are surfaced;
- tests prove no raw key leakage.

## Skill path traversal sizing

Claude Code is right that there is already a basic `..` guard. This is a hardening task, not a from-zero implementation.

Still required:

- normalize before checking;
- reject encoded traversal;
- reject absolute paths;
- reject null bytes;
- reject backslashes as traversal separators;
- reject reserved state keys;
- move permissions out of mutable skill state.

## Runtime snapshot sizing

Claude Code is right that snapshot save already exists. The task is wiring and policy.

Required:

- snapshot scheduler;
- restore compatibility/corruption handling;
- visible/audited failure;
- reload tests.

---

# Final implementation directive

Proceed with the hardening pass using Ralph-loop commits, but reorder the work to land security-critical and correctness-critical fixes first.

Canonical decisions:

```text
Q1: Ralph loop, security-critical ordering first.
Q2: Reconciled audit schema; keep numeric `at`; risk enum includes info and critical.
Q3: Hard block on WASM failure by default; reference runtime only behind explicit dev/demo flag.
Q4: Keep current single-JSON backup format for this pass; harden validation/transaction/preview.
Q5: Coalesce/debounce snapshots; flush on idle/error/pagehide.
Q6: Delete known fixed sample memory IDs safely via one-time migration if content still matches.
Q7: Extend existing ProviderError taxonomy and wrap into RuntimeEffectError.
```

The most important implementation standard:

> A user should never believe BrowserClaw successfully used the real runtime, real provider, real audit log, real memory store, or real skill permissions when it actually used a mock, fallback, no-op, or seeded demo path.
