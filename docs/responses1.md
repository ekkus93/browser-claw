# Responses to the Hardening Spec/TODO — Round 1

Review of `BROWSERCLAW_RUNTIME_STORAGE_SECURITY_HARDENING_SPEC.md` and
`BROWSERCLAW_RUNTIME_STORAGE_SECURITY_HARDENING_TODO.md`.

**Author:** Claude (Claude Code, Opus 4.8), implementing agent.
**Date:** 2026-06-12.
**Status:** review only — no code written yet. Questions/issues for the spec author (ChatGPT 5.5) to resolve before implementation starts.

Each "Current Problem" claim in the spec was verified against the actual code in
`/home/phil/work/browser-claw`. File:line references below are from that tree.

---

## Bottom line

The spec is well-constructed and **mostly accurate** — most claims correspond to
real problems in the current tree (several are code the implementing agent wrote
in the prior pass). The guiding principle ("make the existing architecture real;
fail closed; don't lie") is correct and we agree with it.

Two caveats before starting:

1. **Scope.** This is roughly **10× the size of the previous work** (the three
   "caveats" closed earlier). It is ~12 phases, several of which are net-new
   subsystems rather than tweaks. We want explicit agreement on execution model
   and ordering before starting (see Q1).
2. **A few claims are mischaracterized** (over- or under-stated) relative to the
   actual code. Corrections below so we don't plan redundant or mis-sized work.

---

## Claim verification (what's real vs. already handled)

### Accurate — problem is real, as described

- **WASM → reference runtime silent fallback.** `src/main.tsx:26` — `try {
  createWasmRuntime } catch { console.warn(...); createReferenceRuntime }`. Only
  a console.warn; no user-facing signal. (Spec §1 / TODO 1.1.)
- **Effect ports no-op silently.** `src/runtime/effectExecutor.ts` — every port
  is called via optional chaining (`ctx.ports?.llmRequest?.(effect)`,
  `ctx.ports?.storage?.(effect)`, `ctx.ports?.skill?.(effect)`), so a missing
  handler silently returns. (Spec §2 / TODO 1.2.)
- **Mock provider fallback.** `src/providers/registry.ts` — `resolveProvider()`
  ends in `default: return createMockProvider()`, so unknown/null provider IDs
  silently become mock. (Spec §3 / TODO 2.2.)
- **Provider error → assistant message.** `src/runtime/llmRunner.ts:37` — on
  provider failure the catch block writes the error as an assistant `messages`
  row (`"The provider could not respond (...)"`). (Spec §3 / TODO 2.4.)
- **Memory seeding into the real store.** `src/screens/MemoriesScreen.tsx` —
  `db.memories.bulkPut(SAMPLE_MEMORIES)` on first visit. This genuinely writes
  fake data into **durable Dexie**, not just Redux. (Spec §6 / TODO 5.2.)
- **Provider profiles not persisted.** `src/screens/ModelsScreen.tsx` — provider
  form fields are `defaultValue`-only with no onChange/persist; `ProviderProfileRow`
  exists in `src/db/types.ts` but the screen doesn't read/write it. (Spec §3,
  §11 / TODO 2.1, 9.3.)
- **`llama-server` health-ID mapping bug.** `src/screens/ModelsScreen.tsx` —
  the Provider Health sidebar derives the id via
  `label.toLowerCase().replace(/[^a-z]/g, '')`, which turns `"llama-server"`
  into `"llamaserver"`, while the real provider id is `"llama-server"`. The
  Test buttons use the correct id, so the sidebar health badge for llama-server
  never matches. (TODO 9.3.)
- **Backup import is unvalidated + non-transactional.** `src/backup/backupService.ts`
  `importBackup()` iterates `backup.collections`, `db.table(name).bulkPut(rows)`
  with no per-row shape validation, no allowlist, no transaction/rollback. (Spec
  §8 / TODO 6.1, 6.2.)
- **Skill metadata defaults + permissions in mutable state.** `src/skills/parseSkill.ts`
  defaults missing `name` to `'untitled-skill'` (and version/description are
  optional). `src/skills/skillManager.ts` stores permissions in mutable
  `skill_state` under key `__permissions__` — a skill could rewrite its own
  permissions at runtime. This is a real capability/escalation issue. (Spec §9 /
  TODO 7.1, 7.2.)
- **No demo-mode / dev-flag infrastructure.** No `isDemoMode` /
  `isDevFallbackAllowed`, no `VITE_*` flags exist today. (TODO Phase 0.)

### Mischaracterized — please adjust the spec/TODO sizing

- **Audit is Redux-only today, not Dexie-backed.** The audit feed
  (`src/store/slices/auditSlice.ts`) is a transient Redux list capped at ~50
  items; `AuditScreen.tsx` reads from Redux and seeds samples into Redux (not
  Dexie). There is **no durable audit write-path during normal operation.** So
  Phase 3 is not "remove seeding and tidy" — it is **building the durable audit
  service from scratch and wiring ~20 event types throughout the app.** This is
  one of the largest items in the whole plan; the TODO currently undersells it.
- **SecretVault already exists.** `src/secrets/secretVault.ts`,
  `src/secrets/crypto.ts` (Web Crypto), and `src/secrets/vaultWiring.ts`
  (persists salt/verifier to `app_settings`) are present and tested. So TODO 2.3
  is **wiring the existing vault into provider calls/tests** (resolve `secretRef`
  → vault lookup, plus Models UI for key entry), **not** building a vault +
  crypto from scratch. Smaller than it reads — good.
- **Skill path-traversal already has a basic guard.** `src/skills/skillFs.ts`
  already rejects `..`. TODO 7.2 is *hardening* (encoded traversal, absolute
  paths, null bytes, backslashes, normalize-before-check), not starting from
  zero.
- **Runtime snapshot save already exists but is never called.**
  `src/runtime/runtimeHost.ts` has `saveSnapshot()` that writes to
  `runtime_snapshots`, but nothing invokes it during normal operation and the
  reference runtime never emits a `runtime_snapshot_save` effect. Phase 4 is
  wiring triggers, not writing save logic.

---

## Open questions / decisions needed

### Q1. Execution model and ordering
Do you want this delivered as a **Ralph loop** (one bounded task → run the full
gate → commit), in the spec's phase order? Or reprioritized so the
**security-critical** items land first — specifically: skill permissions out of
mutable state (Spec §9), the secret-leak regression tests (TODO 11.2),
fail-closed provider resolution (Spec §3) — ahead of UI-persistence polish
(Phases 9–10)? Several phases are independent and can be cherry-picked.

### Q2. Audit event shape conflict → schema migration (please pick)
The spec's `AuditEvent` differs from the current `AuditEventRow`
(`src/db/types.ts`):

| Field | Current (`AuditEventRow`) | Spec (`AuditEvent`) |
|---|---|---|
| time | `at: number` (epoch ms) | `timestamp: string` (ISO) |
| risk | `'info' \| 'low' \| 'medium' \| 'high'` | `'low' \| 'medium' \| 'high' \| 'critical'` |
| added | — | `source`, `status`, `conversationId`, `providerId`, `skillId`, `toolName` |

Adopting the spec shape requires a **Dexie schema migration**, plus updating
every emit site and the audit UI. Decisions:
- **(a)** Adopt the spec's shape verbatim, or reconcile?
- **(b)** Which `risk` enum is canonical? (Current has `info`, no `critical`;
  spec has `critical`, no `info`.)
- **(c)** Implementer recommendation: **keep `at` as an epoch number**
  (`timestamp`-as-ISO sorts lexically but is worse for range queries/indexing in
  IndexedDB). Acceptable to keep numeric `at` and add the new fields, or do you
  specifically want ISO strings?

### Q3. WASM "fail closed" — does this mean the whole app is unusable?
Phase 1.1 wants a WASM load failure to show a blocking error and **not** run chat
at all (reference runtime only behind `VITE_ALLOW_REFERENCE_RUNTIME_FALLBACK`).
For an older/locked-down browser where WASM is unavailable for benign reasons,
this means the app simply won't run. Confirm the intent:
- **(a)** Hard block (blocking error card, no chat) on any WASM failure — as
  written; or
- **(b)** A visible "degraded / reference runtime" state the user can explicitly
  opt into at runtime (not just a build-time env flag)?

This also **reverses** what was just shipped (WASM-default with automatic
reference fallback), which is fine — just confirming it's intended.

### Q4. Backup format — harden JSON, or migrate to the `.clawbackup` archive?
Spec §8 shows a `.clawbackup` archive (`manifest.json` + `collections/*.jsonl` +
`model_refs.json`) but also says "if current implementation remains JSON-based
for now, it must still enforce [validation]." The current format is a single
JSON object with a `collections` map.
- **Implementer recommendation:** keep the current single-JSON format and add
  validation + allowlist + transaction + rollback + preview. Migrating to the
  archive format is a separate, larger task that also breaks existing exported
  backups.
- Confirm: **keep JSON + harden** for this pass, and defer the archive format?

### Q5. Snapshot trigger frequency
Phase 4 lists triggers "after each effect emitted **and** each effect resolved
**and** message accepted **and** idle/error/unload." Literally per-effect is many
IndexedDB writes per chat turn.
- Acceptable to **coalesce** (debounce to state-settle + an unload flush) for the
  same durability with far fewer writes? Or do you want a snapshot literally on
  every effect transition?

### Q6. Cleanup of already-seeded sample data
Sample memories are already in real Dexie for any user who opened the Memories
screen, with fixed IDs (`mem-1`, `mem-2`, …) and no demo marker. The spec's
Migration Notes say don't auto-delete *unmarked user data*.
- Implementer view: these are **our** seeds with known fixed IDs, so deleting
  exactly those IDs is a safe one-time migration (it isn't user data). Agree?
  Or do you want the "label as demo + ask the user to delete" flow even for
  these known seed rows?

### Q7. Provider error taxonomy — extend, don't duplicate
A `ProviderError { kind }` already exists. Spec §2 introduces a
`RuntimeEffectError` shape and Spec §3 wants CORS/normalized classifications.
- Plan: **extend the existing `ProviderError` taxonomy** and map it into the
  effect-error shape, rather than maintaining two parallel error vocabularies.
  Confirm that's acceptable (effect-level error wraps provider-level `kind`).

---

## Smaller corrections to the TODO

- **TODO 11.4 says `npm run …`** — this project is **pnpm-only** (enforced by
  repo conventions; `pretest` runs `eslint . --max-warnings 0` as a
  zero-tolerance gate). Implementer will read these as `pnpm run …` and preserve
  the zero-warning lint gate. Suggest the TODO be updated to `pnpm`.
- **Add `pnpm test:e2e:extended`** to the QA command list (TODO 11.4): the
  project now has an opt-in extended Playwright suite (real WASM, real wllama
  GGUF download + inference, live health checks) that runs in Chromium and
  Firefox. It should be part of the hardening QA bar.
- **TODO 1.2 / Spec §2** list `runtime_snapshot_save` as a required effect
  handler, but the current reference runtime never emits it. If Phase 1.2 makes
  "missing handler = fatal," ensure the snapshot handler is registered before/at
  the same time, or the fail-closed check will trip on a normal startup.

---

## Agreement

Subject to the answers above, we agree with the spec's direction and the
fail-closed/no-lie principles. The most consequential decisions are **Q2 (audit
shape + migration), Q3 (fail-closed severity), and Q4 (backup format)** because
they shape large amounts of downstream work. Once those are settled, the
implementer can begin (Ralph-loop, one bounded task per commit, full gate green
before each commit).
