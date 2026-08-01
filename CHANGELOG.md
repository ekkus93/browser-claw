# Changelog

All notable BrowserClaw changes are documented here.

## [Unreleased]

### Release status

- BrowserClaw 0.1.0 is in release-candidate preparation.
- Automated pre-tag gates and static artifact inspection pass.
- `v0.1.0-rc.1` has not been published because required manual and external acceptance remains incomplete.

## [0.1.0] - Unreleased

### Added

- Rust/WASM browser agent runtime with fail-closed startup behavior.
- React/Redux application shell and primary product routes.
- Browser-local persistence, runtime snapshots, and recovery visibility.
- Remote-provider configuration and normalized provider errors.
- Browser-local GGUF model support through wllama.
- In-memory SecretVault and encrypted credential workflows.
- Workspace files and sandboxed QuickJS execution.
- Skills, skill packages, memories, durable audit events, backup, restore, import, and export.
- Chrome Web Research Companion with optional host permissions, page extraction, multi-page reading, and Brave Search.
- Typed immutable release metadata for version, commit SHA, build UTC, release channel, and extension ID.
- Stable unpacked-extension identity `mgobfbgnjfnlpahiniaincgpkinnodka` derived from a committed public manifest key.
- Production origin and sender-path validation with lookalike-origin regression coverage.
- Deterministic application and extension archives.
- Machine-readable release manifest and SHA-256 checksum file.
- Exact-SHA GitHub Pages deployment workflow.
- Exact-SHA RC dry-run artifact build on every `master` candidate.
- Actionlint, Rust formatting, strict release configuration, and warning-fatal test policies.
- Deployment, privacy, release, gate-evidence, review-notes, and project-status documentation.

### Changed

- Synchronized application and extension versions at `0.1.0`.
- Replaced stale hardcoded UI version text with build metadata.
- Made release builds fail when required metadata, extension identity, production base path, or safety policy is invalid.
- Made first-party ESLint warnings fatal.
- Made React unwrapped state-update warnings fail the unit suite.
- Split the production JavaScript bundle into bounded runtime/vendor groups rather than increasing the warning threshold.
- Restricted release extension packaging to the minimum required files.
- Generated the packaged service-worker production origin policy from the central release configuration.
- Added explicit job timeouts and release dependencies so skipped, cancelled, or failed required jobs cannot publish a release.

### Fixed

- Fixed an MV3 tab-completion race that could make extension page reads time out in constrained environments.
- Fixed test teardown ordering around Dexie and SecretVault subscribers.
- Fixed Redux test dispatches that occurred outside React `act(...)`.
- Fixed subpath routing and SPA fallback output for GitHub Pages.
- Fixed missing WASM crate description, repository, and license-file metadata.

### Security

- Added exact scheme/host/port/path sender validation for external extension messages.
- Added regression tests for malformed URLs, wrong schemes, wrong ports, suffix tricks, subdomains, and path-prefix lookalikes.
- Added strict production checks that demo mode, mock provider, and reference-runtime fallback are disabled.
- Added CSP and referrer policy to the application and documented production response headers.
- Added deterministic least-content packaging and artifact scans for environment files, private-key-like files, tests, fixtures, source-control metadata, and tested common secret patterns.

### Known limitations

- No Firefox companion extension.
- Current-tab reading is unavailable in 0.1.0.
- Chrome Web Store distribution is not part of the 0.1.0 contract.
- No BrowserClaw account service, managed cloud synchronization, managed cloud backup, telemetry, or analytics.
- Brave Search requires a user-supplied key.
- Local model performance depends on browser, hardware, memory, and selected model.
- Provider and model-host requests remain subject to third-party CORS, privacy, rate-limit, and availability behavior.
- Manual production-artifact, real-provider, local-model, migration/backup, accessibility/compatibility, security-scan, and soak evidence is still required before RC publication.
