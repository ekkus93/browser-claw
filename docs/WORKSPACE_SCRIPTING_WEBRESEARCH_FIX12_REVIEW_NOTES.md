# FIX12 Review Notes

## Scope

FIX12 is a narrow cleanup pass after the FIX11 review. No new product features.

---

## Behavior summary

### Batch `readPages()` top-level extension error kind mapping

`pageReaderProvider.readPages()` previously collapsed all top-level batch
errors into `internal_error`. The conditional was split into three cases:

1. Not an `ExtensionResponse` → per-URL `internal_error`.
2. `ExtensionResponse` with `ok: false` → use `toError(raw)`, which maps via
   `ERROR_KIND_MAP`. `invalid_request` → `invalid_request`; `permission_denied`
   → `permission_denied`; etc.
3. `ok: true` but missing/non-array `results` → per-URL `internal_error`.

### Service-worker central `web_search.maxResults` validation

`validateMessageSchema()` in the Chrome extension service worker now calls
`validateOptionalMaxResults(message.maxResults)` inside the `web_search`
branch, after the query and apiKey checks. `handleWebSearch()` retains its own
defensive check — both layers validate independently.

Invalid: string, 0, negative, non-integer, above `SEARCH_MAX_RESULTS` (20).
Valid: missing, 1–20.

### BrowserClaw-side protocol `web_search.maxResults` cap parity

`parseExtensionRequest()` in `src/extension/protocol.ts` now rejects
`web_search.maxResults > 20`. Protocol.ts and service-worker agree:

```text
web_search.maxResults => optional positive integer <= 20
read_page.maxChars    => optional positive integer <= 50_000
read_pages.maxChars   => optional positive integer <= 50_000
```

### Explicit test evidence cleanup

Added previously-missing protocol tests:

- `read_page.maxChars: "1000"` (string) rejected.
- `read_page.maxChars: 50000` (at cap) accepted.
- `read_pages.maxChars: "1000"` (string) rejected.
- `read_pages.maxChars: 1.5` rejected.
- `read_pages.maxChars: 50000` (at cap) accepted.

Added service-worker central-schema tests (B1 describe block) for all 6
`web_search.maxResults` invalid/valid cases.

Added B2 direct-handler tests that bypass central schema via `handlers['web_search']`
and use `vi.stubGlobal('fetch', ...)` to verify the search URL includes the
correct `count` parameter.

---

## Gate evidence (2026-06-30)

| Command | Result |
|---|---|
| `pnpm run typecheck` | PASS |
| `pnpm run lint` | PASS (0 warnings) |
| `pnpm run format:check` | PASS |
| `pnpm test -- --no-file-parallelism` | PASS — 127 test files, 1454 tests |
| `pnpm run test:e2e` | PASS — 30 tests (chromium + firefox) |
| `pnpm run test:extension:e2e` | CANNOT RUN in this env — `browserType.launchPersistentContext: Target page, context or browser has been closed`; no persistent Chrome available outside Docker |
| `pnpm run test:extension:e2e:docker` | PASS — 5 tests (Docker build + run) |
| `pnpm run build` | PASS — bundle built in ~520ms; large-chunk size warning is pre-existing, not a failure |
| `pnpm run build:wasm` | PASS — claw-wasm compiled and optimized |
| `cargo test --workspace` | PASS — 0 tests (no Rust unit tests in workspace yet) |
| `cargo clippy --workspace --all-targets -- -D warnings` | PASS — 0 warnings |

---

## Extension E2E status

`pnpm run test:extension:e2e` cannot run directly in this environment because
Playwright cannot launch a persistent Chrome context with a loaded extension
(no display, no persistent profile directory). The Docker lane
(`pnpm run test:extension:e2e:docker`) passes (5/5). The direct lane failure is
an environment constraint, not a FIX12 regression.

No extension E2E logic was changed in FIX12 (only JS-level handler and TS
provider logic). The Docker lane result is the authoritative extension E2E
result for this pass.
