# BrowserClaw

A browser-only, local-first AI agent console. Kinda like OpenClaw, but in your browser.

All state lives in your browser. No server required. API keys stay in memory only — never written to disk, localStorage, or logs.

---

## Tech stack

| Layer | Technology |
|---|---|
| UI | React 19 + TypeScript (strict) + Vite + Tailwind CSS v4 |
| State | Redux Toolkit (transient UI/session state) |
| Storage | Dexie / IndexedDB (durable data) |
| Router | React Router v7 |
| Runtime | Rust/WASM (`claw-core`, `claw-wasm`, `claw-schema`) |
| Local models | wllama (browser-local GGUF inference) |
| Scripting | QuickJS (sandboxed JS execution) |
| Web research | Chrome MV3 extension + Brave Search API |

---

## Prerequisites

- **Node.js** ≥ 20
- **pnpm** — `npm install -g pnpm`
- **Rust + Cargo** — [rustup.rs](https://rustup.rs)
- **wasm-pack** — `cargo install wasm-pack`
- **Docker** _(optional)_ — for extension E2E tests

---

## Getting started

```bash
# Install JS dependencies
pnpm install

# Build the Rust/WASM runtime
pnpm run build:wasm

# Start the dev server
pnpm run dev
```

The app runs at `http://localhost:5173`.

---

## Scripts

| Command | Description |
|---|---|
| `pnpm run dev` | Start Vite dev server |
| `pnpm run build` | Production build (TypeScript + Vite) |
| `pnpm run build:wasm` | Compile Rust crates to WASM |
| `pnpm run typecheck` | TypeScript strict check (no emit) |
| `pnpm run lint` | ESLint (zero warnings tolerated) |
| `pnpm run format` | Prettier auto-format |
| `pnpm run format:check` | Prettier format check |
| `pnpm test` | Lint + format check + Vitest unit tests |
| `pnpm run test:watch` | Vitest in watch mode |
| `pnpm run test:e2e` | Playwright browser E2E (Chromium + Firefox) |
| `pnpm run test:e2e:extended` | Extended Playwright suite |
| `pnpm run test:extension:e2e` | Extension E2E (requires local Chrome) |
| `pnpm run test:extension:e2e:docker` | Extension E2E in Docker (recommended) |

> **CPU note**: run unit tests single-threaded on constrained machines:
> `pnpm test -- --no-file-parallelism`

---

## Project layout

```
src/
  screens/        # Page-level React components (Chat, Models, Workspace, …)
  components/     # Shared UI components
  store/          # Redux Toolkit slices and listener middleware
  runtime/        # WASM bindings and agent runtime
  webresearch/    # Web research service, types, and limits
  extension/      # BrowserClaw ↔ extension protocol and provider
  secrets/        # In-memory SecretVault (decrypted keys never leave RAM)
  db/             # Dexie schema and storage helpers
  script/         # QuickJS sandboxed scripting layer
  workspace/      # Workspace and scripting state
  audit/          # Audit event log
  providers/      # AI provider adapters (OpenAI, Anthropic, Ollama, wllama, …)

extension/
  chrome-web-research/   # Chrome MV3 Web Research Companion
    manifest.json
    service-worker.js    # Message handler, page reader, Brave Search
    content-extract.js   # Content extraction content script

crates/
  claw-core/     # Deterministic agent runtime (pure Rust)
  claw-schema/   # Shared schema types
  claw-wasm/     # wasm-bindgen WASM bridge
  claw-testkit/  # Test utilities

docs/
  browserclaw_text_mockups/   # Canonical specs and mockups (source of truth)
```

---

## Chrome extension

The Web Research Companion extension lives in `extension/chrome-web-research/`.

**Load unpacked in Chrome:**
1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** → select `extension/chrome-web-research/`

The extension provides page reading (`read_page`, `read_pages`) and web search via the Brave Search API. BrowserClaw communicates with it over `chrome.runtime.sendMessage`. A Brave Search API key is required for web search and is entered in the BrowserClaw Settings screen — it is held in the in-memory SecretVault only.

---

## Security model

- Decrypted API keys and OAuth tokens **never** appear in Redux state, localStorage, console logs, audit events, or screenshots.
- The in-memory `SecretVault` is the only place decrypted secrets live.
- Every side effect goes through an inline approval card (approve / edit / reject) before execution.
- Every meaningful action emits an audit event visible in the Audit screen.

---

## Running extension E2E tests

The Docker lane is the recommended way to run extension E2E tests (no local Chrome profile or display needed):

```bash
pnpm run test:extension:e2e:docker
```

This builds a Docker image and runs Playwright + the unpacked extension inside it. Requires Docker.
