# BrowserClaw Web Research Companion (Chrome, MV3)

A minimal, **read-only** Chrome extension that lets BrowserClaw read web pages
(returning sanitized text/markdown) without relying on `fetch()` CORS. It never
fills forms, clicks, reads cookies, runs page scripts, or scrapes logged-in
pages.

## Files

- `manifest.json` — Manifest V3. Least-privilege: `tabs`, `scripting`, `storage`;
  host access is via `optional_host_permissions` requested per-origin at read
  time (no `<all_urls>` at install). `externally_connectable` only allows the
  BrowserClaw origin to message it.
- `service-worker.js` — background worker; validates the sender origin and
  handles the message protocol (`ping`/`get_status` in v0.1; page reads in E7).
- `content-extract.js` — content script that extracts readable text (E7/E8).

## Dev install

1. Run BrowserClaw dev server (`pnpm dev`, default `http://localhost:5173`).
2. Open `chrome://extensions`, enable **Developer mode**.
3. **Load unpacked** → select this `extension/chrome-web-research/` folder.
4. Note the generated **extension ID** (shown on the card). BrowserClaw reads it
   from the service-worker URL or a test-only setting (see `src/extension/config.ts`).

## Production origin

`externally_connectable.matches` lists dev origins only. The production origin is
added at release time (a build step substitutes it). The BrowserClaw side keeps
it configurable — never a hard-coded fake domain. See
`PROD_ORIGIN_PLACEHOLDER` in `src/extension/config.ts`.

## Testing

- Pure logic (message protocol, URL policy, extraction) is unit-tested on the
  BrowserClaw side under `src/extension/`.
- A Dockerized Chromium end-to-end lane (`pnpm run test:extension:e2e`) loads the
  unpacked extension and exercises real page reads — added with E7–E9. Until then
  the protocol/URL/extraction units are the automated coverage; full install and
  host-permission prompts are manual QA.
