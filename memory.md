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
