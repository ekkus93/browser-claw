# BrowserClaw Release Candidate 0.1.0 TODO

## Purpose

Prepare, validate, package, and publish the first BrowserClaw release candidate as
`v0.1.0-rc.1`, then promote it to `v0.1.0` only after the candidate passes the full
acceptance process.

This is a release-readiness pass, not a broad feature-development pass. BrowserClaw's
core application, runtime, storage, provider, skills, workspace, scripting, web research,
security, and audit systems are already substantially implemented. This TODO focuses on:

- production configuration;
- exact-SHA automated verification;
- real-browser and extension verification;
- security and privacy review;
- versioning and release packaging;
- deployment and user documentation;
- release evidence and signoff.

## Starting Point

- Repository: `ekkus93/browser-claw`
- Default branch: `master`
- Baseline commit when this TODO was created:
  `929409028a326fcfd3dce507d923cea924514af4`
- Baseline implementation status:
  - original BrowserClaw Phase 0-13 TODO complete;
  - runtime/storage/security hardening substantially complete;
  - workspace/scripting/web-research work complete through FIX13;
  - latest recorded unit-test count: 1,462;
  - latest recorded regular browser E2E result: 30 passing;
  - latest recorded Docker extension E2E result: 5 passing.

The historical results above are context only. They are **not** release evidence for the
RC. Every required gate must be rerun on the exact candidate SHA.

## Priority Key

```text
P0 = release blocker: security, correctness, data loss, false capability claim,
     unusable package, or missing exact-SHA evidence
P1 = required for the 0.1.0 release contract
P2 = worthwhile hardening or polish that may be deferred only with an explicit,
     documented decision and no false release claim
```

## Checkbox and Evidence Rules

- [ ] Do not check a task without evidence.
- [ ] Record the exact commit SHA for every gate run.
- [ ] Record exact commands and actual results; do not summarize a failed or skipped
      command as passing.
- [ ] Distinguish `PASS`, `FAIL`, `NOT RUN`, and `CANNOT RUN`.
- [ ] A historical result from FIX1-FIX13 does not satisfy an RC gate.
- [ ] Do not release with an unexplained dirty working tree.
- [ ] Do not release from a SHA that differs from the SHA whose artifacts were tested.
- [ ] Do not silently enable demo mode, the mock provider, or reference-runtime fallback
      in a production artifact.
- [ ] Do not broaden this pass with unrelated features after release freeze.

---

# Phase 0 — Scope Lock and Release Contract

## 0.1 Define the release candidate

- [ ] P0 Confirm the first candidate tag is `v0.1.0-rc.1`.
- [ ] P0 Confirm the intended final tag is `v0.1.0`.
- [ ] P0 Define whether `v0.1.0-rc.1` is:
  - [ ] a public GitHub prerelease;
  - [ ] an internal/private test release;
  - [ ] a Chrome Web Store test-channel submission;
  - [ ] an unpacked-extension release only.
- [ ] P0 Define the production application origin or origins.
- [ ] P0 Define the Chrome extension distribution model:
  - [ ] Chrome Web Store stable listing;
  - [ ] Chrome Web Store unlisted/test listing;
  - [ ] self-hosted CRX;
  - [ ] unpacked developer-mode extension only.
- [ ] P0 Define the stable production Chrome extension ID.
- [ ] P0 Define the minimum supported browsers and versions.
- [ ] P1 Define supported operating systems for 0.1.0.
- [ ] P1 Define the 0.1.0 feature contract and known limitations.
- [ ] P1 Explicitly document that Firefox does not have the Chrome companion extension in
      0.1.0, unless Firefox extension support is added before release.
- [ ] P1 Explicitly document the current-tab-reading policy and whether it is intentionally
      unavailable in 0.1.0.

## 0.2 Freeze rules

- [ ] P0 Create or designate a release branch, recommended:
      `release/0.1.0`.
- [ ] P0 Record the branch point SHA.
- [ ] P0 Allow only release-blocker fixes, tests, release configuration, and documentation
      after freeze.
- [ ] P0 Require each post-freeze code change to include regression tests.
- [ ] P0 Require a new full gate after every post-freeze code change.
- [ ] P1 Triage all open issues and pull requests against the 0.1.0 contract.
- [ ] P1 Label or document each deferred item as post-0.1.0 rather than leaving ambiguous
      unchecked requirements.

## 0.3 Release evidence files

- [ ] P1 Create `docs/BROWSERCLAW_RELEASE_CANDIDATE_0.1.0_REVIEW_NOTES.md`.
- [ ] P1 Create `docs/BROWSERCLAW_RELEASE_CANDIDATE_0.1.0_GATE_EVIDENCE.md`.
- [ ] P1 In the gate evidence file, record:
  - [ ] exact candidate SHA;
  - [ ] UTC timestamps;
  - [ ] toolchain versions;
  - [ ] exact commands;
  - [ ] pass/fail status;
  - [ ] test counts;
  - [ ] artifact names and checksums;
  - [ ] manual QA operator and environment;
  - [ ] known limitations and deferrals.

---

# Phase 1 — Version Identity and Build Metadata

## 1.1 Synchronize versions

- [ ] P0 Change the application version in `package.json` from `0.0.0` to `0.1.0`.
- [ ] P0 Set the Chrome extension `manifest.json` version to `0.1.0`.
- [ ] P1 Add `version_name: "0.1.0-rc.1"` for the RC package if appropriate for the
      chosen extension distribution channel.
- [ ] P0 Ensure the application, extension, release archive names, and release notes all
      identify the same product version.
- [ ] P0 Add a test or validation script that fails when application and extension versions
      diverge.
- [ ] P1 Surface the application version in the UI from build metadata rather than a stale
      hardcoded value.
- [ ] P1 Surface the commit SHA or short SHA in an About/Diagnostics area.
- [ ] P1 Surface the runtime mode (`wasm` or explicitly enabled development fallback) in
      diagnostics.
- [ ] P1 Verify no RC artifact identifies itself as `0.0.0`.

## 1.2 Embed immutable build metadata

- [ ] P1 Add build-time values for:
  - [ ] release version;
  - [ ] git commit SHA;
  - [ ] build UTC timestamp;
  - [ ] release channel (`development`, `rc`, or `stable`).
- [ ] P1 Expose the metadata through a typed module.
- [ ] P1 Add tests for missing or malformed release metadata.
- [ ] P1 Make release builds fail if version or commit metadata is absent.
- [ ] P2 Include the metadata in an exported diagnostics report without including secrets.

---

# Phase 2 — Production Application Configuration

## 2.1 Production origin and routing

- [ ] P0 Choose the production application URL.
- [ ] P0 Verify the deployed host serves the Vite SPA entry point for client-side routes
      such as `/chat`, `/settings`, `/workspace`, and `/security`.
- [ ] P0 Add deployment documentation for SPA fallback/rewrite configuration.
- [ ] P0 Verify direct navigation and refresh on every primary route.
- [ ] P1 Verify asset URLs work when deployed at the selected base path.
- [ ] P1 If subpath deployment is supported, configure and test Vite `base` explicitly.
- [ ] P1 Verify service-worker or browser caches cannot keep incompatible application and
      WASM versions indefinitely.

## 2.2 Production environment policy

- [ ] P0 Define an explicit production `.env` contract without committing secrets.
- [ ] P0 Require `VITE_CHROME_EXTENSION_ID` for a production web-research build.
- [ ] P0 Fail the production build when the extension ID is blank or a known placeholder.
- [ ] P0 Confirm these flags are absent or false in the production artifact:
  - [ ] `VITE_DEMO_MODE`;
  - [ ] `VITE_ALLOW_REFERENCE_RUNTIME_FALLBACK`;
  - [ ] `VITE_ALLOW_MOCK_PROVIDER`.
- [ ] P0 Add an automated artifact test proving no production safety override is enabled.
- [ ] P0 Verify the production UI does not show a safety-override banner.
- [ ] P1 Verify development builds still support explicit test overrides without affecting
      production packaging.
- [ ] P1 Document every supported `VITE_*` setting and its security implications.

## 2.3 Runtime and WASM asset loading

- [ ] P0 Build the Rust/WASM runtime from a clean checkout.
- [ ] P0 Verify the production application loads the real WASM runtime.
- [ ] P0 Verify a missing, corrupted, or incompatible WASM file produces the blocking
      fail-closed UI rather than silently using the reference runtime.
- [ ] P0 Verify the production package contains every required WASM and JavaScript glue
      file.
- [ ] P1 Verify cache headers do not allow stale WASM to remain paired with a newer app.
- [ ] P1 Verify snapshot incompatibility is visible and audited.
- [ ] P1 Verify a corrupt snapshot starts fresh only after recording a visible warning and
      durable audit event.

## 2.4 Content Security Policy and deployment headers

- [ ] P0 Define a CSP compatible with:
  - [ ] bundled application scripts;
  - [ ] WebAssembly;
  - [ ] Web Workers;
  - [ ] QuickJS sandbox assets;
  - [ ] configured remote LLM endpoints;
  - [ ] Hugging Face model downloads;
  - [ ] Chrome extension messaging where applicable.
- [ ] P0 Avoid `unsafe-eval` in the application context.
- [ ] P0 Confirm QuickJS code runs only in the isolated sandbox runtime.
- [ ] P1 Configure or document:
  - [ ] `X-Content-Type-Options: nosniff`;
  - [ ] `Referrer-Policy`;
  - [ ] `Permissions-Policy`;
  - [ ] frame-ancestor or clickjacking protection;
  - [ ] HTTPS-only production deployment.
- [ ] P1 Add a production-host smoke test that checks required headers.

---

# Phase 3 — Chrome Extension Productionization

## 3.1 Manifest and origin allowlist

- [ ] P0 Add the exact production BrowserClaw origin to
      `externally_connectable.matches`.
- [ ] P0 Retain local development origins only if they are an intentional release policy.
- [ ] P0 Do not use broad wildcard origins for external messaging.
- [ ] P0 Verify the service worker independently validates the sender origin.
- [ ] P0 Add tests for:
  - [ ] accepted production origin;
  - [ ] accepted development origin, if retained;
  - [ ] rejected lookalike origin;
  - [ ] rejected wrong scheme;
  - [ ] rejected wrong port;
  - [ ] rejected subdomain or suffix trick;
  - [ ] missing sender URL.
- [ ] P1 Confirm extension name, description, version, and permission descriptions are
      release-ready.

## 3.2 Stable extension ID wiring

- [ ] P0 Obtain or derive the stable production extension ID.
- [ ] P0 Configure release builds with that ID.
- [ ] P0 Verify a missing/wrong ID yields an honest `extension_missing` state.
- [ ] P0 Verify the correct ID yields a connected state.
- [ ] P1 Add CI validation that the configured production ID is nonempty and matches the
      release configuration.
- [ ] P1 Document how developers obtain and configure a local unpacked extension ID.

## 3.3 Permissions and privacy

- [ ] P0 Confirm the extension does not request all-sites host access at installation.
- [ ] P0 Confirm host access remains optional and scoped to user-approved sites.
- [ ] P0 Confirm the extension does not read cookies, form values, authentication tokens,
      or logged-in private content outside the documented contract.
- [ ] P0 Confirm page extraction excludes scripts, styles, and hidden executable content.
- [ ] P0 Confirm blocked targets include:
  - [ ] localhost names;
  - [ ] loopback addresses;
  - [ ] RFC1918 private ranges;
  - [ ] link-local addresses;
  - [ ] cloud metadata addresses;
  - [ ] IPv6 loopback/private/link-local variants;
  - [ ] redirects to blocked targets;
  - [ ] non-HTTP(S) schemes.
- [ ] P0 Verify page-size and character limits are enforced centrally and defensively.
- [ ] P0 Verify search-result limits are enforced centrally and defensively.
- [ ] P1 Prepare a plain-language extension privacy disclosure.
- [ ] P1 Prepare Chrome Web Store permission justifications if Store distribution is used.

## 3.4 Extension package construction

- [ ] P0 Add a deterministic extension packaging command.
- [ ] P0 Package only files required by the extension.
- [ ] P0 Exclude:
  - [ ] `node_modules`;
  - [ ] tests and fixtures;
  - [ ] local environment files;
  - [ ] source-control metadata;
  - [ ] API keys or tokens;
  - [ ] unrelated application source.
- [ ] P0 Validate the packaged ZIP by loading the extracted ZIP in a clean Chrome profile.
- [ ] P1 Include package contents and SHA-256 checksum in release evidence.
- [ ] P2 Produce a reproducible archive and document any unavoidable nondeterminism.

---

# Phase 4 — CI and Release Workflow Hardening

## 4.1 Exact-SHA CI behavior

- [ ] P0 Verify CI runs on the release branch and RC tags.
- [ ] P0 Ensure the release job depends on every required gate:
  - [ ] TypeScript;
  - [ ] lint and formatting;
  - [ ] unit tests;
  - [ ] browser E2E;
  - [ ] Rust tests and Clippy;
  - [ ] WASM/application build;
  - [ ] Docker extension E2E.
- [ ] P0 Ensure a cancelled, skipped, neutral, or missing required job cannot produce a
      release artifact.
- [ ] P0 Ensure tag artifacts are built from the tagged commit, not from another branch
      tip.
- [ ] P0 Record the tag SHA inside the generated application metadata.
- [ ] P1 Add explicit timeouts to long-running CI jobs.
- [ ] P1 Preserve enough logs and artifacts to debug failures.

## 4.2 Production build variables in CI

- [ ] P0 Supply the production extension ID and release metadata to the release build.
- [ ] P0 Keep API keys and provider credentials out of GitHub Actions variables and
      artifacts; BrowserClaw users enter their own keys at runtime.
- [ ] P0 Validate that no release secret is printed in logs.
- [ ] P0 Fail the release job if required non-secret production variables are missing.
- [ ] P1 Add a CI step that inspects built JavaScript and manifest files for placeholders.

## 4.3 Toolchain integrity

- [ ] P1 Pin or verify the `wasm-pack` installer instead of executing an unverified moving
      remote script.
- [ ] P1 Pin major release actions to reviewed versions or immutable commit SHAs.
- [ ] P1 Record Node, pnpm, Rust, wasm-pack, and Playwright versions in gate evidence.
- [ ] P1 Verify the lockfiles are committed and `--frozen-lockfile` is enforced.
- [ ] P2 Add dependency caching only where it cannot hide generated-file drift.

## 4.4 Release artifact improvements

- [ ] P0 Produce versioned application and extension archive names.
- [ ] P0 Generate SHA-256 checksums for each archive.
- [ ] P0 Include a machine-readable release manifest containing:
  - [ ] version;
  - [ ] commit SHA;
  - [ ] build timestamp;
  - [ ] artifact names;
  - [ ] checksums;
  - [ ] supported browser information.
- [ ] P1 Upload the gate-evidence document or equivalent summary with the release.
- [ ] P1 Mark `v0.1.0-rc.1` as a GitHub prerelease.
- [ ] P2 Generate an SBOM for JavaScript and Rust dependencies.
- [ ] P2 Add artifact attestation or provenance if supported by the release environment.

---

# Phase 5 — Clean Automated Release Gate

## 5.1 Clean-room preparation

- [ ] P0 Start from a fresh clone or clean worktree at the candidate SHA.
- [ ] P0 Confirm `git status --porcelain` is empty before installation.
- [ ] P0 Remove or isolate old build outputs, test databases, browser profiles, and cached
      extension packages.
- [ ] P0 Record the following versions:

```bash
node --version
pnpm --version
rustc --version
cargo --version
wasm-pack --version
npx playwright --version
docker --version
```

- [ ] P0 Install dependencies with:

```bash
pnpm install --frozen-lockfile
```

## 5.2 Required static and unit gates

Run and record exact results:

- [ ] P0 `pnpm run typecheck`
- [ ] P0 `pnpm run lint`
- [ ] P0 `pnpm run format:check`
- [ ] P0 `pnpm test -- --no-file-parallelism`
- [ ] P0 Record the exact unit-test file and test counts.
- [ ] P0 Confirm zero skipped tests unless each skip is documented and accepted.
- [ ] P0 Confirm no focused tests such as `.only` exist.
- [ ] P0 Confirm no unexpected snapshots or generated files changed.

## 5.3 Required Rust/WASM gates

- [ ] P0 `cargo fmt --all --check`
- [ ] P0 `cargo test --workspace`
- [ ] P0 `cargo clippy --workspace --all-targets -- -D warnings`
- [ ] P0 `pnpm run build:wasm`
- [ ] P0 Verify generated WASM bindings match the committed/generated-file policy.
- [ ] P0 Verify no dirty tree remains after the WASM build.

## 5.4 Required browser and extension gates

- [ ] P0 `pnpm run test:e2e`
- [ ] P0 Confirm Chromium passes.
- [ ] P0 Confirm Firefox passes for supported non-extension functionality.
- [ ] P0 `pnpm run test:extension:e2e:docker`
- [ ] P0 Record exact extension E2E count.
- [ ] P0 Treat local non-Docker extension E2E as supplementary unless it is made stable and
      authoritative.
- [ ] P1 Run `pnpm run test:e2e:extended`.
- [ ] P1 Fix or explicitly adjudicate every extended-suite failure; do not leave an
      unexplained known flake in RC evidence.
- [ ] P1 Rerun any previously flaky test enough times to establish whether it is stable.

## 5.5 Required production build gate

- [ ] P0 `pnpm run build`
- [ ] P0 Verify the build uses the production RC environment.
- [ ] P0 Inspect the generated `dist/` tree.
- [ ] P0 Verify required WASM, worker, font, and application assets are present.
- [ ] P0 Serve the exact `dist/` output locally and run a smoke test against it.
- [ ] P0 Verify the production build does not require the Vite development server.
- [ ] P0 Confirm `git status --porcelain` remains empty after all gates.

## 5.6 Gate failure policy

- [ ] P0 Any P0 command failure blocks the RC.
- [ ] P0 Fix failures at their root cause; do not weaken tests or suppress warnings merely
      to turn the gate green.
- [ ] P0 After a fix, rerun the complete gate on the new SHA.
- [ ] P0 Never combine evidence from different SHAs into a single passing RC claim.

---

# Phase 6 — Core Application Acceptance

## 6.1 First-run onboarding

- [ ] P0 Test in a fresh browser profile with an empty IndexedDB/OPFS state.
- [ ] P0 Confirm first launch routes to onboarding.
- [ ] P0 Confirm onboarding progress persists across refresh.
- [ ] P0 Confirm inference-mode and provider choices persist.
- [ ] P0 Confirm completion routes to Chat.
- [ ] P0 Confirm subsequent launches do not repeat onboarding.
- [ ] P1 Confirm interrupted onboarding resumes at the correct step.
- [ ] P1 Confirm invalid or stale onboarding state fails safely.

## 6.2 Runtime startup and session continuity

- [ ] P0 Confirm the real WASM runtime loads in the production build.
- [ ] P0 Confirm runtime mode is accurately displayed.
- [ ] P0 Submit a chat turn and verify the runtime produces the expected effect lifecycle.
- [ ] P0 Reload and verify the latest compatible runtime snapshot restores.
- [ ] P0 Verify replay does not duplicate stored messages.
- [ ] P0 Verify incompatible snapshots are discarded visibly and audited.
- [ ] P0 Verify runtime-load failure blocks agent operations.

## 6.3 Navigation and general UI honesty

- [ ] P0 Visit every primary route:
  - [ ] `/chat`;
  - [ ] `/models`;
  - [ ] `/storage`;
  - [ ] `/skills`;
  - [ ] `/workspace`;
  - [ ] `/memories`;
  - [ ] `/audit`;
  - [ ] `/security`;
  - [ ] `/settings`;
  - [ ] `/workflow`.
- [ ] P0 Confirm no primary navigation route renders a placeholder.
- [ ] P0 Confirm unimplemented actions are disabled or clearly labeled rather than faked.
- [ ] P0 Confirm loading, empty, offline, denied, and error states are visible and truthful.
- [ ] P1 Confirm direct-route refresh works on the production host.
- [ ] P1 Confirm keyboard navigation and focus restoration for dialogs and approval cards.
- [ ] P1 Confirm no uncaught error appears in the browser console during the core flow.

---

# Phase 7 — Provider and SecretVault Acceptance

## 7.1 No-provider and mock-provider behavior

- [ ] P0 Confirm a default production build has no active mock provider.
- [ ] P0 Confirm Chat is blocked when no provider is configured.
- [ ] P0 Confirm the UI provides a setup CTA.
- [ ] P0 Confirm an unknown provider ID fails rather than resolving to mock.
- [ ] P0 Confirm mock provider works only in an explicitly enabled development/demo build.

## 7.2 SecretVault lifecycle

- [ ] P0 Set up a new encrypted vault.
- [ ] P0 Verify wrong-passphrase unlock fails closed.
- [ ] P0 Verify correct unlock succeeds.
- [ ] P0 Add a session-only provider key.
- [ ] P0 Add an encrypted stored provider key.
- [ ] P0 Lock the vault and verify provider calls fail with `secret_locked`.
- [ ] P0 Unlock the vault and verify provider calls resume.
- [ ] P0 Delete a provider key and verify calls fail with `secret_missing`.
- [ ] P0 Verify auto-lock uses the persisted timeout setting.
- [ ] P0 Verify decrypted keys are absent from:
  - [ ] Redux state;
  - [ ] localStorage/sessionStorage;
  - [ ] IndexedDB plaintext fields;
  - [ ] audit details and CSV;
  - [ ] console logs;
  - [ ] error cards;
  - [ ] backup files unless protected as ciphertext inside an explicitly encrypted backup.

## 7.3 Remote provider validation

Test at least one real remote provider in the production application:

- [ ] P0 Save provider base URL and model.
- [ ] P0 Verify Test saves before activation.
- [ ] P0 Verify a successful test activates the persisted profile.
- [ ] P0 Send a real chat request and receive an assistant response.
- [ ] P0 Reload and verify the active provider/model persists.
- [ ] P0 Verify normalized error handling for:
  - [ ] authentication failure;
  - [ ] missing model;
  - [ ] unreachable endpoint;
  - [ ] CORS or probable-CORS failure;
  - [ ] rate limit, if supported by normalization;
  - [ ] malformed provider response.
- [ ] P0 Confirm provider failures produce an error card, not a fake assistant message.
- [ ] P1 Test a configured fallback provider and verify fallback occurs only under the
      documented failure policy.
- [ ] P1 Confirm fallback does not retry the same provider ID.

## 7.4 Local endpoint validation

- [ ] P1 Test Ollama or an OpenAI-compatible local endpoint.
- [ ] P1 Test llama-server if it is part of the supported 0.1.0 contract.
- [ ] P1 Confirm local providers can use `apiKeyMode: none`.
- [ ] P1 Confirm edited local base URL and model persist after reload.
- [ ] P1 Confirm unreachable local endpoints are reported honestly.

---

# Phase 8 — Local Model and wllama Acceptance

## 8.1 Compatibility and loading

- [ ] P0 Test in a supported Chromium browser.
- [ ] P0 Test in supported Firefox for application-local inference if declared supported.
- [ ] P0 Verify compatibility warnings appear when required browser features are absent.
- [ ] P0 Verify offline status is displayed accurately.
- [ ] P0 Verify model load failure is visible and does not claim the model is ready.

## 8.2 Download, cache, inference, and deletion

- [ ] P0 Download a known-small GGUF model through the real production build.
- [ ] P0 Verify progress updates are accurate.
- [ ] P0 Verify the download goes directly to the expected Hugging Face URL.
- [ ] P0 Verify a reload reuses the browser cache and does not redownload unnecessarily.
- [ ] P0 Run a real inference and verify nonempty output.
- [ ] P0 Unload and reload the model.
- [ ] P0 Delete the cached model and verify storage is reclaimed.
- [ ] P0 Verify deletion causes a later load to download again.
- [ ] P1 Test a user-supplied valid Hugging Face repo/file reference.
- [ ] P1 Verify malformed, URL-shaped, traversal, and non-GGUF references are rejected.

## 8.3 Storage pressure

- [ ] P0 Simulate insufficient quota and verify a visible quota error.
- [ ] P0 Confirm partial or failed downloads do not produce a falsely ready model.
- [ ] P1 Verify persistent-storage request results are represented accurately.
- [ ] P1 Verify the Storage screen reports model storage consistently.

---

# Phase 9 — Storage, Migration, Backup, and Restore Acceptance

## 9.1 Database creation and migrations

- [ ] P0 Create a fresh database and verify all expected tables and seed metadata.
- [ ] P0 Test migration from each materially different schema version that may exist in
      developer or prerelease profiles.
- [ ] P0 Verify skill-permission migration moves legacy permissions safely.
- [ ] P0 Verify malformed legacy permission data fails safely and is visible/audited.
- [ ] P0 Verify no migration exposes plaintext secrets.
- [ ] P0 Verify migration failure does not silently continue with corrupt state.
- [ ] P1 Record the database schema version in release notes or diagnostics.

## 9.2 Plain backup round trip

- [ ] P0 Create representative data:
  - [ ] provider profiles;
  - [ ] conversations and messages;
  - [ ] memories and provenance;
  - [ ] workspace files/content;
  - [ ] skills, package files, outputs, permissions, and state;
  - [ ] audit records;
  - [ ] model references;
  - [ ] settings.
- [ ] P0 Export a `.clawbackup`.
- [ ] P0 Validate the JSONL manifest and collection records.
- [ ] P0 Confirm model files are excluded while model references are included.
- [ ] P0 Import into a clean profile and preview:
  - [ ] collections;
  - [ ] record counts;
  - [ ] conflicts;
  - [ ] encrypted-secret presence;
  - [ ] model references.
- [ ] P0 Complete the restore and verify representative data.
- [ ] P0 Verify merge and replace semantics.
- [ ] P0 Verify an invalid collection, malformed row, raw secret, or oversized backup is
      rejected before writes.
- [ ] P0 Verify a mid-import failure rolls back the complete transaction.

## 9.3 Encrypted backup round trip

- [ ] P0 Export a passphrase-encrypted backup.
- [ ] P0 Confirm the file does not expose plaintext manifest or data.
- [ ] P0 Verify the correct passphrase imports successfully.
- [ ] P0 Verify the wrong passphrase fails without partial writes.
- [ ] P0 Verify the backup is portable to a fresh browser profile.
- [ ] P1 Verify user-facing copy distinguishes vault passphrase from backup passphrase.

## 9.4 Storage health

- [ ] P1 Verify quota estimates and persistent-storage status on the production origin.
- [ ] P1 Verify warning and critical thresholds render correctly.
- [ ] P1 Verify OPFS-unavailable behavior remains honest and safe.
- [ ] P1 Verify clearing site data produces a clean first-run state.

---

# Phase 10 — Workspace, Skills, Memories, and Audit Acceptance

## 10.1 Workspace filesystem

- [ ] P0 Create, read, update, append, move, copy, and delete workspace files.
- [ ] P0 Verify unsafe, absolute, encoded-traversal, backslash, and null-byte paths are
      rejected.
- [ ] P0 Verify content search and grep return accurate line information.
- [ ] P0 Verify write/delete actions require approval where required by policy.
- [ ] P0 Verify rejected operations make no data change and are audited.
- [ ] P0 Verify approved operations update the filesystem and audit log.
- [ ] P1 Verify large files respect range, output, and preview limits.

## 10.2 Skills and permissions

- [ ] P0 Import a valid `.clawskill`.
- [ ] P0 Import a valid `SKILL.md` package.
- [ ] P0 Verify permission review is shown before install.
- [ ] P0 Verify enable/disable persists.
- [ ] P0 Verify package files remain read-only to skill code.
- [ ] P0 Verify generated outputs use the protected output store.
- [ ] P0 Verify reserved state keys cannot be read or overwritten by a skill.
- [ ] P0 Verify tool execution rechecks current skill enabled state and permissions after
      approval.
- [ ] P0 Disable a skill after approval and verify execution is denied and audited.
- [ ] P0 Remove a permission after approval and verify execution is denied and audited.
- [ ] P1 Reinstall a skill and verify stale package files are removed safely.

## 10.3 Memory lifecycle

- [ ] P0 Create a memory through the approved Remember-tool path.
- [ ] P0 Verify the memory stores conversation and skill/tool provenance.
- [ ] P0 Reload and verify provenance persists.
- [ ] P0 Search and filter memories by supported fields.
- [ ] P0 Edit, pin, and delete a memory.
- [ ] P0 Verify memory create/update/delete events are audited.
- [ ] P0 Verify sensitive memories are excluded from automated retrieval where policy
      requires.
- [ ] P1 Verify long automated snippets are capped.

## 10.4 Durable audit log

- [ ] P0 Start with a fresh non-demo database and verify the audit log is empty.
- [ ] P0 Perform representative runtime, provider, vault, workspace, skill, memory, backup,
      model, script, and web actions.
- [ ] P0 Reload and verify audit events persist.
- [ ] P0 Verify filtering by type, source, status, and risk.
- [ ] P0 Verify event details redact credential-like keys and token text.
- [ ] P0 Export CSV and verify no raw sensitive details are included.
- [ ] P0 Verify high-volume content and script source are truncated.
- [ ] P1 Verify verbose effect audit is opt-in and persists its setting.

---

# Phase 11 — Plan Runtime, Sandbox, Tool, and Approval Acceptance

## 11.1 Structured Plan DSL

- [ ] P0 Execute a valid plan that reads and writes workspace files.
- [ ] P0 Verify requested capabilities, paths, URLs, and limits are shown before approval.
- [ ] P0 Reject a plan and verify no side effect occurs.
- [ ] P0 Edit an approved payload only if edit support is part of the 0.1.0 contract; edited
      values must be revalidated before execution.
- [ ] P0 Verify invalid op names, duplicate step IDs, unsafe paths, unsafe URLs, bad
      references, and limit overruns fail visibly.
- [ ] P0 Verify timeout and cancellation behavior.
- [ ] P0 Verify plan completion/failure is audited.

## 11.2 QuickJS sandbox

- [ ] P0 Confirm sandbox execution is disabled by policy unless explicitly enabled and
      approved.
- [ ] P0 Confirm no application-context `eval` or `new Function` path exists.
- [ ] P0 Execute a permitted mediated filesystem operation.
- [ ] P0 Deny an operation outside the declared path scope.
- [ ] P0 Deny undeclared web, memory, or tool capabilities.
- [ ] P0 Verify infinite loop timeout.
- [ ] P0 Verify output, log, file-read, file-write, and web-read limits.
- [ ] P0 Verify denied and failed operations are visible and audited.

## 11.3 Tool proposal lifecycle

- [ ] P0 Verify valid tool blocks become proposals rather than assistant text.
- [ ] P0 Verify malformed tool JSON produces an explicit protocol/tool error.
- [ ] P0 Verify missing tool name and non-object args fail explicitly.
- [ ] P0 Verify no-tool responses remain normal assistant messages.
- [ ] P0 Verify approve, reject, and execution-time permission recheck paths.
- [ ] P0 Verify unknown `resolve_effect` IDs are recoverably audited.
- [ ] P0 Verify tool-result continuation returns to the model without duplicate storage.

---

# Phase 12 — Web Research and Extension Acceptance

## 12.1 Extension detection

- [ ] P0 Test with no extension installed; status must be unavailable, not falsely ready.
- [ ] P0 Install the exact packaged RC extension in a clean Chrome profile.
- [ ] P0 Configure the exact packaged RC application with the extension ID.
- [ ] P0 Confirm connection, extension version, and capabilities are displayed accurately.
- [ ] P0 Disable the extension and verify state changes to unavailable.
- [ ] P0 Re-enable/reload and verify recovery.

## 12.2 Real page reading

- [ ] P0 Read a real public article page.
- [ ] P0 Verify title, URL, and sanitized text/markdown.
- [ ] P0 Verify scripts and hostile fixture sentinels are not returned.
- [ ] P0 Verify the temporary/background tab closes after reading.
- [ ] P0 Deny host permission and verify a clear permission error.
- [ ] P0 Verify permission denial is audited.
- [ ] P0 Verify blocked local/private/metadata targets fail before navigation.
- [ ] P0 Verify redirects to blocked targets fail.
- [ ] P0 Verify oversized pages stop at the configured cap.
- [ ] P0 Verify timeout and page-load failure produce normalized, visible results.

## 12.3 Brave Search

- [ ] P0 Store a Brave Search key in SecretVault.
- [ ] P0 Run a real search through the extension-backed path.
- [ ] P0 Verify results contain normalized titles, URLs, and snippets.
- [ ] P0 Verify `maxResults` default and cap.
- [ ] P0 Verify invalid `maxResults` is `invalid_request` even when the key is missing.
- [ ] P0 Lock the vault and verify search fails with the documented key-locked behavior.
- [ ] P0 Delete the key and verify search fails with key-missing behavior.
- [ ] P0 Verify the key is absent from messages, logs, audit records, workspace files, and
      packaged artifacts.

## 12.4 Bulk research workflow

- [ ] P0 Submit a query-based bulk research request.
- [ ] P0 Submit an explicit-URL research request.
- [ ] P0 Confirm approval shows query/URLs/domains/risk and supported limits.
- [ ] P0 Confirm invalid or unknown options fail as payload-invalid before provider calls.
- [ ] P0 Verify `maxPages`, `maxResults`, and `maxChars` are enforced consistently across
      parser, runtime, provider, extension protocol, and direct handlers.
- [ ] P0 Verify skipped URLs caused by `maxPages` are not mislabeled as failures.
- [ ] P0 Verify search results and page output are stored under safe workspace paths.
- [ ] P0 Verify partial page failures are represented without silently dropping them.
- [ ] P0 Verify rejected research performs no search/read and is audited.

---

# Phase 13 — Security, Privacy, and Dependency Review

## 13.1 Secret and credential scan

- [ ] P0 Scan the full git history or at minimum all reachable release content for exposed
      API keys, tokens, private keys, credentials, and `.env` files.
- [ ] P0 Scan the working tree and generated artifacts separately.
- [ ] P0 Review common token patterns including:
  - [ ] OpenAI-style `sk-`;
  - [ ] Anthropic-style `sk-ant-`;
  - [ ] GitHub tokens;
  - [ ] AWS keys;
  - [ ] Slack tokens;
  - [ ] JWTs;
  - [ ] Authorization/Bearer headers;
  - [ ] PEM private keys.
- [ ] P0 Investigate every finding; do not blindly suppress scanner results.
- [ ] P0 Rotate and remove any real credential discovered.
- [ ] P0 Record scanner names, versions, commands, and outcomes.

## 13.2 Application security review

- [ ] P0 Confirm default behavior fails closed for runtime, provider, extension, skills, and
      missing effect handlers.
- [ ] P0 Confirm every meaningful side effect requires the documented approval policy.
- [ ] P0 Confirm approval payload edits are revalidated at execution time.
- [ ] P0 Confirm SSRF protections are shared across application and extension paths.
- [ ] P0 Confirm URL parsing handles encoded, IPv4-mapped IPv6, and redirect cases.
- [ ] P0 Confirm audit redaction covers nested values and summary text.
- [ ] P0 Confirm backup validation rejects raw secrets.
- [ ] P0 Confirm extension external messaging cannot be invoked by an unapproved origin.
- [ ] P0 Confirm no production telemetry or external analytics exists unless explicitly
      disclosed and approved.
- [ ] P1 Update the threat model for the actual RC architecture.

## 13.3 Dependency review

- [ ] P1 Run a production JavaScript dependency vulnerability scan.
- [ ] P1 Run `cargo audit` or an equivalent Rust advisory scan.
- [ ] P1 Review high/critical findings and either fix or document why they are not
      exploitable.
- [ ] P1 Verify licenses for bundled dependencies and fonts are compatible with release.
- [ ] P1 Add or update third-party notices if required.
- [ ] P2 Enable Dependabot or Renovate for pnpm, Cargo, and GitHub Actions.
- [ ] P2 Add CodeQL or equivalent static analysis.

## 13.4 Privacy documentation

- [ ] P1 Document that BrowserClaw stores application data locally in the browser.
- [ ] P1 Document exactly when data leaves the browser:
  - [ ] configured LLM provider requests;
  - [ ] Hugging Face model downloads;
  - [ ] Brave Search requests through the extension;
  - [ ] requested public page reads.
- [ ] P1 Document that API keys are user-supplied and held by SecretVault.
- [ ] P1 Document backup contents and encrypted-backup behavior.
- [ ] P1 Document extension page-access behavior and permission model.
- [ ] P1 Document data deletion: site-data clearing, model deletion, key deletion, and
      backup management.

---

# Phase 14 — Accessibility, Compatibility, and Performance

## 14.1 Accessibility

- [ ] P1 Complete keyboard-only navigation through onboarding, settings, chat, approvals,
      storage restore, and security dialogs.
- [ ] P1 Verify visible focus indicators.
- [ ] P1 Verify dialog focus trap and focus restoration.
- [ ] P1 Verify ARIA names/roles for tabs, toggles, progress, alerts, and approval cards.
- [ ] P1 Verify error and status updates are announced appropriately.
- [ ] P1 Test zoom at 200% and common narrow desktop widths.
- [ ] P2 Run an automated accessibility scanner and adjudicate findings.

## 14.2 Browser compatibility

- [ ] P0 Test the production package on the minimum supported Chrome version.
- [ ] P0 Test the production package on current Chrome stable.
- [ ] P1 Test non-extension functionality on current Firefox stable.
- [ ] P1 Confirm unsupported extension functionality is represented honestly in Firefox.
- [ ] P2 Test Edge if it is included in the support statement.
- [ ] P2 Test a clean profile on another operating system.

## 14.3 Performance and resilience

- [ ] P1 Record initial production bundle sizes.
- [ ] P1 Record WASM and worker asset sizes.
- [ ] P1 Verify startup remains responsive with a populated database.
- [ ] P1 Verify audit, memory, workspace, and conversation lists remain usable with
      representative larger datasets.
- [ ] P1 Verify large backup preview does not freeze the UI.
- [ ] P1 Verify long-running model download and research operations show progress or an
      honest busy state.
- [ ] P2 Set a documented bundle-size or startup-performance budget for later releases.

---

# Phase 15 — Documentation and User-Facing Release Material

## 15.1 Canonical project status

- [ ] P1 Create `docs/PROJECT_STATUS.md` as the authoritative current-state document.
- [ ] P1 Include:
  - [ ] release status;
  - [ ] implemented features;
  - [ ] supported browsers/platforms;
  - [ ] production configuration requirements;
  - [ ] known limitations;
  - [ ] exact current gate status;
  - [ ] next milestone.
- [ ] P1 Mark historical TODOs and FIX documents as implementation history rather than the
      current source of truth.
- [ ] P1 Reconcile stale unchecked boxes in old TODOs with explicit completed, superseded,
      intentionally omitted, or deferred status.

## 15.2 README

- [ ] P1 Update README version and maturity language.
- [ ] P1 Add production build instructions.
- [ ] P1 Add extension-ID configuration instructions.
- [ ] P1 Add packaged-extension installation instructions.
- [ ] P1 Add supported-browser and limitation sections.
- [ ] P1 Add troubleshooting for:
  - [ ] WASM runtime load failure;
  - [ ] extension missing/wrong ID;
  - [ ] provider CORS failure;
  - [ ] locked/missing secret;
  - [ ] storage quota failure;
  - [ ] wllama compatibility;
  - [ ] host permission denial.
- [ ] P1 Ensure all documented commands match `package.json`.

## 15.3 Release and deployment documentation

- [ ] P1 Create or update `CHANGELOG.md` with a `0.1.0` section.
- [ ] P1 Draft GitHub prerelease notes for `v0.1.0-rc.1`.
- [ ] P1 Describe installation of both the application and extension.
- [ ] P1 Describe production hosting and SPA rewrites.
- [ ] P1 Describe backup before upgrading or testing an RC.
- [ ] P1 List known issues and intentional limitations.
- [ ] P1 Include artifact checksums and candidate SHA.
- [ ] P1 Add a rollback/uninstall procedure.
- [ ] P1 Add upgrade instructions from `v0.1.0-rc.1` to final `v0.1.0`.

## 15.4 Extension store material

If Chrome Web Store distribution is in scope:

- [ ] P1 Prepare store description and screenshots.
- [ ] P1 Prepare privacy disclosure and support URL.
- [ ] P1 Prepare permission justifications.
- [ ] P1 Verify extension icon sizes and branding assets.
- [ ] P1 Submit to the selected test or production channel.
- [ ] P1 Record the resulting stable extension ID and update release configuration if
      necessary.

---

# Phase 16 — Artifact-Level Acceptance

## 16.1 Build candidate artifacts

- [ ] P0 Create the candidate commit and record its full SHA.
- [ ] P0 Tag that exact commit `v0.1.0-rc.1` only after pre-tag gates pass, or use an
      equivalent immutable release-candidate workflow.
- [ ] P0 Let GitHub Actions produce the release artifacts.
- [ ] P0 Do not substitute locally produced archives for failing CI artifacts without a
      documented reason and equivalent provenance.
- [ ] P0 Download the application and extension archives from the prerelease.
- [ ] P0 Verify SHA-256 checksums.
- [ ] P0 Verify archive filenames and embedded versions.

## 16.2 Inspect archive contents

- [ ] P0 Inspect the application archive for:
  - [ ] required HTML, JS, CSS, WASM, workers, and fonts;
  - [ ] no source `.env` files;
  - [ ] no credentials;
  - [ ] no unrelated tests or development files;
  - [ ] correct build metadata.
- [ ] P0 Inspect the extension archive for:
  - [ ] manifest and service worker;
  - [ ] content extraction code;
  - [ ] no `node_modules`;
  - [ ] no tests/fixtures;
  - [ ] no credentials;
  - [ ] correct production origin and version.

## 16.3 Test the actual archives

- [ ] P0 Host the extracted application archive on the intended production-like server.
- [ ] P0 Load the extracted extension archive in a clean Chrome profile.
- [ ] P0 Run the core smoke test using only extracted release artifacts:
  - [ ] application starts;
  - [ ] real WASM runtime loads;
  - [ ] onboarding works;
  - [ ] vault setup works;
  - [ ] provider configuration works;
  - [ ] chat works;
  - [ ] extension connects;
  - [ ] page reading works;
  - [ ] Brave Search works;
  - [ ] backup export/import works.
- [ ] P0 Confirm the artifact SHA shown in diagnostics matches the tagged commit.
- [ ] P0 Record screenshots or logs sufficient to prove the artifact smoke test.

---

# Phase 17 — RC Signoff, Soak, and Final Promotion

## 17.1 Release candidate signoff

- [ ] P0 All P0 tasks are complete.
- [ ] P0 All P1 tasks are complete or explicitly adjudicated as not part of the 0.1.0
      release contract without creating a false claim.
- [ ] P0 Full automated gate passes on the exact candidate SHA.
- [ ] P0 Manual Chrome/extension QA passes on the packaged RC artifacts.
- [ ] P0 Security and secret scans pass.
- [ ] P0 Backup and migration tests pass.
- [ ] P0 Release notes identify known limitations honestly.
- [ ] P0 `BROWSERCLAW_RELEASE_CANDIDATE_0.1.0_REVIEW_NOTES.md` contains final findings.
- [ ] P0 `BROWSERCLAW_RELEASE_CANDIDATE_0.1.0_GATE_EVIDENCE.md` contains exact evidence.
- [ ] P0 No unresolved release-blocker issue remains.
- [ ] P0 Publish `v0.1.0-rc.1` as a prerelease.

## 17.2 Candidate soak

- [ ] P1 Use the RC for a defined soak period.
- [ ] P1 Exercise at least:
  - [ ] repeated browser restarts;
  - [ ] vault lock/unlock cycles;
  - [ ] multiple conversations;
  - [ ] local and remote provider use;
  - [ ] extension disable/re-enable;
  - [ ] page reads across several public domains;
  - [ ] backup and restore;
  - [ ] model download/cache/delete;
  - [ ] storage pressure or quota warning behavior.
- [ ] P1 Record all defects found during soak.
- [ ] P0 Any code fix creates a new candidate SHA and requires a full gate.
- [ ] P1 Increment the candidate tag (`rc.2`, `rc.3`, and so on) when artifacts change.

## 17.3 Promote to final 0.1.0

- [ ] P0 Confirm no release-blocker defect remains after soak.
- [ ] P0 Confirm final release commit differs from the accepted RC only by approved
      version/release-note changes, or rerun the full gate if code changes.
- [ ] P0 Set final release metadata to `0.1.0`.
- [ ] P0 Update extension `version_name` from RC to final where applicable.
- [ ] P0 Run the complete automated gate on the final SHA.
- [ ] P0 Build and smoke-test final artifacts.
- [ ] P0 Tag the exact final commit `v0.1.0`.
- [ ] P0 Publish the GitHub release and final artifacts.
- [ ] P1 Publish or promote the extension in the selected distribution channel.
- [ ] P1 Update `docs/PROJECT_STATUS.md` to `Released 0.1.0`.
- [ ] P1 Announce the release with installation, security, backup, and known-limitations
      guidance.

## 17.4 Rollback plan

- [ ] P1 Document how to unpublish or supersede a bad GitHub release.
- [ ] P1 Document how to withdraw or roll back the extension package.
- [ ] P1 Preserve the previous working artifact and checksums.
- [ ] P1 Document how users can restore a pre-upgrade backup.
- [ ] P1 Define criteria for issuing `0.1.1` rather than modifying an existing release.

---

# Final Acceptance Checklist

BrowserClaw 0.1.0 may be called release-ready only when all of the following are true:

## Release identity

- [ ] P0 Application and extension versions are `0.1.0`.
- [ ] P0 RC and final tags point to known, reviewed commits.
- [ ] P0 UI diagnostics identify version and commit SHA accurately.

## Production configuration

- [ ] P0 Production origin and extension ID are configured.
- [ ] P0 Production extension messaging accepts only the intended origin allowlist.
- [ ] P0 Demo, mock-provider, and reference-runtime overrides are off.
- [ ] P0 Production routing, headers, and WASM loading work.

## Correctness and security

- [ ] P0 Full exact-SHA automated gate passes.
- [ ] P0 Real WASM runtime is used.
- [ ] P0 No missing handler or provider path silently falls back.
- [ ] P0 No decrypted secret is present in Redux, storage plaintext, logs, audit, backup, or
      artifacts.
- [ ] P0 SSRF and extension-origin protections pass.
- [ ] P0 Skill and tool permission rechecks pass.
- [ ] P0 Backup validation, rollback, encryption, and restore pass.

## Functional acceptance

- [ ] P0 Onboarding and persistence work.
- [ ] P0 At least one real provider chat flow works.
- [ ] P0 SecretVault lock/unlock/delete behavior works.
- [ ] P0 Local model download/cache/inference/delete works on a supported browser.
- [ ] P0 Workspace, skills, memories, and durable audit work.
- [ ] P0 Structured plans, approvals, and sandbox restrictions work.
- [ ] P0 Packaged extension detection, page reading, and Brave Search work.

## Packaging and documentation

- [ ] P0 CI-generated application and extension archives pass artifact-level smoke tests.
- [ ] P0 Checksums and release manifest match the uploaded files.
- [ ] P0 No secret or development-only file exists in either archive.
- [ ] P1 README, project status, changelog, privacy, deployment, extension, troubleshooting,
      backup, and known-limitations documentation are current.
- [ ] P1 Release evidence identifies the exact tested SHA and environments.

## Signoff

- [ ] P0 No unresolved P0 release blocker remains.
- [ ] P0 RC soak is complete.
- [ ] P0 Final `v0.1.0` artifacts are built and tested from the final tag SHA.
- [ ] P0 The release is published without overstating unsupported capabilities.
