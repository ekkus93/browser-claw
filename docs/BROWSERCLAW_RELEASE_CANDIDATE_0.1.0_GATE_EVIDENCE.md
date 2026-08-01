# BrowserClaw 0.1.0 RC Gate Evidence

## Evidence status

This file records verified automated and artifact-inspection evidence for BrowserClaw 0.1.0 release-candidate preparation. It is **not** final RC signoff. Manual production-host, real-provider, local-model, clean-profile extension, migration, accessibility, cross-platform, and soak evidence remains pending.

## Candidate identity

- Product version: `0.1.0`
- Intended RC tag: `v0.1.0-rc.1`
- Exact tested commit: `09cf80b96a2d678e1ff948dda493cfbe2ba44c38`
- Branch/event: `master` / `push`
- GitHub Actions run: `30718901969`
- Run start: `2026-08-01T21:19:51Z`
- Artifact creation: `2026-08-01T21:22:01Z`
- Result: `PASS`

No release tag was created during this gate. The release job correctly remained skipped on the branch push.

## Environment and toolchain

Recorded from the exact-SHA GitHub-hosted Ubuntu 24.04 jobs:

- Runner OS: Ubuntu `24.04.4` LTS
- Runner image: `ubuntu-24.04`, image version `20260720.247.2`
- Node.js: `v22.23.1`
- pnpm: `10.34.5`
- Rust: `rustc 1.97.1 (8bab26f4f 2026-07-14)`
- wasm-pack: pinned `0.13.1`
- Playwright package: `1.60.0`
- Playwright Chromium: Chrome for Testing `148.0.7778.96`
- Playwright Firefox: `150.0.2`
- TypeScript: `6.0.3`
- Vite: `8.0.16`
- Docker extension gate: GitHub-hosted Ubuntu runner executing the repository Docker build/run command

The workflow uses `pnpm install --frozen-lockfile` in every JavaScript job.

## Authoritative job results

| Job | Result | Evidence summary |
| --- | --- | --- |
| GitHub Actions / actionlint | PASS | Workflow syntax and expressions validated with pinned actionlint `v1.7.7`. |
| Release configuration | PASS | Package, manifest, stable extension key/ID, production origin, and release policy validated. |
| TypeScript | PASS | `pnpm run typecheck`. |
| Lint + Format | PASS | ESLint with zero warnings and Prettier check. |
| Unit tests | PASS | 166 test files, 1,485 tests, zero failed. React state-update warnings are configured to fail tests. |
| Rust | PASS | `cargo fmt`, workspace tests, and Clippy with `-D warnings`. |
| Browser E2E | PASS | 30/30 Playwright tests: 15 Chromium and 15 Firefox. |
| Extension E2E | PASS | Docker-based Chrome extension suite passed. |
| Build and package RC artifacts | PASS | Real WASM build, strict production build, deterministic archives, manifest/checksum verification, and artifact upload. |

## Commands represented by the gate

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
pnpm run test:e2e
pnpm run test:extension:e2e:docker
pnpm run build:wasm
pnpm run build:release
GITHUB_REF_NAME=v0.1.0-rc.1 pnpm run package:release
pnpm run verify:release-artifacts
```

## Production build identity

The strict build used:

```text
VITE_RELEASE_VERSION=0.1.0
VITE_GIT_SHA=09cf80b96a2d678e1ff948dda493cfbe2ba44c38
VITE_BUILD_UTC=2026-08-01T21:21:43Z
VITE_RELEASE_CHANNEL=rc
VITE_BASE_PATH=/browser-claw/
VITE_CHROME_EXTENSION_ID=mgobfbgnjfnlpahiniaincgpkinnodka
VITE_DEMO_MODE=false
VITE_ALLOW_REFERENCE_RUNTIME_FALLBACK=false
VITE_ALLOW_MOCK_PROVIDER=false
```

The build completed with real Rust/WASM output and fail-closed runtime policy. The JavaScript bundle was split so every emitted JavaScript chunk was below 300 kB; the largest reported chunks were approximately 295.37 kB and 290.84 kB.

## RC dry-run artifacts

GitHub Actions artifact:

- Artifact ID: `8824233221`
- Name: `browserclaw-rc-dry-run-09cf80b96a2d678e1ff948dda493cfbe2ba44c38`
- Uploaded size: `2,244,477` bytes
- GitHub artifact ZIP digest: `sha256:d8a948f35941ea793dc6ea67e1a63737a6f0e7ba118e424086613cce71c7ff90`
- Retention expiration: `2026-08-15T21:22:00Z`

Nested release archives:

```text
679725b7af1d2b2ae61f3de44572cdaa9af1448604fe368cf8e3c940c2b82243  browserclaw-app-0.1.0-rc.1.zip
c2af6e93c7343988c14a46156b3783cef701e62cfc93a1811fa178b40b07b3d6  browserclaw-extension-0.1.0-rc.1.zip
```

The artifact also contains:

- `browserclaw-release-manifest.json`
- `SHA256SUMS`

## Independent artifact inspection

The downloaded CI artifact was inspected separately from the build job.

Result: `PASS`

Verified:

- outer artifact ZIP integrity;
- nested application and extension ZIP CRC integrity;
- `SHA256SUMS` matches both archives and the release manifest;
- release manifest version, exact commit SHA, channel, production URL, and extension ID;
- application archive contains HTML, JavaScript, CSS, fonts, multiple WASM assets, `404.html`, and `release-metadata.json`;
- extension archive contains only the manifest, service worker, extraction code, and README under one package directory;
- production extension sender policy includes `https://ekkus93.github.io/browser-claw` and rejects broad wildcard-origin packaging;
- archive member paths contain no absolute paths or parent-directory traversal;
- deterministic ZIP timestamps are fixed;
- no source maps, `.env` files, private-key-like files, tests, fixtures, source-control metadata, or `node_modules` are present;
- no tested common credential patterns were found in packaged text content;
- packaged safety overrides are false;
- embedded application SHA matches the exact tested commit.

This is structural and static inspection. It does not replace loading the extracted artifacts in a clean Chrome profile and production-like host.

## Regression fixes proven by this gate

- Synchronized application and extension version identity at `0.1.0`.
- Replaced stale hardcoded UI version with typed build metadata.
- Added exact SHA and release-channel diagnostics.
- Added strict production-origin and extension-ID validation.
- Added a stable unpacked-extension ID derived from the committed public manifest key.
- Added exact parsed sender-origin validation and lookalike-origin regression tests.
- Fixed an MV3 tab-load race by combining bounded polling with the completion event.
- Made React `act(...)` warnings fail the test suite and repaired affected tests.
- Added deterministic application and extension packaging, release manifest, and checksums.
- Added exact-SHA GitHub Pages and prerelease workflows.
- Added subpath routing and SPA fallback output.
- Added CSP/referrer policy and deployment-header guidance.
- Split the production JavaScript bundle without raising the warning threshold.
- Added WASM package description, repository, and license metadata.

## Pending manual and external evidence

Status for each item below is `NOT RUN` unless a later evidence section is appended:

- tag creation and actual GitHub prerelease publication;
- GitHub Pages deployment and production-route/header smoke test;
- extracted application archive hosted on a production-like server;
- extracted extension loaded in a clean real-Chrome profile;
- real extension ID/connection/page-read/Brave Search flow from packaged artifacts;
- real remote provider chat and normalized error matrix;
- real Ollama/OpenAI-compatible local endpoint flow;
- real GGUF download, cache, inference, reload, and deletion;
- SecretVault manual lifecycle with real provider credentials;
- migration from all supported historical database versions;
- encrypted backup/restore and rollback drill using production artifacts;
- keyboard-only, screen-reader-oriented, 200% zoom, and narrow-width accessibility review;
- minimum/current Chrome and current Firefox production-package matrix;
- second operating-system clean-profile test;
- full-history secret scan and dependency advisory/license review;
- defined RC soak period;
- final `v0.1.0` promotion.

## Decision

Automated pre-tag gate: `PASS`

Release-candidate publication decision: `HOLD`

Reason: automated release engineering and static artifact inspection are green, but the remaining P0 manual production-artifact, real-service, security-scan, migration/backup, and soak gates have not been completed.
