# BrowserClaw 0.1.0 RC Review Notes

## Review scope

This review covers the BrowserClaw 0.1.0 release-engineering pass performed from the original RC TODO baseline through the latest documented pre-tag gate. It focuses on production identity, extension trust boundaries, CI/release behavior, artifact construction, deployability, diagnostics, and test integrity.

## Current decision

**Decision: HOLD RC publication.**

The automated pre-tag gate and static artifact inspection pass. Publication remains blocked by manual production-artifact, real-provider, real-local-model, migration/backup, security-scan, accessibility/compatibility, and soak evidence.

## Major findings fixed

### Version and identity drift

The application package reported `0.0.0`, while the extension and UI contained different version identities. This could make diagnostics and artifacts impossible to correlate.

Fixes:

- synchronized product version to `0.1.0`;
- added extension `version_name` for `0.1.0-rc.1`;
- added a release-config validator that fails on divergence;
- replaced the stale UI version with typed build metadata;
- surfaced version and short commit SHA in the application shell;
- embedded exact SHA, UTC build time, release channel, base path, production URL, extension ID, runtime policy, and safety overrides in release metadata.

### Missing production extension identity

The release had no stable production extension ID contract.

Fixes:

- committed a public manifest key;
- derived and validated stable extension ID `mgobfbgnjfnlpahiniaincgpkinnodka`;
- wired the ID into production validation, build metadata, documentation, CI, and packaging;
- documented unpacked developer-mode distribution for 0.1.0.

No private signing key is committed or packaged.

### Weak sender-origin matching

Prefix-based sender URL checking could admit malformed or lookalike URLs if used carelessly.

Fixes:

- parse candidate and allowed URLs;
- require exact origin equality, including scheme, host, and port;
- require application-path equality or a proper path-segment descendant;
- reject malformed sender URLs and malformed allowlist entries;
- add regression tests for production/development origins, suffix tricks, wrong scheme, wrong port, lookalike paths, subdomains, and missing URLs;
- generate the packaged service-worker production policy from the single release configuration.

### Release workflow was not sufficient as an RC gate

The original workflow built and tested the project but did not fully enforce release identity, formatting, workflow syntax, deterministic packaging, checksums, or exact-SHA dry-run artifacts.

Fixes:

- actionlint gate;
- Rust formatting gate;
- first-party lint warnings are fatal;
- strict production release configuration;
- exact-SHA checkout for build/release jobs;
- explicit job timeouts;
- pinned `wasm-pack` installation rather than a moving remote installer script;
- deterministic app and extension archives;
- machine-readable release manifest and `SHA256SUMS`;
- artifact verification and exact-SHA upload on every `master` candidate;
- tag-only release publication after all required jobs pass;
- exact-tag-SHA GitHub Pages build/deploy workflow.

### Extension E2E tab-load race

The Docker extension suite exposed a real MV3 race: a completion event could be missed after the initial tab status check, causing a 15-second page-read timeout.

Fix:

- retain the completion-event fast path;
- add bounded 250 ms tab-status polling;
- clean up listeners, polling, and timeout handles on every completion path;
- improve the E2E assertion so any future failure reports the complete extension response.

The repaired Docker extension gate subsequently passed in the full matrix.

### React test warnings were not authoritative

The unit suite could pass while React reported state updates outside `act(...)`.

Fixes:

- unmount Dexie/vault subscribers before teardown mutations;
- wrap direct Redux dispatches in `act(...)`;
- install a global test policy that throws when React emits an unwrapped-state-update warning.

The full 1,485-test suite then passed under the stricter policy.

### Production bundle warning

The main JavaScript entry was approximately 737 kB after minification.

Fix:

- configure deterministic Rolldown code-splitting groups for React, state/storage, QuickJS, local-model, and general vendor dependencies;
- keep strict execution order;
- use 300 kB maximum group sizing rather than increasing the warning threshold.

The resulting largest JavaScript chunks were approximately 295.37 kB and 290.84 kB.

### Incomplete WASM package metadata

`wasm-pack` reported missing package description/repository and failed to discover the repository license from the crate directory.

Fix:

- add description and repository metadata;
- reference the root Apache-2.0 license through `license-file`.

The first-party metadata warning no longer appears.

## Production policy selected

- Release model: public GitHub prerelease.
- Intended RC tag: `v0.1.0-rc.1`.
- Intended final tag: `v0.1.0`.
- Production URL: `https://ekkus93.github.io/browser-claw/`.
- Production base path: `/browser-claw/`.
- Extension distribution: unpacked developer-mode ZIP.
- Stable extension ID: `mgobfbgnjfnlpahiniaincgpkinnodka`.
- Primary browser: Chrome 130 or later, provisional pending manual matrix.
- Firefox: non-extension application functionality only.
- Operating systems: desktop Linux, macOS, and Windows, provisional pending manual matrix.
- Current-tab reading: intentionally unavailable in 0.1.0.
- Telemetry: none.

## Artifact review

The exact-SHA CI artifact for commit `09cf80b96a2d678e1ff948dda493cfbe2ba44c38` passed independent structural inspection:

- nested ZIP CRCs and release checksums valid;
- deterministic timestamps;
- safe member paths;
- exact build metadata;
- correct extension version, ID, and production origin;
- no `.env`, tests, fixtures, source-control metadata, `node_modules`, private-key-like files, source maps, or tested common secret patterns;
- safety overrides disabled.

The artifact has not yet been loaded into a clean Chrome profile or hosted from its extracted application archive. That remains a blocker.

## Known limitations accepted for 0.1.0

- no Firefox companion extension;
- no current-tab reading;
- no BrowserClaw account system;
- no managed cloud synchronization or backup;
- no telemetry or analytics;
- Brave Search requires a user-supplied key;
- remote providers and model hosts retain their own CORS, privacy, rate-limit, and availability constraints;
- local GGUF performance depends on browser, model size, memory, and hardware;
- Chrome Web Store distribution is not part of the 0.1.0 contract.

## Remaining release blockers

1. Complete a full-history and release-content credential scan with recorded scanner versions and adjudication.
2. Run JavaScript and Rust advisory/license review and record all material findings.
3. Deploy the exact candidate to the intended GitHub Pages environment and validate routing, assets, metadata, and available headers.
4. Load the extracted extension archive in a fresh real-Chrome profile and verify its ID and connection.
5. Exercise packaged page reading and Brave Search with explicit host permission and a user-supplied key.
6. Exercise at least one real remote provider and the normalized failure matrix.
7. Exercise a supported local endpoint and a real wllama GGUF download/inference/delete lifecycle.
8. Complete manual SecretVault lifecycle validation with real provider use while inspecting storage/log/audit boundaries.
9. Complete migration, backup, encrypted restore, rollback, tamper, wrong-passphrase, and quota-pressure drills.
10. Complete keyboard/zoom/accessibility review and minimum/current browser matrix.
11. Test a clean profile on at least one additional operating system.
12. Publish a new immutable RC SHA only after all remaining code/document changes receive another complete gate.
13. Perform and record the defined RC soak before final promotion.

## Review conclusion

The repository is materially closer to a real release candidate: production identity, trust boundaries, exact-SHA gating, deterministic packaging, static artifact safety, and user-facing release policy are now explicit and tested. It is not yet honest to publish or call BrowserClaw 0.1.0 release-ready because the external/manual acceptance boundary has not been crossed.
