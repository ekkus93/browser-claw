# BrowserClaw Privacy and Data Handling

## Summary

BrowserClaw is designed as a local-first browser application. It has no BrowserClaw account system and no BrowserClaw telemetry service in version 0.1.0.

## Data stored in the browser

BrowserClaw may store application data in browser-managed storage, including:

- conversations and messages;
- provider and model configuration that does not contain decrypted credentials;
- workspace files;
- installed skill packages and skill state;
- memories and audit events;
- model metadata and browser cache state;
- backup and restore metadata.

Clearing site data can remove this information. Users should create and verify backups before clearing browser storage, changing browser profiles, or moving to another device.

## Credentials

Provider API keys and similar credentials are entered at runtime. Decrypted credentials are intended to live only in the in-memory SecretVault. They must not be written to IndexedDB, localStorage, Redux state, logs, screenshots, audit payloads, release artifacts, or source control.

A browser refresh or tab close may require credentials to be entered again. This is intentional.

## Network requests

BrowserClaw sends requests only when a user configures and invokes functionality that requires a network service. Depending on user configuration, requests may be sent to:

- a selected remote model provider;
- a user-configured OpenAI-compatible endpoint;
- a user-configured Ollama endpoint;
- Brave Search through the Chrome companion extension;
- public page origins selected for extension-assisted reading;
- model download origins selected by the user.

Those services have their own privacy policies and data-retention behavior. BrowserClaw does not proxy remote provider traffic through a BrowserClaw-operated backend.

## Chrome Web Research Companion

The extension accepts messages only from explicitly configured BrowserClaw application URLs. It requests page host permissions separately and reads a page only after the relevant permission exists. It is designed to extract readable page text and metadata. It is not intended to read cookies, fill forms, submit forms, or access unrelated browser data.

The extension receives a Brave Search key only for the active search request. It must not persist or log that key.

## Backups and exports

Backups and exports may contain private application data. Users control where those files are saved and shared. BrowserClaw cannot protect an exported file after it leaves the browser. Store backups securely and delete obsolete copies when appropriate.

## Telemetry

BrowserClaw 0.1.0 has no product telemetry or analytics. GitHub, browser vendors, operating systems, model providers, search providers, and hosting infrastructure may independently collect operational data under their own policies.

## Security reporting

Do not include real credentials, private conversations, or sensitive backup data in public bug reports. Provide the exact BrowserClaw version and commit SHA shown in the application, browser version, reproduction steps, and sanitized diagnostics.
