# BrowserClaw Project Memory

Persistent cross-session context. Newest entries at the bottom. See the "Memory file" section in `CLAUDE.md` for the workflow and entry format.

## 2026-06-12T00:45:44Z - Claude Opus 4.8 - Initialized project memory
- Confirmed the `memory.md` workflow from CLAUDE.md: read at session start, update before responding, timestamped `## <UTC time> - <model> - <desc>` headings, never guess timestamps (use `date -u`).
- Ran `/init` this session: created project `CLAUDE.md` and a `/qa` skill (`.claude/skills/qa/SKILL.md`) that runs typecheck/lint/tests + a decrypted-secret-leak grep.
- Project status: greenfield. Only specs/mockups in `docs/browserclaw_text_mockups/`; no app code scaffolded yet. Phase 0 (React+TS+Vite+Tailwind+Redux+Router+Dexie) not started.
- Conventions: package manager is **pnpm**; solo git workflow committing directly to `master`; GitHub remote is `git@github.com:ekkus93/browser-claw.git`.
- Note: this project `memory.md` is separate from Claude Code's built-in memory store; they do not sync.

## 2026-06-12T01:01:33Z - Claude Opus 4.8 - Baseline commit + Ralph Loop ground rules agreed
- Committed and pushed the project baseline (commit `fc3706a`): extracted `docs/` specs/mockups, `CLAUDE.md`, `/qa` skill, `memory.md`; removed redundant handoff `.zip`; gitignored `*~` and `*.zip`. master is in sync with origin.
- Ralph Loop ground rules confirmed with user (phil) before starting:
  1. `run_claude.sh` is the user's personal restart shortcut (gitignored) — NOT the Ralph driver and not my concern.
  2. No verification suite exists until Phase 0 lands the toolchain; that's expected. First iterations bootstrap it.
  3. Task unit = one TODO leaf checkbox → commit; I MAY break large leaves into smaller subtasks freely.
  4. **If stuck, STOP and ask the user** — do not thrash or fake completion.
  5. **Push to GitHub periodically** after each task/subtask. User's priority: full history must live on GitHub (rollback is fine, but GitHub is source of truth).
  6. `memory.md` should be a MORE detailed history than git commit messages; I may add anything that could matter later; user may also request entries.
- Source of truth for "what's next": `docs/browserclaw_text_mockups/BROWSERCLAW_UI_TODO.md` (Phase 0 → Phase 13). Iterations should tick `[ ]`→`[x]` as work completes.

## 2026-06-12T01:08:41Z - Claude Opus 4.8 - Ralph iteration 1: Phase 0 scaffold + tooling
- Scaffolded the Vite app directly in repo root (manual scaffold — `create vite` won't run in a non-empty dir).
- Installed toolchain (exact versions in package.json / pnpm-lock.yaml). Notable, all current/cutting-edge: React 19.2, Vite 8.0, TypeScript 6.0, Tailwind **4.3** (`@tailwindcss/vite` plugin + `@import "tailwindcss"` + `@theme` block — NO tailwind.config.js / postcss), Vitest 4.1, ESLint **10** (flat config), RTK 2.12, react-router 7.17, Dexie 4.4.
- Files added: `index.html`, `vite.config.ts` (Vitest config inlined via `test` key, jsdom + globals + `src/test/setup.ts`), `tsconfig.json`/`tsconfig.app.json`/`tsconfig.node.json` (strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`), `src/main.tsx`, `src/App.tsx`, `src/App.test.tsx`, `src/index.css` (minimal design tokens as Tailwind `@theme` vars — full token mapping deferred to Phase 1), `eslint.config.js`, `.prettierrc.json`, `.prettierignore`.
- GOTCHA (ESLint 10): spreading `reactHooks.configs['recommended-latest']` / `reactRefresh.configs.vite` as full preset objects fails ("plugins must be object, not string array"). FIX: register `react-hooks`/`react-refresh` in a `plugins: {}` object and pull in only their `.rules`. See `eslint.config.js`.
- Prettier scope: `.prettierignore` excludes `docs/` (canonical specs — do NOT reformat) and hand-maintained root meta (`CLAUDE.md`, `memory.md`, `README.md`). Formatter governs `src/**` + config files only.
- `.gitignore` updated for Node/Vite (`node_modules`, `dist`, `coverage`, logs) — was Rust-only before.
- Verification gate ALL GREEN: `pnpm typecheck`, `lint`, `format:check`, `test` (1 passing), `build` (dist OK, Tailwind CSS compiled), and `pnpm dev` boots + serves the app entry on :5199.
- Scripts available: dev / build / preview / typecheck / lint / format / format:check / test / test:watch.
- NEXT (Phase 0 remaining): wire minimal Redux Toolkit store (+ Provider), react-router (RouterProvider), and a Dexie db instance — deps installed, not yet integrated. Those 3 boxes left unchecked.

## 2026-06-12T01:14:03Z - Claude Opus 4.8 - Ralph iteration 2: wire Redux/router/Dexie + zero-tolerance lint policy
- **Completes Phase 0.** All 8 Phase 0 boxes now checked.
- Redux: `src/store/store.ts` (configureStore), `src/store/bootstrapSlice.ts` (minimal `bootstrap` slice — placeholder reducer so the store is valid; real domain slices + listener middleware are Phase 2), `src/store/hooks.ts` (typed `useAppDispatch`/`useAppSelector` via `.withTypes`). App wrapped in `<Provider>`.
- Router: `src/router.tsx` (`createBrowserRouter`, single index route → App; nine real screens are Phase 6). `<RouterProvider>` wired in `main.tsx`.
- Dexie: `src/db/db.ts` — `BrowserClawDB extends Dexie`, `version(1).stores({})` empty bootstrap schema (full 17-store schema + migrations are Phase 3). Singleton `db` exported.
- Tests added: `src/store/store.test.ts`, `src/db/db.test.ts` (db test checks `db.name` only — no IndexedDB needed in jsdom; Phase 3 can add fake-indexeddb for real open/query tests). 3 test files / 3 tests pass.
- **NEW POLICY (user request 2026-06-12): linting is zero-tolerance and coupled to tests.** `lint` script is now `eslint . --max-warnings 0` (warnings = failures). Added `pretest` script `pnpm run lint`, so `pnpm test` lints ALL files before Vitest runs. **Never suppress** lint findings (no `eslint-disable`, no rule-downgrading) — fix the code. Documented in CLAUDE.md (Conventions) and the `/qa` skill.
- Verbatim-module-syntax note: imports use explicit `.ts`/`.tsx` extensions and `import type` for type-only imports (required by `verbatimModuleSyntax` + `allowImportingTsExtensions`).
- Gate ALL GREEN: typecheck, lint (max-warnings 0), format:check, `pnpm test` (3/3), build (35 modules, dist OK).

## 2026-06-12T01:18:14Z - Claude Opus 4.8 - Ralph iteration 3: Phase 1 design tokens
- Implemented the full `design_tokens.json` set in `src/index.css` as Tailwind v4 `@theme static`.
- Colors (17): background, surface, surface-subtle, border, text, muted, muted-subtle, primary(+subtle), success(+subtle), warning(+subtle), danger(+subtle), purple(+subtle). Utilities: `bg-*`/`text-*`/`border-*` etc.
- Typography: `--font-sans` (Inter); sizes xs=12 sm=13 md=14 lg=16 xl=20 2xl=24 (px, matching the canonical tokens exactly — note: px not rem, so they don't scale with user font settings; revisit if a11y wants rem). Weights regular..extrabold → `font-regular`/`medium`/`semibold`/`bold`/`extrabold`.
- Radii: `rounded-button` (8px), `rounded-card` (12px).
- Layout dims kept as plain `:root` custom props (not utility-generating): `--bc-app-width` 1586, `--bc-app-height` 992, `--bc-left-nav-width` 260, `--bc-right-inspector-width` 380. Use via arbitrary values e.g. `w-[var(--bc-left-nav-width)]`.
- GOTCHA (Tailwind v4): plain `@theme` TREE-SHAKES unused theme vars out of the build — `color-purple`/`surface-subtle` were missing until referenced. FIX: `@theme static` always emits the declared token set (verified all present in dist CSS). Use this for canonical token layers.
- Gate green: typecheck, `pnpm test` (3/3), format:check, build (CSS 9.02 kB).
- NEXT (Phase 1): AppShell, then TopStatusBar / SidebarNav / RightInspectorPanel / StatusFooter, then the shared component library (Button, Card, Badge, Input, Select, Toggle, Tabs, Dialog, Progress, Toast, EmptyState, ErrorState). Plan to use the `frontend-design` skill for these. Will batch into small committed iterations.

## 2026-06-12T01:25:44Z - Claude Opus 4.8 - Ralph iteration 4: AppShell + layout regions
- Built the shared AppShell and all four layout regions. Phase 1 boxes for AppShell/TopStatusBar/SidebarNav/RightInspectorPanel/StatusFooter checked. Component library (Button..ErrorState) still pending.
- Files under `src/components/shell/`: `AppShell.tsx` (CSS-grid: top bar row + nav/main/optional-inspector columns sized by `--bc-left-nav-width` / `--bc-right-inspector-width`), `TopStatusBar.tsx` (brand + model pill + storage pill w/ usage bar + Settings btn), `SidebarNav.tsx` (NavLink rail, active = `bg-primary-subtle` + semibold primary), `StatusFooter.tsx` (runtime status card + version line; `RuntimeStatus` union ready/initializing/busy/error), `RightInspectorPanel.tsx` (ARIA tablist: Tool Calls/Context/Memory/Skills/Audit, local tab state), `BrandMark.tsx` (inline-SVG claw logo), `navItems.ts` (nav config → canonical routes).
- `src/AppLayout.tsx`: layout route wrapping `<Outlet/>` in AppShell; inspector shown only on `/chat` for now. `src/screens/PlaceholderScreen.tsx`: temporary stand-in (Phase 6 replaces). `router.tsx` rewritten: `/` → AppLayout with index redirect to `/chat` + a placeholder child route per nav item (nav is fully functional now, no dead links).
- Removed orphaned `App.tsx`/`App.test.tsx` (AppLayout is the new root) and did NOT add a shell barrel `index.ts` — barrels re-exporting components+consts risk a `react-refresh/only-export-components` warning (which `--max-warnings 0` would fail). Import directly from component files instead.
- DESIGN DECISION: frontend-design skill applied as *craft* (spacing rhythm, hover/active/`focus-visible` rings, subtle transitions) but NOT to override the canonical design language — kept the locked light theme + specified palette. Did add real Inter via **`@fontsource-variable/inter`** (imported in index.css; woff2 bundled locally — no CDN, fits local-first) and **`lucide-react`** for nav/status icons. `--font-sans` now `'Inter Variable', Inter, Arial, sans-serif`.
- All shell live values (model, storage, runtime status, version) are PLACEHOLDER props defaulting to the mockup values — to be wired to Redux in Phase 2.
- Tests: `src/components/shell/AppShell.test.tsx` (renders brand/nav/runtime/version/content; active-route `aria-current`; inspector tab switching via userEvent). 3 files / 5 tests pass.
- Gate green: typecheck, lint (max-warnings 0), format, test (5/5), build (CSS 16.75 kB, Inter woff2 bundled).
- NOT yet visually verified in a real browser (no Playwright installed) — jsdom tests + full build are the current evidence. Worth a real screenshot pass later.

## 2026-06-12T01:30:45Z - Claude Opus 4.8 - Ralph iteration 5: component library batch A (primitives)
- Built 6 of 12 shared components. Phase 1 sub-boxes Button/Card/Badge/Input/Select/Toggle checked; Tabs/Dialog/Progress/Toast/EmptyState/ErrorState remain (batch B).
- `src/lib/cn.ts`: tiny className joiner (filter(Boolean).join(' ')) — no tailwind-merge.
- `src/components/ui/`: `Button.tsx` (variants primary/secondary/ghost/danger, sizes sm/md, leading/trailing icon, `loading` w/ Loader2 spinner + aria-busy, disabled), `Card.tsx` (Card + CardHeader/CardTitle/CardContent/CardFooter composables), `Badge.tsx` (tones neutral/primary/success/warning/danger/purple, optional dot), `Input.tsx` + `Select.tsx` (forwardRef, label/hint/error, aria-invalid + aria-describedby; Select has appearance-none + ChevronDown), `Toggle.tsx` (real button role="switch", aria-checked, keyboard-operable).
- Style maps (VARIANTS/SIZES/TONES/DOTS) kept module-internal (not exported) to stay clear of `react-refresh/only-export-components` under `--max-warnings 0`.
- `src/screens/ComponentGallery.tsx` + route `/showcase`: living design-system gallery (also the surface for future visual review). Not a product screen.
- POLICY REMINDER honored: briefly added an `eslint-disable react/button-has-type` in Button, then REMOVED it (violates no-suppression rule; the rule isn't even enabled). No suppressions anywhere.
- Tests `src/components/ui/ui.test.tsx`: Button click + loading-disabled/aria-busy, Badge content, Input label assoc + aria-invalid, Toggle aria-checked flip. 4 files / 9 tests pass.
- Gate green: typecheck, lint, format, test (9/9), build (CSS 20.89 kB).
- NEXT (Phase 1 batch B): Tabs, Dialog (focus-trap + restore — acceptance criterion), Progress, Toast, EmptyState, ErrorState. Then Phase 1 done → Phase 2 (Redux slices + listener middleware; wire shell placeholders to real state).
