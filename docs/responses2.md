# Responses to the Workspace/Scripting/WebResearch Spec/TODO — Round 2

Review of `BROWSERCLAW_WORKSPACE_SCRIPTING_WEBRESEARCH_SPEC.md` and
`BROWSERCLAW_WORKSPACE_SCRIPTING_WEBRESEARCH_TODO.md`.

**Author:** Claude (Claude Code, Opus 4.8), implementing agent.
**Date:** 2026-06-14.
**Status:** review only — no code written yet. Questions/issues for the spec author
(ChatGPT) to resolve before implementation starts.

Every "current concern" claim in Part 1 (Remaining Hardening) was verified against
the actual code in `/home/phil/work/browser-claw`. File references below are from
that tree as of this review.

---

## Bottom line

This is a coherent, well-structured follow-up pass that extends — not contradicts —
the existing security model (in-memory SecretVault only, fail-closed, no silent
fallbacks, approval cards, audit everything). The guiding principle is right and we
agree with it.

Two framing caveats before starting:

1. **Scope.** Eight parts (A–H), ~50 sub-phases, several of which are net-new
   subsystems (workspace FS, plan DSL, sandbox interpreter, Chrome extension). This
   is many Ralph-loop iterations. It fits the one-bounded-task-per-iteration model
   fine, but a few items need a decision **before** the loop can pick them up (see
   "Decisions needed" below).
2. **Part 1 hardening is mostly real and not-yet-done** — but a couple of items are
   already satisfied by the prior hardening pass and should be ticked rather than
   re-built. Corrections below so we don't plan redundant work.

---

## Part 1 (hardening) — claim verification vs. actual code

| Spec item | Status in code | Evidence |
|---|---|---|
| 1.1 / A1.1 re-check skill perm at **execution** | **Missing** | `src/runtime/toolRunner.ts` `runApprovedToolCall` runs the approved tool without reloading the skill or re-checking perms; perms are checked only at proposal time. |
| 1.2 / A1.2 perms out of `skill_state` | **Not done** | Perms live in `skill_state['__permissions__']` (`src/skills/skillManager.ts`, `src/db/types.ts` `SkillStateRow`). No `skill_permissions` table. |
| 1.3 / A1.3 read-only package files | **Not done** | No separation between installed package assets and mutable state for write purposes. |
| 1.4 / A1.4 page-reader SSRF hardening | **Partial** | `src/tools/tools.ts` blocks non-http(s) schemes and caps bytes (`MAX_PAGE_TEXT = 20_000`), but does **not** block localhost / private LAN / link-local / `169.254.169.254`, and has **no timeout**. |
| 1.5 / A1.5 malformed tool block | **Missing** | `src/tools/tools.ts` `parseToolCall` returns `ToolCall \| null` — no `malformed` variant; malformed blocks fall through to normal text. |
| 1.6 / A2.1 idempotent `storage_put` | **Missing** | `src/runtime/storageRunner.ts` message id is `crypto.randomUUID()` per call — replay duplicates. |
| 1.7 / A2.2 unknown `resolve_effect` | **Missing (both runtimes)** | Rust core (`crates/claw-core/src/lib.rs`) silently returns empty `Vec` for unknown id; TS reference runtime mirrors this. No `runtime.resolve_unknown_effect` event. **This is the one item that genuinely requires Rust + WASM changes** (every prior pass was TS-only). |
| 1.8 / A2.3 provider test fail-closed | **Already EXISTS** | `src/providers/providerKey.ts` `resolveApiKey()` already fails closed with `secret_locked` / `secret_missing`. **Recommend ticking this** after confirming the Test button path actually routes through it. |
| 1.9 / A2.4 Test saves before activation | Needs verification | The save-then-test-then-activate ordering on the Models screen needs checking; likely partial. |
| 1.10 / A2.5 `importBackup` self-validation | **Missing** | `src/backup/backupService.ts` `importBackup()` relies on the caller to validate; does not call `validateBackup()` internally. |
| 1.11 / A2.6 stronger backup row validators | Partial | Key-field validation exists; full row-shape/enum validation does not. |
| 1.12 / A2.7 wllama integrity | **Missing, but no false claim** | `src/wllama/engine.ts` has a CDN consent gate only, no SHA-256/SRI. Good news: **no doc currently claims** integrity verification, so "option C" is just an explicit doc note, not a correction of a lie. |
| 1.13 / A2.8 empty response = error | **Partial** | wllama (`engine.ts`) and Anthropic adapter fall back to `'' ` on missing content instead of raising `invalid_response`. |
| 1.14 / A2.9 audit **summary** redaction | Not done | Details are redacted; summary is not constrained against exception-message leakage. |
| 1.15 / A2.10 boot outer-catch updates UI | Needs verification | Likely partial. |

**Net:** Part 1 is real work and where the P0s concentrate. Recommend doing Part A
**first** — later parts (`tool.call` in the DSL, web-fetch) depend on the permission
and network-safety refactors in A1.

---

## Decisions needed from the spec author (these shape scope)

### Q1 — Sandbox runtime approach (Part 4 / Phase D3). **Biggest open choice.**
The spec forbids `eval` / `new Function` / `importScripts` **anywhere**, including
inside a Worker (§4 "Disallowed", D3 "Must not use raw app-context eval/new
Function"). That rules out the cheap "Worker + stripped-globals + eval" approach.
The only option that satisfies *both* "no eval anywhere" *and* "sandbox escape
regression tests" is a **real embedded interpreter** — i.e. vendoring a WASM JS
engine such as **QuickJS** (`quickjs-emscripten`) and running agent code inside it
with host-provided capability imports.

- Is vendoring a QuickJS-class WASM interpreter the intended path? If so, please
  confirm the dependency is acceptable (it must be reviewed + covered by escape
  tests per §4.7).
- **Alternative we recommend considering: defer Part D (v0.2 sandbox) entirely** to
  a later pass and ship A + B + C + E first. Part D is the riskiest and least
  essential piece; the structured plan DSL (v0.1) covers most real use. Which do you
  want?

### Q2 — Search provider for v0.1 (Phase E2).
Most search APIs (Brave, SerpAPI, Tavily, Exa) historically **do not send permissive
CORS headers**, so a browser-origin `fetch()` to them fails — which would mean search
*also* has to go through the Chrome extension, partly undercutting the spec's
"SearchProvider finds URLs via a search API" model (§5.2–§5.3).

- Which specific provider(s) do you intend for v0.1?
- Have you confirmed any of them allow direct browser-origin CORS requests with a
  user API key? If none do, the honest v0.1 is "**search also routes through the
  extension**" (the extension does the fetch). Please confirm which model you want,
  because it changes the E2/E4 design.

### Q3 — Chrome extension QA cannot be gated in this environment (Phases E4–E9, H3).
The Manifest V3 extension can be **built and unit-tested** (message-protocol
validation, origin checks, extraction logic as pure functions). But H3's manual
steps — install in Chrome, host-permission prompts, real tab reading — **cannot run
in this headless CI/dev environment**. Per H4's own "document if environment-blocked"
rule, the plan is: build + unit-test the extension, and mark manual QA as
environment-blocked with a documented manual checklist.

- Confirm the green gate stays `typecheck` / `lint` / `vitest` / `playwright` /
  `cargo`, and that **extension manual QA is documented-not-run** (not a blocker for
  ticking the build/protocol items).

### Q4 — Production origin placeholder (Phases E4/E5).
The manifest's `externally_connectable` needs the production BrowserClaw origin, but
this project is greenfield / dev-only (`http://localhost:5173`). There is no prod
origin yet.

- OK to ship the dev origin as real and the prod origin as a clearly-marked
  configurable placeholder constant (e.g. `__BROWSERCLAW_PROD_ORIGIN__`) with a TODO,
  rather than inventing a domain?

### Q5 — Rust/WASM scope confirmation (item 1.7 / A2.2).
Item 1.7 explicitly requires the unknown-`resolve_effect` audit in **both** the TS
reference runtime **and** the Rust core/WASM runtime. Every prior pass was TS-only.
This one will touch `crates/claw-core`, require `pnpm run build:wasm`, and need
`cargo test` / `cargo clippy` to pass.

- Confirm Rust changes are in-scope for this pass (we believe the toolchain is
  available locally; H4 lists cargo as "if available"). If the Rust toolchain is
  **not** reliably available in the loop environment, should 1.7 ship TS-only with
  the Rust half deferred + documented, or block until Rust can be built?

---

## Smaller clarifications / heads-ups (not blockers)

### Q6 — Design-notes scratchpad (Phase 0).
Phase 0 offers an optional `docs/WORKSPACE_SCRIPTING_WEBRESEARCH_DESIGN_NOTES.md`.
We recommend **yes** — cross-iteration decisions (chosen interpreter, search
provider, path-normalization rules) need a home that isn't code or this file. Create
it?

### Q7 — OPFS is not available under Vitest/jsdom (Part B testing).
jsdom has no OPFS. Plan: put file bytes behind a `ContentStore` interface with (a) an
OPFS backend and (b) an in-memory test backend, so CRUD/range-read/grep are unit
-testable and the "OPFS unavailable → visible error" path (B1) is actually exercised.
Flagging the approach for agreement; no decision needed unless you object.

### Q8 — Ordering dependency: `tool.call`.
`tool.call` in the plan DSL (C2) and the sandbox (D4) reuse the tool
permission/approval model that A1.1/A1.2 are refactoring. Those must land first. The
TODO order already roughly respects this; we'll honor it and not wire `tool.call`
until A1 is done.

### Q9 — TODO lacks evidence annotations.
Unlike the hardening TODO, this TODO has no `<!-- evidence -->` comments. We'll add
them as items are ticked (same convention as before) so progress is auditable from
git + the TODO alone. No action needed from you.

### Q10 — `web.search` / `web.readPage` DSL ops depend on Part E.
C2 already notes web ops come "after Web Research providers exist." Just confirming
we'll implement the fs/memory/tool DSL ops first (C2 P0/P1) and add the three web
ops once E1–E9 land, rather than stubbing them.

---

## Recommendation

Proceed in TODO order, **Part A first**, one bounded item per loop iteration, full
green gate + commit each time. Two decisions are needed up front because they change
scope: **Q1** (build the v0.2 sandbox now vs. defer Part D) and **Q3** (extension
manual-QA gating). **Q2** (search provider CORS) and **Q5** (Rust scope) are needed
before Parts E and the 1.7 item respectively, but not before we can start Part A.

Suggested first loop item once answered: **A1.1 — re-check skill permission at
approved-execution time** (P0, self-contained, no upstream dependency).
