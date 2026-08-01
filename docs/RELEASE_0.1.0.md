# BrowserClaw 0.1.0 Release Guide

## Release state

BrowserClaw 0.1.0 is being prepared as `v0.1.0-rc.1`. This document describes the intended release contract; it does not claim that the release candidate has been published or manually accepted.

## Product scope

BrowserClaw is a browser-only, local-first agent console with:

- a Rust/WASM agent runtime;
- remote provider adapters configured by the user at runtime;
- browser-local GGUF inference through wllama;
- IndexedDB-backed application data;
- workspace files and sandboxed QuickJS execution;
- skills, memories, audit events, backup, restore, import, and export;
- an optional Chrome Web Research Companion for page reading and Brave Search.

The core application does not require a BrowserClaw account or a BrowserClaw-hosted application server.

## Supported release environment

- Chrome 130 or later is the primary release browser.
- Firefox 128 ESR or later is supported for non-extension application functionality.
- Desktop Linux, macOS, and Windows are the intended operating systems.
- The hosted application URL is `https://ekkus93.github.io/browser-claw/`.
- The Chrome companion extension ID is `mgobfbgnjfnlpahiniaincgpkinnodka`.

These support statements remain provisional until the manual acceptance matrix is completed and recorded in the RC gate-evidence document.

## Application installation

The release contains `browserclaw-app-0.1.0-rc.1.zip`.

1. Verify the archive against `SHA256SUMS`.
2. Extract it to a directory served by an HTTPS-capable static web server, or use the tagged GitHub Pages deployment.
3. Serve the application from the configured `/browser-claw/` base path.
4. Open the application in a supported browser.

The archive includes `release-metadata.json`, which records the exact commit SHA, build timestamp, release channel, base path, extension ID, and safety-override state.

## Chrome extension installation

The release contains `browserclaw-extension-0.1.0-rc.1.zip`.

1. Verify the archive against `SHA256SUMS`.
2. Extract the archive.
3. Open `chrome://extensions`.
4. Enable **Developer mode**.
5. Select **Load unpacked**.
6. Select the extracted `browserclaw-extension` directory.
7. Confirm Chrome reports extension ID `mgobfbgnjfnlpahiniaincgpkinnodka`.
8. Open BrowserClaw Settings and confirm the extension status is connected.

The extension is not distributed through the Chrome Web Store for 0.1.0. Its stable public manifest key fixes the unpacked extension ID; no private signing key is included in the repository or release archive.

## Provider credentials

Provider credentials are entered at runtime. They are not compiled into the application or supplied as release environment variables. BrowserClaw's decrypted credentials are intended to remain in its in-memory SecretVault rather than durable application state.

## Release artifacts

A tagged release is expected to contain:

- `browserclaw-app-0.1.0-rc.1.zip`;
- `browserclaw-extension-0.1.0-rc.1.zip`;
- `browserclaw-release-manifest.json`;
- `SHA256SUMS`;
- the RC gate-evidence document when available.

The CI release job generates archives deterministically from a clean exact-SHA checkout, verifies their checksums and metadata, and publishes only after all authoritative jobs succeed.

## Known limitations

- Current-tab reading is unavailable in 0.1.0. Use page reading with an explicit URL.
- Chrome extension functionality is not available in Firefox.
- Host permissions for page reading must be granted explicitly.
- Brave Search requires a user-supplied Brave Search API key.
- Local model performance and memory use depend on the selected model, browser, and device.
- Multi-device synchronization, managed cloud backup, accounts, and telemetry are not part of 0.1.0.
- The first RC cannot be promoted until real Chrome, provider, local-model, backup/restore, migration, accessibility, and soak checks are recorded.

## Rollback

For the hosted app, redeploy the previously accepted tag rather than rebuilding an old branch tip. For the unpacked extension, remove the current unpacked directory and load the previously verified extension archive. Preserve user backups before changing versions. Do not mix application and extension artifacts from different release manifests.
