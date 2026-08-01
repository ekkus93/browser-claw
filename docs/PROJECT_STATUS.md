# BrowserClaw Project Status

## Current state

**Milestone:** 0.1.0 release-candidate preparation  
**Release status:** Automated pre-tag gate passes; RC publication is on hold pending manual and external acceptance.  
**Intended RC:** `v0.1.0-rc.1`  
**Intended final release:** `v0.1.0`

This document is the authoritative current-state summary. Older TODO, phase, FIX, and hardening documents are implementation history unless this file or the active RC TODO explicitly references them.

## Product summary

BrowserClaw is a browser-only, local-first agent console. Its implemented architecture includes:

- a shared Rust core compiled to WebAssembly;
- React/Redux browser UI;
- browser-local data in IndexedDB and browser-managed storage;
- runtime snapshots and recovery behavior;
- remote model-provider adapters configured by the user;
- browser-local GGUF inference through wllama;
- workspace files and sandboxed QuickJS execution;
- skills and skill-package installation/state;
- memories and durable audit events;
- backup, restore, import, and export;
- optional Chrome companion extension for page reading and Brave Search;
- approval, permission, redaction, SSRF, and fail-closed security controls.

## Release contract

### Distribution

- Application: static web application and GitHub Pages deployment.
- Canonical URL: `https://ekkus93.github.io/browser-claw/`.
- Base path: `/browser-claw/`.
- Chrome extension: unpacked developer-mode ZIP for 0.1.0.
- Stable extension ID: `mgobfbgnjfnlpahiniaincgpkinnodka`.
- GitHub release: public prerelease for the RC.

### Provisional support statement

The support statement remains provisional until the manual matrix is recorded:

- Chrome 130 or later: primary browser.
- Firefox 128 ESR or later: non-extension functionality only.
- Desktop Linux, macOS, and Windows: intended platforms.

### Intentional limitations

- No Firefox companion extension.
- Current-tab reading is unavailable in 0.1.0.
- No BrowserClaw account service.
- No managed cloud synchronization or managed cloud backup.
- No product telemetry or analytics.
- Brave Search requires a user-supplied API key.
- Provider and model-host behavior is subject to third-party CORS, privacy, rate-limit, and availability policies.
- Local model performance depends on browser, model, memory, and hardware.
- Chrome Web Store distribution is not part of the 0.1.0 contract.

## Production configuration

The production release contract is defined by `release/release-config.json` and validated by `scripts/validate-release-config.mjs`.

Required release build values:

```text
VITE_RELEASE_VERSION=0.1.0
VITE_RELEASE_CHANNEL=rc or stable
VITE_GIT_SHA=<full 40-character SHA>
VITE_BUILD_UTC=<ISO-8601 UTC timestamp>
VITE_BASE_PATH=/browser-claw/
VITE_CHROME_EXTENSION_ID=mgobfbgnjfnlpahiniaincgpkinnodka
VITE_DEMO_MODE=false
VITE_ALLOW_REFERENCE_RUNTIME_FALLBACK=false
VITE_ALLOW_MOCK_PROVIDER=false
```

Provider credentials are entered at runtime and are not release environment variables.

## Latest verified automated gate

- Exact SHA: `09cf80b96a2d678e1ff948dda493cfbe2ba44c38`
- GitHub Actions run: `30718901969`
- Result: all authoritative non-tag jobs passed.
- Unit tests: 166 files, 1,485 tests, zero failed.
- Playwright: 30/30 passed across Chromium and Firefox.
- Docker extension E2E: passed.
- Rust: formatting, workspace tests, and Clippy with warnings denied passed.
- Strict production build: passed.
- Deterministic archives and checksums: passed.
- Exact-SHA artifact upload: passed.

See `docs/BROWSERCLAW_RELEASE_CANDIDATE_0.1.0_GATE_EVIDENCE.md` for exact commands, versions, checksums, artifact identity, and limitations.

## Release artifacts

The CI dry-run produces:

- `browserclaw-app-0.1.0-rc.1.zip`;
- `browserclaw-extension-0.1.0-rc.1.zip`;
- `browserclaw-release-manifest.json`;
- `SHA256SUMS`.

The latest inspected dry-run artifact passed checksum, ZIP-integrity, safe-path, metadata, origin-policy, forbidden-file, and tested secret-pattern checks. It has not yet passed clean-profile runtime smoke testing.

## Security and privacy posture

Implemented release controls include:

- exact production sender-origin parsing for external extension messages;
- stable extension identity validation;
- optional host permissions rather than all-sites install-time access;
- shared URL/SSRF defenses in the existing application and extension code paths;
- strict production safety-override validation;
- no BrowserClaw telemetry;
- runtime credentials entered by the user and intended to remain in the in-memory SecretVault;
- deterministic least-content release archives;
- CSP and referrer policy in the application, with deployment-header guidance;
- React state-update warnings made test-fatal;
- first-party lint, formatting, TypeScript, Rust, workflow, browser, extension, and packaging gates.

Privacy details are in `docs/PRIVACY.md`.

## Documentation map

- Active implementation contract: `docs/BROWSERCLAW_RELEASE_CANDIDATE_0.1.0_TODO.md`
- Gate evidence: `docs/BROWSERCLAW_RELEASE_CANDIDATE_0.1.0_GATE_EVIDENCE.md`
- Review findings: `docs/BROWSERCLAW_RELEASE_CANDIDATE_0.1.0_REVIEW_NOTES.md`
- Release guide: `docs/RELEASE_0.1.0.md`
- Deployment: `docs/DEPLOYMENT.md`
- Privacy: `docs/PRIVACY.md`
- Historical architecture and hardening records: remaining phase/FIX documents under `docs/`

## Remaining blockers before publishing `v0.1.0-rc.1`

- Full-history and release-content secret scan with adjudication.
- JavaScript and Rust dependency advisory/license review.
- Exact-SHA GitHub Pages deployment and production-route/header smoke test.
- Extracted application archive smoke test on a production-like server.
- Extracted extension archive loaded in a clean real-Chrome profile.
- Packaged extension connection, permission, page-read, and Brave Search tests.
- At least one real remote provider flow and error matrix.
- Supported local endpoint and real wllama model lifecycle.
- Manual SecretVault lifecycle with storage/log/audit inspection.
- Migration, backup, encrypted restore, rollback, tamper, wrong-passphrase, and quota-pressure drills.
- Keyboard-only, zoom, accessibility, and browser compatibility matrix.
- Clean-profile validation on another operating system.
- Final exact-SHA gate after all accepted changes.

## Next milestone

Complete the manual/external acceptance matrix using CI-generated archives. Record evidence against one immutable candidate SHA. Publish `v0.1.0-rc.1` only when all remaining P0 blockers pass. After a defined soak period, either promote the accepted RC to `v0.1.0` or issue a new RC and rerun the full gate.
