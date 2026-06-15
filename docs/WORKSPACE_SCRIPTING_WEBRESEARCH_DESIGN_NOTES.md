# Workspace / Scripting / Web Research — Design Notes (scratchpad)

Cross-iteration implementation decisions for the pass described in
`BROWSERCLAW_WORKSPACE_SCRIPTING_WEBRESEARCH_SPEC.md` /
`...TODO.md`. This file is a decision log so architectural choices are not
re-litigated each Ralph-loop iteration. It is **not** canonical spec — the spec
and TODO are. Newest decisions at the bottom of each section.

## Locked decisions (from `docs/replies2.md`, 2026-06-14)

- **Build order:** Part A (hardening) → B (Workspace FS) → C (Plan Runtime) →
  E (Chrome extension / web research) → D (Sandboxed JS Runtime) → F/G/H.
  Do not implement web/search/scripting features before the P0 hardening lands.
- **Sandboxed JS Runtime (Part D) is IN SCOPE for v0.1.** Use a
  **QuickJS-in-WASM** embedded interpreter (e.g. `quickjs-emscripten`-class).
  **Never** `eval` / `new Function` / `importScripts` / raw Worker-eval /
  dynamic `<script>` / any browser-context JS execution. If the dependency
  proves unsuitable, STOP and report — do not fall back to browser eval.
- **Search routes through the Chrome extension by default** for v0.1 (most search
  APIs block browser-origin CORS and we won't put keys in browser JS). Define
  `SearchProvider` / `PageReaderProvider` interfaces, but the first production
  impls are extension-backed. Browser-direct search only if a provider is proven
  CORS-safe with acceptable key handling.
- **Chrome extension QA is automated, not manual-only.** Add a Dockerized
  Chromium extension E2E lane (Playwright persistent-context preferred; Puppeteer
  + Chrome-for-Testing acceptable). Command: `pnpm run test:extension:e2e`
  (+ optional `:docker`). Manual QA only for store packaging / install / upgrade /
  real host-permission prompts. Tiers: (1) unit (protocol, URL policy, extraction
  pure fn), (2) BrowserClaw integration, (3) Dockerized E2E smoke.
- **Configurable allowed origins** for the extension manifest — dev/test origins
  real (`http://localhost:5173`, `http://127.0.0.1:5173`), production origin a
  clearly-marked placeholder configured at release. Never invent a fake domain.
- **Rust/WASM changes are in scope** for the unknown-`resolve_effect` audit
  (item 1.7 / A2.2): fix in both the TS reference runtime and `claw-core`/WASM;
  gate includes `cargo test` / `cargo clippy` / `pnpm run build:wasm`. If the
  Rust toolchain is unavailable in an environment, document and do not mark the
  Rust half complete (do not ship TS-only silently).
- **`ContentStore` abstraction** for Workspace FS bytes — `OpfsContentStore`
  (prod), `MemoryContentStore` (unit tests; jsdom has no OPFS),
  `UnavailableContentStore` (explicit error path). Keep OPFS behind the interface.
- **`tool.call` (DSL/sandbox) waits for A1.1 → A1.2 → A1.3** so it cannot bypass
  the same approval/permission path as chat-originated tool calls.
- **TODO evidence comments** required when ticking a box:
  `<!-- src/path/file.ts: fnName; testName in file.test.ts -->`. No box checked
  without source/test evidence unless explicitly design-only.
- **Plan DSL op order:** fs.* → workspace search → memory → tool.call (after A1)
  → web.search / web.readPage (after extension providers exist). Do NOT stub the
  web ops as fake browser-fetch.

## Open questions to resolve when the relevant part starts

- Exact QuickJS-in-WASM package + license/bundle-size review (Part D).
- Workspace path normalization rules — finalize the reject list vs. the spec
  §2.4 examples when Part B2 starts.
- Search provider backend(s) the extension will call (Part E2).

## Implementation log

### A1.1 — re-check skill permission at approved-execution time (done)
- Added `src/skills/skillPermissions.ts` `authorizeSkillTool(db, skillId, tool)`
  as the SINGLE fail-closed authorization read (skill exists + enabled + tool
  declared). Reads `skill_state['__permissions__']` for now; **A1.2 will relocate
  that read here in one place.**
- `toolRunner.ts`: proposal handler now calls `authorizeSkillTool`; and
  `runApprovedToolCall` RE-CHECKS via the same helper before running, auditing
  `tool.permission_recheck_failed` and resolving `tool_not_permitted` on failure.
  Execution no longer trusts the approval/Redux state.

### A1.2 — move skill permissions out of mutable skill_state (done)
- New PROTECTED `skill_permissions` table (`db/types.ts SkillPermissionsRow`,
  `db/db.ts` — **DB_VERSION 4 -> 5**). v5 upgrade migrates every
  `skill_state['__permissions__']` row: valid blob (guarded by
  `skillTypes.ts isSkillPermissions`) -> `skill_permissions`, then the old row
  deleted; malformed blob dropped (fail closed) + `skill.permissions_migration_failed`
  audit (written via `buildAuditRow` inside the upgrade tx).
- `skillPermissions.ts loadSkillPermissions(db, id)` is now the SINGLE read path
  (used by authorizeSkillTool, skillManager.fsFor, SkillsScreen). Install/reinstall
  is the ONLY writer (skillManager). uninstall deletes it.
- Backup: added `skill_permissions` to COLLECTIONS + KEY_FIELDS (`['skillId']`).
- GOTCHA: `skill_state` is keyed `[skillId+key]` — `key` is NOT a standalone
  index, so the migration must `.filter(r => r.key === '__permissions__')`, not
  `.where('key')` (which throws SchemaError).
- SkillFs reserved-key guard (`__`-prefix) stays as defense in depth.
