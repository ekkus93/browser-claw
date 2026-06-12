# BrowserClaw Project Memory

Persistent cross-session context. Newest entries at the bottom. See the "Memory file" section in `CLAUDE.md` for the workflow and entry format.

## 2026-06-12T00:45:44Z - Claude Opus 4.8 - Initialized project memory
- Confirmed the `memory.md` workflow from CLAUDE.md: read at session start, update before responding, timestamped `## <UTC time> - <model> - <desc>` headings, never guess timestamps (use `date -u`).
- Ran `/init` this session: created project `CLAUDE.md` and a `/qa` skill (`.claude/skills/qa/SKILL.md`) that runs typecheck/lint/tests + a decrypted-secret-leak grep.
- Project status: greenfield. Only specs/mockups in `docs/browserclaw_text_mockups/`; no app code scaffolded yet. Phase 0 (React+TS+Vite+Tailwind+Redux+Router+Dexie) not started.
- Conventions: package manager is **pnpm**; solo git workflow committing directly to `master`; GitHub remote is `git@github.com:ekkus93/browser-claw.git`.
- Note: this project `memory.md` is separate from Claude Code's built-in memory store; they do not sync.
