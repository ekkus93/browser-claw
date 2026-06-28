# Extension Manual QA Checklist (K3)

Steps to manually verify the BrowserClaw Web Research Companion extension in Chrome.

## Setup

1. Clone the repo and run `pnpm install`.
2. Open Chrome → `chrome://extensions` → enable Developer mode.
3. Click "Load unpacked" → select `extension/chrome-web-research/`.
4. Note the Extension ID shown on the extension card.
5. Run the app: `pnpm dev` (default: `http://localhost:5173`).

## Verification steps

- [ ] Extension loads without error; no warnings in `chrome://extensions`.
- [ ] Open `chrome://extensions` → service worker shows as "active".
- [ ] Navigate to `http://localhost:5173` → Settings → Web Research section.
- [ ] Extension status shows "connected" (green indicator).
- [ ] Enter a public article URL (e.g., `https://en.wikipedia.org/wiki/Artificial_intelligence`).
- [ ] Trigger "Read page" → extracted text appears in the UI (article body visible).
- [ ] Try a local URL (`http://127.0.0.1:5173/`) → error shown: "Blocked host".
- [ ] Try a private IP (`http://192.168.1.1/`) → error shown: "Blocked host".
- [ ] Deny host permission when prompted → error shown: "host_permission_missing".
- [ ] Disconnect extension (disable in `chrome://extensions`) → status shows "extension unavailable".
- [ ] Re-enable extension → status returns to "connected" after page refresh.
- [ ] Upgrade extension: bump version in `manifest.json`, reload unpacked → settings show new version.

## Extension web search (G2)

- [ ] Configure a Brave Search API key in Settings → Web Research.
- [ ] Run a search query → results appear.
- [ ] Lock the vault or remove the key → search fails with "key locked" status.
- [ ] Disconnect extension → search fails with "extension unavailable" status.

## Chrome Web Store packaging checklist (pre-release)

- [ ] `manifest.json` version bumped.
- [ ] `externally_connectable.matches` updated with production origin.
- [ ] Extension zipped (only `extension/chrome-web-research/`; no node_modules).
- [ ] Tested in a clean Chrome profile with no other extensions.
- [ ] Privacy disclosure prepared (extension reads pages on user request only).
