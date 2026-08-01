# BrowserClaw

[![CI](https://github.com/ekkus93/browser-claw/actions/workflows/ci.yml/badge.svg)](https://github.com/ekkus93/browser-claw/actions/workflows/ci.yml)

A browser-only, local-first AI agent console: similar in spirit to OpenClaw, but hosted entirely in the browser.

BrowserClaw has no required application server or account system. Durable application state lives in browser-managed storage. Decrypted provider credentials are intended to remain only in the in-memory SecretVault and are never release build variables.

## Release status

BrowserClaw is preparing its first release candidate:

- product version: `0.1.0`;
- intended prerelease: `v0.1.0-rc.1`;
- intended final release: `v0.1.0`;
- automated exact-SHA gate: passing;
- RC publication: **on hold** pending manual production-artifact, provider, model, migration/backup, security, compatibility, accessibility, and soak acceptance.

See [`docs/PROJECT_STATUS.md`](docs/PROJECT_STATUS.md) for the authoritative state and [`docs/BROWSERCLAW_RELEASE_CANDIDATE_0.1.0_GATE_EVIDENCE.md`](docs/BROWSERCLAW_RELEASE_CANDIDATE_0.1.0_GATE_EVIDENCE.md) for exact test and artifact evidence.

## Features

- Rust/WASM agent runtime with fail-closed startup behavior.
- React/Redux browser interface and durable IndexedDB-backed data.
- Runtime snapshots, recovery visibility, and audit events.
- Remote provider adapters configured by the user.
- Browser-local GGUF inference through wllama.
- In-memory SecretVault and encrypted credential workflows.
- Workspace files and sandboxed QuickJS execution.
- Skills, memories, backup, restore, import, and export.
- Chrome Web Research Companion for permission-scoped page reading and Brave Search.
- Approval, permission, redaction, SSRF, origin-isolation, and artifact-hardening controls.

## Tech stack

| Layer | Technology |
| --- | --- |
| UI | React 19 + TypeScript (strict) + Vite + Tailwind CSS v4 |
| State | Redux Toolkit for transient UI/session state |
| Storage | Dexie / IndexedDB for durable application data |
| Router | React Router v7 |
| Runtime | Rust/WASM (`claw-core`, `claw-wasm`, `claw-schema`) |
| Local models | wllama for browser-local GGUF inference |
| Scripting | QuickJS for sandboxed JavaScript execution |
| Web research | Chrome MV3 extension + Brave Search API |

## Provisional support statement

The manual compatibility matrix is not complete. The current 0.1.0 release contract targets:

- Chrome 130 or later as the primary browser;
- Firefox 128 ESR or later for non-extension functionality;
- desktop Linux, macOS, and Windows.

The Chrome companion extension is not available in Firefox. Edge is not part of the current support statement.

## Prerequisites

- Node.js 22 recommended;
- pnpm 10;
- Rust and Cargo;
- `wasm-pack` 0.13.1 for parity with CI;
- Docker, optional but recommended for authoritative extension E2E tests.

## Development setup

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm run build:wasm
pnpm run dev
```

The development application runs at `http://localhost:5173`.

## Production build

A normal local production build uses development metadata:

```bash
pnpm run build:wasm
pnpm run build
```

A strict release build requires the complete non-secret release contract:

```bash
export VITE_RELEASE_VERSION=0.1.0
export VITE_RELEASE_CHANNEL=rc
export VITE_GIT_SHA=0123456789abcdef0123456789abcdef01234567
export VITE_BUILD_UTC=2026-08-01T20:00:00Z
export VITE_BASE_PATH=/browser-claw/
export VITE_CHROME_EXTENSION_ID=mgobfbgnjfnlpahiniaincgpkinnodka
export VITE_DEMO_MODE=false
export VITE_ALLOW_REFERENCE_RUNTIME_FALLBACK=false
export VITE_ALLOW_MOCK_PROVIDER=false

pnpm run build:wasm
pnpm run build:release
pnpm run package:release
pnpm run verify:release-artifacts
```

Do not put provider API keys in `.env` files or release variables. Users enter credentials at runtime.

The strict build emits `dist/release-metadata.json` and fails if the product version, full commit SHA, build time, release channel, base path, extension ID, manifest key, production origin, or safety policy is invalid.

## Scripts

| Command | Description |
| --- | --- |
| `pnpm run dev` | Start the Vite development server |
| `pnpm run build` | Validate configuration, type-check, build, and validate normal output |
| `pnpm run build:release` | Strict fail-closed release build with immutable metadata |
| `pnpm run build:wasm` | Compile Rust crates to WebAssembly |
| `pnpm run validate:release-config` | Validate synchronized version, extension identity, and production origin |
| `pnpm run package:release` | Produce deterministic application and extension archives |
| `pnpm run verify:release-artifacts` | Verify release manifest, ZIP signatures, sizes, and SHA-256 checksums |
| `pnpm run typecheck` | TypeScript strict check without emit |
| `pnpm run lint` | ESLint with zero warnings tolerated |
| `pnpm run format` | Apply Prettier formatting |
| `pnpm run format:check` | Verify Prettier formatting |
| `pnpm test` | Lint, format check, and Vitest unit tests |
| `pnpm run test:watch` | Vitest watch mode |
| `pnpm run test:e2e` | Playwright Chromium and Firefox E2E |
| `pnpm run test:e2e:extended` | Heavy network-dependent WASM/model/provider E2E |
| `pnpm run test:extension:e2e` | Local Chrome extension E2E |
| `pnpm run test:extension:e2e:docker` | Authoritative Docker extension E2E |

On constrained machines, run unit tests single-threaded:

```bash
pnpm exec vitest run --no-file-parallelism
```

## Project layout

```text
src/
  screens/        Page-level React components
  components/     Shared UI components
  store/          Redux Toolkit slices and listeners
  runtime/        WASM bindings and agent runtime
  webresearch/    Web research service, types, and limits
  extension/      BrowserClaw ↔ extension protocol and provider
  secrets/        In-memory SecretVault
  db/             Dexie schema and storage helpers
  script/         QuickJS sandbox layer
  workspace/      Workspace and scripting state
  audit/          Durable audit event log
  providers/      Remote and local provider adapters

extension/
  chrome-web-research/
    manifest.json
    service-worker.js
    content-extract.js

crates/
  claw-core/
  claw-schema/
  claw-wasm/
  claw-testkit/

release/
  release-config.json

scripts/
  validate-release-config.mjs
  postbuild.mjs
  package_release.py
  verify-release-artifacts.mjs

docs/
  PROJECT_STATUS.md
  RELEASE_0.1.0.md
  DEPLOYMENT.md
  PRIVACY.md
```

## Chrome extension

The Web Research Companion source lives in `extension/chrome-web-research/`.

### Development installation

1. Build or use the source extension directory.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Select **Load unpacked**.
5. Select `extension/chrome-web-research/`.

### RC package installation

1. Verify `browserclaw-extension-0.1.0-rc.1.zip` against `SHA256SUMS`.
2. Extract the ZIP.
3. Open `chrome://extensions` and enable **Developer mode**.
4. Select **Load unpacked** and choose the extracted `browserclaw-extension` directory.
5. Confirm Chrome reports extension ID `mgobfbgnjfnlpahiniaincgpkinnodka`.
6. Open BrowserClaw Settings and confirm the extension connects.

The extension requests host access separately for user-approved sites. It does not request all-sites host access at installation. Brave Search requires a user-supplied API key held by SecretVault for the active session/request path.

Current-tab reading is intentionally unavailable in 0.1.0. Use page reading with an explicit URL.

## Security and privacy model

- Decrypted API keys and OAuth tokens must not appear in Redux state, localStorage, logs, audit details, screenshots, or release artifacts.
- The in-memory SecretVault is the only intended location for decrypted secrets.
- Production builds fail if demo mode, mock provider, or reference-runtime fallback is enabled.
- External extension messages require the configured BrowserClaw origin and application path.
- Page reads require explicit host permission and pass URL/SSRF restrictions.
- Meaningful side effects follow the documented approval and audit policy.
- BrowserClaw 0.1.0 has no product telemetry or analytics.

See [`docs/PRIVACY.md`](docs/PRIVACY.md).

## Running the release gate

```bash
pnpm install --frozen-lockfile
pnpm run validate:release-config
pnpm run typecheck
pnpm run lint
pnpm run format:check
pnpm exec vitest run --no-file-parallelism
cargo fmt --all -- --check
cargo test --workspace
cargo clippy --workspace --all-targets --all-features -- -D warnings
pnpm run build:wasm
pnpm run test:e2e
pnpm run test:extension:e2e:docker
```

GitHub Actions additionally performs a strict exact-SHA RC build, packages deterministic archives, verifies checksums and metadata, and uploads the dry-run artifacts on every `master` candidate.

## Troubleshooting

### WASM runtime load failure

Confirm the application archive contains the hashed `claw_wasm` JavaScript and WASM files, the host serves `.wasm` with the correct MIME type, and the displayed commit SHA matches `release-metadata.json`. Production must fail closed rather than silently using a reference runtime.

### Extension missing or wrong ID

Confirm the loaded extension ID is `mgobfbgnjfnlpahiniaincgpkinnodka`, the application was built with the same ID, and the application URL is an allowed external-message origin. Source and packaged extensions must not be mixed across releases.

### Provider CORS failure

BrowserClaw cannot bypass a provider's browser CORS policy. Use an endpoint that explicitly permits the BrowserClaw origin. Provider failures should appear as error cards, not synthetic assistant responses.

### Locked or missing secret

Unlock SecretVault and verify the selected provider profile references an existing key. Browser refreshes may intentionally require credentials to be entered or unlocked again.

### Storage quota failure

Delete unneeded local models or browser data only after creating and verifying a backup. Quota failures must not be treated as successful persistence.

### wllama compatibility

Use a compatible GGUF model and browser with adequate memory. Model downloads are large and hardware-dependent. The extended E2E suite is network-dependent and not a substitute for the manual supported-hardware matrix.

### Host permission denial

Grant access only to the intended site when prompted. A denied or missing permission should remain visible and must not be bypassed by broad install-time host access.

## Known limitations

- The release candidate has not yet passed the complete manual acceptance matrix.
- No Firefox companion extension.
- No current-tab reading.
- No BrowserClaw account, managed sync, managed cloud backup, telemetry, or analytics.
- No Chrome Web Store distribution for 0.1.0.
- Remote service behavior remains dependent on third parties.
- Local model performance is hardware- and model-dependent.

## Release and deployment documentation

- [`docs/RELEASE_0.1.0.md`](docs/RELEASE_0.1.0.md)
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)
- [`docs/PRIVACY.md`](docs/PRIVACY.md)
- [`docs/BROWSERCLAW_RELEASE_CANDIDATE_0.1.0_REVIEW_NOTES.md`](docs/BROWSERCLAW_RELEASE_CANDIDATE_0.1.0_REVIEW_NOTES.md)
- [`docs/BROWSERCLAW_RELEASE_CANDIDATE_0.1.0_GATE_EVIDENCE.md`](docs/BROWSERCLAW_RELEASE_CANDIDATE_0.1.0_GATE_EVIDENCE.md)
