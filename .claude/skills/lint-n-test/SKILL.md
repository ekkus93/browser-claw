---
name: lint-n-test
description: Run the BrowserClaw full lint-and-test gate. Use before committing or when asked to "lint and test", "run the gate", or "verify". Covers typecheck, lint, format, Vitest unit tests, and Rust tests when crates/ changed. E2E and Docker extension tests are separate and not run by default.
---

# BrowserClaw lint-n-test gate

This project uses **pnpm** — never npm or yarn. Tests must be single-threaded (CPU constraint).

## Steps

Run in order. Stop and report on first failure.

1. **Typecheck**

   ```bash
   pnpm run typecheck
   ```

   TypeScript strict mode — any error is a failure.

2. **Lint + format check + Vitest unit tests**

   ```bash
   pnpm test -- --no-file-parallelism
   ```

   `pnpm test` runs `pretest` first (`eslint . --max-warnings 0 && prettier --check .`), then Vitest. Lint warnings are failures — never suppress with `eslint-disable`; fix the code instead.
   `--no-file-parallelism` is required (CPU constraint — parallel Vitest workers cause failures on this machine).

3. **Rust (only if `crates/` or `Cargo.toml` changed)**
   ```bash
   cargo test --workspace
   cargo clippy --workspace --all-targets -- -D warnings
   ```
   Zero-tolerance: clippy warnings are failures. Fix code, never suppress.

## Reporting

Report each step as one line: `PASS` or `FAIL`, with test count for test steps and relevant error output for failures. End with a single-line overall verdict.

## Not included by default

- `pnpm run test:e2e` — Playwright browser E2E (run separately when needed)
- `pnpm run test:extension:e2e:docker` — Docker-based MV3 extension E2E (run separately)
- `pnpm run build` / `pnpm run build:wasm` — production build checks
