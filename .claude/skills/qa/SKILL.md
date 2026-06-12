---
name: qa
description: Run the BrowserClaw quality gate — typecheck, lint, tests, and a check that no decrypted secrets leak into Redux/logs. Use before committing, after a batch of changes, or when the user asks to "run QA", "verify", or "check the build".
---

# BrowserClaw QA gate

Run the Phase 13 quality checks (see `docs/browserclaw_text_mockups/BROWSERCLAW_UI_TODO.md`). This project uses **pnpm** — never npm/yarn.

## Steps

Run these in order and report results. If a script doesn't exist yet (greenfield / pre-Phase-0), say so and skip it rather than failing.

1. **Typecheck** — `pnpm run typecheck` (or `pnpm exec tsc --noEmit` if no script). TypeScript is strict; treat type errors as failures.
2. **Lint** — `pnpm run lint` (`eslint . --max-warnings 0`). **Warnings are failures.** Never silence a finding with `eslint-disable` or by disabling a rule — fix the code.
3. **Tests** — `pnpm test` (or `pnpm run test`). Note: `pnpm test` already lints first via `pretest`, so a passing `pnpm test` also means lint passed. For a single test, use the test runner's filter (e.g. `pnpm test -- -t "name"`).
4. **Secret-leak check** — grep the source for decrypted secrets reaching forbidden sinks. Decrypted API keys/tokens must NEVER appear in Redux state, localStorage, console logs, audit payloads, or screenshots — they belong in the in-memory SecretVault only. Flag anything suspicious:
   - decrypted key/token values being dispatched into Redux slices or written to `localStorage`
   - `console.log`/`console.*` of secret values
   - secrets included in audit event payloads

## Reporting

- Report each step as pass / fail / skipped, with the relevant output for failures.
- If the secret-leak check finds a candidate, show the file:line and explain why it may violate the rule — do not auto-fix without confirming.
- End with a one-line overall verdict.
