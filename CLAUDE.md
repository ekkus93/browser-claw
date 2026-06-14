# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

BrowserClaw — a browser-only, local-first AI agent console ("like OpenClaw, but in your browser"). This repo is **greenfield**: only specs and mockups exist in `docs/browserclaw_text_mockups/`. No application code has been scaffolded yet.

## Canonical specs — read before building

The `docs/browserclaw_text_mockups/` package is the source of truth. Read in this priority order:

1. `BROWSERCLAW_TEXT_MOCKUPS.md` — canonical page layout, purpose, and component structure.
2. `BROWSERCLAW_UI_SPEC.md` — architecture, data ownership, routes, storage/security requirements, acceptance criteria.
3. `BROWSERCLAW_UI_TODO.md` — phased implementation sequence (Phase 0 setup → Phase 13 QA).
4. `design_tokens.json` — visual design constants (colors, typography, layout).
5. `svg/*.svg`, `png_reference/*.png` — visual references only.

**Build real React components that match the described layout and behavior. Do NOT render the SVGs as static images.**

## Critical security rule

Never put decrypted API keys or OAuth tokens in Redux state, localStorage, console logs, audit events, or screenshots. Decrypted secrets live in an **in-memory SecretVault only**. This is an acceptance criterion and must hold across all code.

## Planned stack (Phase 0)

- React + TypeScript (strict) + Vite, Tailwind CSS
- Redux Toolkit (UI/runtime control plane) + listener middleware
- React Router
- Dexie (IndexedDB/OPFS durable storage)
- Rust/WASM for the deterministic agent runtime (`claw-core`, `claw-wasm`, `claw-schema`, `claw-testkit`)
- Provider adapters: OpenAI, Anthropic, OpenAI-compatible, Ollama, llama-server; wllama for browser-local GGUF models

State ownership boundaries (enforce these): Redux = transient UI/session/run state; Dexie/IndexedDB = durable data; Rust/WASM = deterministic runtime state machine + effects; SecretVault = decrypted secrets in memory.

## Conventions

- **Package manager: pnpm.** Use `pnpm install` / `pnpm run <script>`. Do not use npm or yarn.
- **Git: solo workflow on `master`.** Commit directly to master; no PR process yet.
- **Linting and formatting are part of testing and are zero-tolerance.** `pnpm test` runs `pretest` → `eslint . --max-warnings 0 && prettier --check .` before Vitest, so any lint warning or unformatted file fails the run. **Lint warnings are errors** — fix them, never suppress. Do not add `eslint-disable` comments or downgrade/disable rules to silence a finding; change the code instead. (If a rule is genuinely wrong for this project, raise it explicitly rather than quietly suppressing.) Run `pnpm run format` to auto-format.
- No meaningful side effect happens silently — side effects go through inline approval cards (approve/edit/reject, show risk, show exact data).
- Every meaningful action emits an audit event (see the audit event list in `BROWSERCLAW_UI_SPEC.md`).

## Tooling

Formatter (Prettier), linter (ESLint flat config), and test frameworks (Vitest + Playwright) are configured. The gate is `pnpm run typecheck`, `pnpm test` (runs lint + `prettier --check` then Vitest), and `pnpm run test:e2e`; `cargo test`/`cargo clippy` when Rust/WASM changes. A format-on-edit hook could still be added — re-run `/init` to set it up.

## Memory file

- You have access to a persistent memory file, `memory.md`, in the project root that stores context about the project, previous interactions, and preferences.
- Read `memory.md` at the start of each session to restore context from prior interactions.
- Before sending back a response, update `memory.md` with any new relevant information learned during the interaction. Timestamp and format entries clearly.
- Include the model name in the heading line so memory history records both time and model (for example: `## 2026-06-06T12:00:00Z - Claude Sonnet 4.6 - Restored router gate after layout regression`).
- **NEVER fabricate or guess timestamps.** Always obtain the current time by running `date -u +"%Y-%m-%dT%H:%M:%SZ"` in the terminal immediately before writing the entry. If the entry describes a specific commit, use `git log -1 --format="%aI" <hash>` for that commit's actual timestamp.
- Format entries as:

```markdown
## 2026-06-06T12:00:00Z - Claude Sonnet 4.6 - Brief description of what was learned or done
- Key fact or decision recorded.
- Another relevant detail.
```

- Quick command — **"Read memory.md"**: re-read the file because something from a prior session was forgotten.

## Ralph Loop — autonomous task execution

A **Ralph Loop** is an autonomous AI coding pattern where the agent runs in a short iterative loop, each iteration with fresh context. Named after Ralph Wiggum (The Simpsons) — stubborn, keeps trying until it succeeds.

### How it works
1. The agent reads the spec/TODO file and git history to find the next incomplete task.
2. It implements exactly **one bounded task**, runs the verification suite, and commits.
3. The agent exits. The loop script restarts it for the next iteration.

Progress is stored in git history and the TODO file's checkboxes — not in the agent's context window. This avoids context rot in long sessions.

