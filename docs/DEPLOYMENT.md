# BrowserClaw Deployment

## Canonical deployment

BrowserClaw 0.1.0 uses the repository's tagged GitHub Pages workflow:

- URL: `https://ekkus93.github.io/browser-claw/`
- base path: `/browser-claw/`
- workflow: `.github/workflows/pages.yml`
- accepted tags: `v0.1.0-rc.*` and `v0.1.0`

The workflow checks out the exact tag SHA, builds the Rust/WASM runtime, performs a strict application build, uploads `dist`, and deploys that exact output. A deployment is not release evidence unless the application's displayed commit SHA matches the accepted tag SHA.

## Required release environment

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

Provider credentials must not be supplied as build variables.

## Static hosting requirements

A non-GitHub-Pages deployment must:

1. serve the extracted app archive over HTTPS;
2. preserve the `/browser-claw/` base path unless a separately validated release configuration is produced;
3. serve `index.html` for application routes;
4. serve JavaScript, CSS, JSON, and WebAssembly with correct MIME types;
5. allow same-origin WebAssembly and worker assets;
6. avoid rewriting or minifying the already-built release archive;
7. preserve `release-metadata.json` unchanged.

The build creates `404.html` as a GitHub Pages SPA fallback.

## Security headers

The application contains a defense-in-depth CSP meta element. Deployments that support response headers should also set:

```text
Content-Security-Policy: default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob:; connect-src 'self' https: http: wss: ws: chrome-extension:; form-action 'none'
Referrer-Policy: no-referrer
X-Content-Type-Options: nosniff
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
Cross-Origin-Opener-Policy: same-origin
```

Do not enable cross-origin embedder policy without retesting every provider, local-model asset, worker, and extension workflow. GitHub Pages does not provide repository-controlled arbitrary response headers, so the in-document policy is the available baseline there.

## Rollback

Rollback means redeploying a previously accepted tag and its corresponding release artifacts. Do not rebuild an older source snapshot with a newer toolchain and call it the same release. Confirm the displayed commit SHA, `release-metadata.json`, extension ID, and checksums after rollback.
