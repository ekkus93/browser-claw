# BrowserClaw Workspace/Scripting/WebResearch FIX13 Review Notes

## 1. Validation-order problem

In `validateMessageSchema()` (service-worker.js), the `web_search` branch prior to FIX13
validated `apiKey` before `maxResults`:

```text
1. query shape
2. apiKey presence     ← wrong: credential check before shape check
3. maxResults shape    ← wrong order
```

A request with both missing `apiKey` and invalid `maxResults` (e.g. `maxResults: -1`)
returned `permission_denied` instead of `invalid_request`. This masks shape errors behind
credential errors, making failures non-deterministic.

## 2. Exact validation order after FIX13

```text
1. query shape       — invalid_request if empty/non-string
2. maxResults shape  — invalid_request if present but invalid (A1 FIX13 block)
3. apiKey presence   — permission_denied if missing/empty
```

Change is in `extension/chrome-web-research/service-worker.js` inside
`validateMessageSchema()`, `web_search` branch. The `validateOptionalMaxResults()` block
moved above the `apiKey` check.

## 3. Regression tests added

Added `describe('A1 (FIX13) — web_search validation order: maxResults before apiKey', ...)`
in `src/extension/serviceWorkerReadPages.test.ts`:

- 5 `it.each` cases: missing `apiKey` + invalid `maxResults` (`-1`, `0`, `1.5`, `'5'`, `21`) → `invalid_request`
- missing `apiKey` + valid `maxResults: 5` → `permission_denied`
- missing `apiKey` + missing `maxResults` → `permission_denied`
- empty `query` (with `maxResults: -1`) → `invalid_request`

Total: 8 new tests. Test count: 1454 → 1462.

## 4. Direct handler validation still present

`handleWebSearch()` in service-worker.js retains its own `validateOptionalMaxResults()`
call (lines ~534-543). No change to the direct handler. FIX12 B2 tests still pass.

## 5. Gate evidence

| Command | Status | Notes |
|---|---|---|
| `pnpm run typecheck` | PASS | tsc strict, no errors |
| `pnpm run lint` | PASS | eslint --max-warnings 0 |
| `pnpm run format:check` | PASS | all files match Prettier |
| `pnpm test -- --no-file-parallelism` | PASS | 1462 tests |
| `pnpm run test:e2e` | NOT RUN this iteration | unchanged from FIX12; last run: PASS |
| `pnpm run test:extension:e2e` | CANNOT RUN | requires persistent Chrome + display; no such env |
| `pnpm run test:extension:e2e:docker` | NOT RUN this iteration | unchanged from FIX12; last run: PASS 5/5 |
| `pnpm run build` | NOT RUN this iteration | unchanged from FIX12; last run: PASS |
| `pnpm run build:wasm` | NOT RUN this iteration | no Rust/WASM changes |
| `cargo test --workspace` | NOT RUN | no Rust/WASM changes |
| `cargo clippy --workspace --all-targets -- -D warnings` | NOT RUN | no Rust/WASM changes |

`test:extension:e2e` cannot run in this environment because there is no persistent Chrome
profile or display server. The Docker lane (`test:extension:e2e:docker`) is the
authoritative extension E2E result. It was last run in FIX12 and passed 5/5; no extension
code changed in FIX13 other than validation order within `validateMessageSchema()`.

## 6. Final acceptance status

- [x] central `web_search` schema checks `maxResults` before `apiKey`
- [x] missing `apiKey` + invalid `maxResults` → `invalid_request`
- [x] missing `apiKey` + valid `maxResults` → `permission_denied`
- [x] missing `apiKey` + missing `maxResults` → `permission_denied`
- [x] invalid `query` → `invalid_request`
- [x] direct `handleWebSearch()` still validates `maxResults`
- [x] FIX12 direct handler tests still pass (1462 total, all green)
- [x] gate evidence is honest
