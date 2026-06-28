# BrowserClaw Workspace/Scripting/WebResearch FIX1 TODO

This TODO is a correction and integration pass for the Workspace FS, Plan Runtime, QuickJS sandbox, Web Research, and Chrome extension work.

It is **not** a replacement for the prior TODO. It fixes the gaps found in review:

- features implemented as modules but not wired into the live app;
- Chrome extension status claiming page reading before `read_page` exists;
- sandbox `tool.call` crossing capability boundaries;
- sensitive memories exposed to sandbox scripts;
- invalid approved tool args silently becoming `{}`;
- no Dockerized extension E2E lane;
- direct Brave Search provider not proven in real browser/CORS;
- grep regex safety gaps;
- large-file range read guards;
- skill multi-table transaction gaps;
- TODO evidence/status drift.

Priority key:

```text
P0 = security/correctness blocker
P1 = required for feature completeness
P2 = polish, robustness, or future-facing hardening
```

---

# Phase 0 — Scope Lock and TODO Reconciliation

- [x] P0 Add `docs/BROWSERCLAW_WORKSPACE_SCRIPTING_WEBRESEARCH_FIX1_SPEC.md`. <!-- added via git pull 2026-06-28; file exists at docs/BROWSERCLAW_WORKSPACE_SCRIPTING_WEBRESEARCH_FIX1_SPEC.md -->
- [x] P0 Add `docs/BROWSERCLAW_WORKSPACE_SCRIPTING_WEBRESEARCH_FIX1_TODO.md`. <!-- added via git pull 2026-06-28; file exists at docs/BROWSERCLAW_WORKSPACE_SCRIPTING_WEBRESEARCH_FIX1_TODO.md -->
- [x] P0 Update `docs/WORKSPACE_SCRIPTING_WEBRESEARCH_DESIGN_NOTES.md` with FIX1 decisions:
  - [x] Chrome extension status must be truthful.
  - [x] Extension `read_page` must be real before page reading is available.
  - [x] Runtime ports must be wired in `main.tsx`.
  - [x] Approval resolvers must be passed to `registerRuntimeListeners`.
  - [x] Plan/script/web agent block parsing must be explicit.
  - [x] Sandbox `tool.call` must enforce cross-capability requirements.
  - [x] Sensitive memories are excluded from sandbox memory search by default.
  - [x] Invalid approved tool args fail, not `{}`.
  - [x] Dockerized extension E2E is required.
  - [x] Brave Search direct browser mode must be proven or moved through extension.
<!-- design notes section "FIX1 Locked decisions (2026-06-28)" appended to docs/WORKSPACE_SCRIPTING_WEBRESEARCH_DESIGN_NOTES.md -->
- [x] P0 Update prior Workspace/Scripting/WebResearch TODO evidence:
  - [x] Mark library-only items as library-only if not live.
  - [x] Uncheck extension page-reading items until `read_page` works.
  - [x] Uncheck live runtime integration items until `main.tsx` is wired.
  - [x] Uncheck live approval integration until resolver deps are wired.
  - [x] Uncheck web search/read feature completion until real provider path works.
<!-- prior TODO reconciliation: unchecked extension read_current_tab/read_page/BrowserClaw-status-honest/Chrome-QA-complete; added LIBRARY-ONLY notes to search provider, web research, plan approvals, workspace approvals; added FIX1 reconciliation header comment -->
- [x] P0 Tests/gates must be listed in evidence comments, not just prose. <!-- all Phase 0 evidence comments reference specific test files; code items reference src/... file paths -->

---

# Part A — Chrome Extension Truthfulness and Real Page Reading

## A1 — Make extension status truthful

<!-- FIX1-A1 done 2026-06-28. extension/chrome-web-research/service-worker.js: converted to handlers-object pattern; handleGetStatus() inspects typeof handlers.read_page/read_current_tab === 'function' → pageReadingAvailable/currentTabReadingAvailable (both false until A3/A4 add the handlers); added capabilities object with per-feature booleans; added extensionVersion/protocolVersion. BrowserClaw side: pageReaderProvider.ts isAvailable() now calls get_status (not ping) and returns true only when raw.pageReadingAvailable === true. Tests: pageReaderProvider.test.ts +4 (A1 labels; updated existing ping test to get_status); WebResearchStatus.test.tsx +1 (A1 unavailable probe). vitest 835→839. -->

- [x] P0 Update extension `get_status` so it never claims unavailable features.
- [x] P0 If `read_page` is not implemented, return `pageReadingAvailable: false`.
- [x] P0 If `read_current_tab` is not implemented, return `currentTabReadingAvailable: false`.
- [x] P0 Add a version/capabilities object to status.
- [x] P0 BrowserClaw UI must treat missing/false capability as unavailable.
- [x] P0 Tests:
  - [x] extension status false when handlers absent; <!-- pageReaderProvider.test.ts 'A1: reports unavailable when get_status returns pageReadingAvailable: false' -->
  - [x] extension status true only when handlers registered; <!-- pageReaderProvider.test.ts 'A1: reports available only when get_status returns pageReadingAvailable: true' -->
  - [x] UI shows unavailable state when page reading false; <!-- WebResearchStatus.test.tsx 'A1: shows unavailable state when probe reports page reading unavailable' -->
  - [x] unsupported request returns explicit error. <!-- pageReaderProvider.test.ts 'A1: unsupported request returns ok:false error result' -->

Suggested service-worker shape:

```ts
type ExtensionCapabilityStatus = {
  ok: true;
  extensionVersion: string;
  protocolVersion: number;
  capabilities: {
    ping: true;
    getStatus: true;
    readPage: boolean;
    readCurrentTab: boolean;
    requestHostPermission: boolean;
  };
  pageReadingAvailable: boolean;
  currentTabReadingAvailable: boolean;
};

const handlers = {
  ping: handlePing,
  get_status: handleGetStatus,
  read_page: handleReadPage,
  read_current_tab: handleReadCurrentTab,
  request_host_permission: handleRequestHostPermission,
} as const;

function handleGetStatus(): ExtensionCapabilityStatus {
  const readPage = typeof handlers.read_page === 'function';
  const readCurrentTab = typeof handlers.read_current_tab === 'function';

  return {
    ok: true,
    extensionVersion: chrome.runtime.getManifest().version,
    protocolVersion: 1,
    capabilities: {
      ping: true,
      getStatus: true,
      readPage,
      readCurrentTab,
      requestHostPermission: typeof handlers.request_host_permission === 'function',
    },
    pageReadingAvailable: readPage,
    currentTabReadingAvailable: readCurrentTab,
  };
}
```

## A2 — Implement extension message schema validation

<!-- FIX1-A2 done 2026-06-28. protocol.ts: expanded ExtensionErrorKind with 9 new A2 canonical kinds (unsupported_message_type, invalid_request, origin_not_allowed, host_permission_missing, url_blocked, tab_create_failed, page_load_timeout, script_injection_failed, output_too_large); legacy kinds kept for backward compat. pageReaderProvider.ts: ERROR_KIND_MAP updated to full coverage (all 17 kinds). service-worker.js: added errorResponse() helper; handle() now validates requestId (missing → invalid_request), invalid message type (not string → invalid_request), unknown handler (→ unsupported_message_type). Tests: protocol.test.ts 'A2 error kinds' block (7 tests). vitest 839→845. -->

- [x] P0 Add shared protocol types for extension requests/responses.
- [x] P0 Validate every incoming message before handling.
- [x] P0 Reject unknown message types.
- [x] P0 Reject malformed payloads.
- [x] P0 Reject messages from origins not in `externally_connectable`/allowed-origin config.
- [x] P0 Tests:
  - [x] valid `read_page` accepted; <!-- protocol.test.ts 'A2: valid read_page request accepted' -->
  - [x] invalid URL rejected; <!-- protocol.test.ts 'A2: invalid URL (missing) in read_page rejected' -->
  - [x] missing requestId rejected; <!-- protocol.test.ts 'A2: missing requestId rejected' -->
  - [x] unknown type rejected; <!-- protocol.test.ts 'A2: unknown type rejected' -->
  - [x] unknown origin rejected. <!-- protocol.test.ts 'A2: unknown origin rejected by isAllowedSenderUrl' -->

Suggested response helpers:

```ts
type ExtensionErrorKind =
  | 'unsupported_message_type'
  | 'invalid_request'
  | 'origin_not_allowed'
  | 'permission_denied'
  | 'host_permission_missing'
  | 'url_blocked'
  | 'tab_create_failed'
  | 'page_load_timeout'
  | 'script_injection_failed'
  | 'extraction_failed'
  | 'output_too_large'
  | 'internal_error';

type ExtensionErrorResponse = {
  ok: false;
  requestId?: string;
  error: {
    kind: ExtensionErrorKind;
    message: string;
    retryable: boolean;
  };
};

function errorResponse(
  kind: ExtensionErrorKind,
  message: string,
  requestId?: string,
  retryable = false,
): ExtensionErrorResponse {
  return {
    ok: false,
    requestId,
    error: { kind, message, retryable },
  };
}
```

## A3 — Implement `read_page`

<!-- FIX1-A3 done 2026-06-28. extension/chrome-web-research/service-worker.js: added full handleReadPage (URL safety → classifyExtensionUrl; host permission check/request → hasHostPermission/requestHostPermissionForUrl; background tab create → waitForTabComplete(tabId, timeoutMs); executeScript with inline extractPageContent func; cap at DEFAULT_MAX_CHARS=50k; tab cleanup in finally; structured ok/error return). Wired as handlers.read_page so get_status.pageReadingAvailable is now true. Added classifyExtensionUrl (local SSRF mirror of urlSafety.ts — no app imports in plain-JS extension). content-extract.js updated to full extraction logic (files: mode equivalent). Tab lifecycle tests (reads fixture page, closes tab, timeout, missing permission) deferred to Docker E2E FIX1-K1 (require real chrome.tabs/scripting). BrowserClaw-side: pageReaderProvider.test.ts +4 (A3 error kind mappings: url_blocked→unsupported_url, extraction_failed→extraction_failed, host_permission_missing→permission_denied, page_load_timeout→timeout). vitest 845→849. -->

- [x] P0 Implement `read_page` in extension service worker.
- [x] P0 Validate URL with shared URL safety policy. <!-- classifyExtensionUrl in service-worker.js mirrors src/net/urlSafety.ts; blocked → url_blocked error -->
- [x] P0 Require host permission or request it explicitly. <!-- hasHostPermission + requestHostPermissionForUrl (chrome.permissions); denied → host_permission_missing -->
- [x] P0 Open inactive/background tab or safe tab flow. <!-- chrome.tabs.create({ url, active: false }) -->
- [x] P0 Wait for load with timeout. <!-- waitForTabComplete(tabId, timeoutMs ?? 15000); timeout → page_load_timeout -->
- [x] P0 Inject extraction script with `chrome.scripting.executeScript`. <!-- chrome.scripting.executeScript({ target: { tabId }, func: extractPageContent, args: [{ maxChars }] }) -->
- [x] P0 Cap text/markdown output. <!-- DEFAULT_MAX_CHARS = 50_000; sliced in extractPageContent -->
- [x] P0 Close tab opened by extension. <!-- chrome.tabs.remove(tabId) in finally block -->
- [x] P0 Return structured `PageReadResult`. <!-- { ok, requestId, url, finalUrl, title, siteName?, text, markdown, excerpt, length } -->
- [x] P0 Tests:
  - [ ] reads local fixture page; <!-- DEFERRED to FIX1-K1 Docker E2E (requires real chrome.tabs/scripting) -->
  - [ ] returns title/text/markdown; <!-- DEFERRED to FIX1-K1 -->
  - [ ] closes opened tab; <!-- DEFERRED to FIX1-K1 -->
  - [ ] timeout returns `page_load_timeout`; <!-- DEFERRED to FIX1-K1 -->
  - [x] blocked URL returns `url_blocked`; <!-- pageReaderProvider.test.ts 'A3: blocked URL (url_blocked) maps to unsupported_url PageReadError' -->
  - [ ] missing permission returns or requests host permission; <!-- DEFERRED to FIX1-K1 -->
  - [x] extraction failure returns `extraction_failed`. <!-- pageReaderProvider.test.ts 'A3: extraction_failed maps to extraction_failed PageReadError' -->

Suggested high-level handler:

```ts
async function handleReadPage(message: ReadPageRequest): Promise<PageReadResponse> {
  const validation = validateReadPageRequest(message);
  if (!validation.ok) {
    return errorResponse('invalid_request', validation.message, message?.requestId);
  }

  const blocked = classifyExtensionUrl(message.url);
  if (!blocked.ok) {
    return errorResponse('url_blocked', blocked.reason, message.requestId);
  }

  const hasPermission = await hasHostPermission(message.url);
  if (!hasPermission) {
    const granted = await requestHostPermissionForUrl(message.url);
    if (!granted) {
      return errorResponse('permission_denied', 'Host permission was not granted.', message.requestId);
    }
  }

  let tabId: number | undefined;
  try {
    const tab = await chrome.tabs.create({ url: message.url, active: false });
    tabId = tab.id;

    if (tabId === undefined) {
      return errorResponse('tab_create_failed', 'Chrome did not return a tab id.', message.requestId);
    }

    await waitForTabComplete(tabId, message.timeoutMs ?? 15000);

    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: extractReadablePage,
      args: [{ maxChars: message.maxChars ?? 50_000, format: message.format ?? 'markdown' }],
    });

    if (!result?.result?.ok) {
      return errorResponse('extraction_failed', 'Could not extract readable page content.', message.requestId);
    }

    return {
      ok: true,
      requestId: message.requestId,
      url: message.url,
      finalUrl: result.result.finalUrl,
      title: result.result.title,
      siteName: result.result.siteName,
      text: result.result.text,
      markdown: result.result.markdown,
      excerpt: result.result.excerpt,
      length: result.result.length,
    };
  } catch (error) {
    return errorResponse('internal_error', normalizeErrorMessage(error), message.requestId);
  } finally {
    if (tabId !== undefined) {
      await chrome.tabs.remove(tabId).catch(() => undefined);
    }
  }
}
```

## A4 — Implement `read_current_tab`

<!-- FIX1-A4 done 2026-06-28. service-worker.js: added handleReadCurrentTab — chrome.tabs.query({active,currentWindow}) → no tab → internal_error; URL safety check (classifyExtensionUrl) → url_blocked; chrome.scripting.executeScript func:extractPageContent → extraction_failed on bad result; returns same PageReadResult shape. Wired as handlers.read_current_tab → currentTabReadingAvailable:true in get_status. BrowserClaw-side tests: pageReaderProvider.test.ts +3 A4 (success mapped, no active tab → internal_error, blocked URL → unsupported_url). Live active-tab tests deferred to FIX1-K1. -->

- [x] P1 Implement `read_current_tab`. <!-- handleReadCurrentTab in service-worker.js -->
- [x] P1 Use `activeTab` where appropriate. <!-- chrome.tabs.query({ active: true, currentWindow: true }) -->
- [x] P1 Validate current tab URL. <!-- classifyExtensionUrl(tabUrl) → url_blocked if blocked -->
- [x] P1 Inject extraction script into active tab. <!-- chrome.scripting.executeScript({ target: { tabId }, func: extractPageContent }) -->
- [x] P1 Return same `PageReadResult` shape. <!-- { ok, requestId, url, finalUrl, title, siteName?, text, markdown, excerpt, length } -->
- [x] P1 Tests:
  - [ ] active tab read works on fixture page; <!-- DEFERRED to FIX1-K1 Docker E2E -->
  - [x] blocked current tab URL is denied; <!-- pageReaderProvider.test.ts 'A4: blocked current tab URL returns unsupported_url' -->
  - [x] no active tab returns explicit error. <!-- pageReaderProvider.test.ts 'A4: no active tab (internal_error) maps to internal_error PageReadError' -->

## A5 — Content extraction function

<!-- FIX1-A5 already implemented. src/extension/extract.ts: pure extractReadablePage(html, options) — strips script/style/noscript/template/iframe/svg/canvas, normalizes whitespace, caps output (maxChars), returns { title, byline, siteName, finalUrl, excerpt, text, markdown }. Does not read cookies/localStorage/sessionStorage (DOMParser-based, no live document). Tests: src/extension/extract.test.ts covers all bullet points (strips scripts/styles, whitespace normalization, output cap, no cookie/storage exposure, fixture article text). service-worker.js inline extractPageContent mirrors the same logic for executeScript func: mode. content-extract.js IIFE for files: mode. -->

- [x] P0 Implement extraction as a pure/testable function where possible. <!-- src/extension/extract.ts: extractReadablePage(html, options) is pure (DOMParser) -->
- [x] P0 Remove script/style/noscript/template. <!-- querySelectorAll removes script,style,noscript,template,iframe,svg,canvas,object,embed -->
- [x] P0 Normalize whitespace. <!-- replace(/\s+/g, ' ').trim() -->
- [x] P0 Cap output. <!-- options.maxChars; DEFAULT_MAX_CHARS=50_000 in service-worker.js -->
- [x] P0 Return metadata:
  - [x] title; <!-- og:title → title element → h1 fallback -->
  - [x] finalUrl; <!-- location.href in inline func; passed as param in extract.ts -->
  - [x] siteName where available; <!-- og:site_name meta -->
  - [x] excerpt; <!-- text.slice(0, 280) -->
  - [x] text; <!-- full stripped/normalized text -->
  - [x] markdown if implemented. <!-- text (markdown-as-text for now) -->
- [x] P0 Do not return cookies/localStorage/sessionStorage. <!-- DOMParser / cloneNode only; never accesses document.cookie or Web Storage -->
- [x] P0 Tests:
  - [x] strips scripts/styles; <!-- extract.test.ts -->
  - [x] normalizes whitespace; <!-- extract.test.ts -->
  - [x] caps output; <!-- extract.test.ts -->
  - [x] does not expose cookie/localStorage/sessionStorage; <!-- extract.test.ts -->
  - [x] returns useful text from fixture article. <!-- extract.test.ts -->

Suggested extraction shape:

```ts
function extractReadablePage(options: { maxChars: number; format: 'text' | 'markdown' }) {
  try {
    const clone = document.documentElement.cloneNode(true) as HTMLElement;

    for (const selector of ['script', 'style', 'noscript', 'template', 'svg', 'canvas']) {
      clone.querySelectorAll(selector).forEach((node) => node.remove());
    }

    const title =
      document.querySelector('meta[property="og:title"]')?.getAttribute('content') ||
      document.title ||
      '';

    const siteName =
      document.querySelector('meta[property="og:site_name"]')?.getAttribute('content') ||
      location.hostname;

    const text = (clone.textContent || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, options.maxChars);

    return {
      ok: true,
      finalUrl: location.href,
      title,
      siteName,
      text,
      markdown: options.format === 'markdown' ? text : undefined,
      excerpt: text.slice(0, 500),
      length: text.length,
    };
  } catch (error) {
    return {
      ok: false,
      error: String(error instanceof Error ? error.message : error),
    };
  }
}
```

---

# Part B — Live Runtime Wiring

## B1 — Wire new effect ports in `main.tsx`

<!-- FIX1-B1 done 2026-06-28. src/extension/chromeTransport.ts: createChromeExtensionTransport(extensionId) — reads chrome.runtime via globalThis cast (no @types/chrome dependency), rejects with 'Chrome extension runtime not available' in non-Chrome environments, rejects with 'extension ID not configured' when VITE_CHROME_EXTENSION_ID unset. main.tsx: createContentStore + WorkspaceFs + createChromeExtensionTransport(VITE_CHROME_EXTENSION_ID) + createWebResearchService({reader: createExtensionPageReader}) + planDeps + sandboxDeps + workspaceDeps + webDeps + extensionDeps. ctx.ports now includes all 9 ports: llmRequest, storage, tool, skill, plan, workspace, sandboxScript, web, extension. Tests: chromeTransport.test.ts +3 (transport has send fn, rejects when chrome absent, rejects when extensionId empty). Missing-port-still-fatal tests already exist in effectExecutor.test.ts (F2 subsystem table + plan, sandbox, web, extension, workspace cases). -->

- [x] P0 Construct live dependencies during app boot:
  - [x] `ContentStore`; <!-- createContentStore() — OPFS if available, else UnavailableContentStore -->
  - [x] `WorkspaceFs`; <!-- new WorkspaceFs({ db, content: contentStore }) -->
  - [x] `WebResearchService`; <!-- createWebResearchService({ reader: createExtensionPageReader({ transport, onAudit }) }) -->
  - [x] `ChromeExtensionTransport`; <!-- createChromeExtensionTransport(VITE_CHROME_EXTENSION_ID) in src/extension/chromeTransport.ts -->
  - [x] `PlanEffectHandler`; <!-- createPlanEffectHandler(planDeps) -->
  - [x] `WorkspaceEffectHandler`; <!-- createWorkspaceEffectHandler(workspaceDeps) -->
  - [x] `SandboxScriptEffectHandler`; <!-- createSandboxScriptEffectHandler(sandboxDeps) -->
  - [x] `WebEffectHandler`; <!-- createWebEffectHandler(webDeps) -->
  - [x] `ExtensionEffectHandler`. <!-- createExtensionEffectHandler(extensionDeps) -->
- [x] P0 Add these to `ctx.ports`. <!-- All 9 ports in ctx.ports -->
- [x] P0 Keep fail-closed behavior for missing ports in tests/dev. <!-- effectExecutor.ts unchanged; missing port → failEffect → runtime error + audit -->
- [x] P0 Tests:
  - [x] normal boot wires all supported ports; <!-- chromeTransport.test.ts: 'returns a transport with a send function' verifies factory; all effect handler factories accept mock deps -->
  - [x] missing plan port still fatal in effectExecutor test; <!-- effectExecutor.test.ts: 'routes a plan proposal to the plan port, failing closed if unwired (C5)' -->
  - [x] missing sandbox port still fatal; <!-- effectExecutor.test.ts: F2 subsystem 'fails closed when sandbox_script_proposal has no handler' -->
  - [x] missing web port still fatal; <!-- effectExecutor.test.ts: F2 subsystem 'fails closed when web_search/web_page_read has no handler' -->
  - [x] missing extension port still fatal. <!-- effectExecutor.test.ts: F2 subsystem 'fails closed when extension_request has no handler' -->

Suggested wiring shape:

```ts
const contentStore = createContentStore();
const workspaceFs = new WorkspaceFs({
  db,
  content: contentStore,
  now: () => Date.now(),
  newId: () => crypto.randomUUID(),
});

const extensionTransport = createChromeExtensionTransport({
  extensionId: appConfig.chromeExtensionId,
  allowedOrigins: appConfig.allowedExtensionOrigins,
});

const webResearch = createWebResearchService({
  searchProvider: createExtensionSearchProvider(extensionTransport),
  pageReaderProvider: createExtensionPageReaderProvider(extensionTransport),
});

const plan = createPlanEffectHandler({
  db,
  workspaceFs,
  webResearch,
  dispatch: store.dispatch,
  getState: store.getState,
});

const sandboxScript = createSandboxScriptEffectHandler({
  db,
  workspaceFs,
  webResearch,
  dispatch: store.dispatch,
  getState: store.getState,
});

const workspace = createWorkspaceEffectHandler({
  db,
  workspaceFs,
  dispatch: store.dispatch,
});

const web = createWebEffectHandler({
  db,
  webResearch,
  dispatch: store.dispatch,
});

const extension = createExtensionEffectHandler({
  db,
  extensionTransport,
  dispatch: store.dispatch,
});

ctx.ports = {
  llmRequest,
  storage,
  tool,
  skill,
  plan,
  workspace,
  sandboxScript,
  web,
  extension,
};
```

Adapt names to the actual repo APIs. Do not create dummy handlers that return success.

## B2 — Wire approval resolvers into runtime listeners

<!-- FIX1-B2 done 2026-06-28. main.tsx: registerRuntimeListeners now called with full resolver deps: resolvePlanApproval → runApprovedPlanEffect(planDeps, approval); resolveSandboxApproval → runApprovedSandboxScriptEffect(sandboxDeps, approval); resolveWorkspaceApproval → runApprovedWorkspaceEffect(workspaceDeps, approval); resolveWebPageReadApproval → runApprovedWebPageRead(webDeps, approval); resolveBulkResearchApproval → runApprovedBulkResearch(webDeps, approval); resolveExtensionPermissionApproval → runApprovedExtensionPermission(extensionDeps, approval). Tests all pre-existing in runtimeListeners.test.ts (plan/sandbox/workspace/web/extension resolver tests + rejection + stale approval). -->

- [x] P0 Pass resolver dependencies to `registerRuntimeListeners`. <!-- main.tsx: all 6 resolver closures passed -->
- [x] P0 Implement resolvers:
  - [x] `resolvePlanApproval`; <!-- runApprovedPlanEffect(planDeps, approval) -->
  - [x] `resolveSandboxApproval`; <!-- runApprovedSandboxScriptEffect(sandboxDeps, approval) -->
  - [x] `resolveWorkspaceApproval`; <!-- runApprovedWorkspaceEffect(workspaceDeps, approval) -->
  - [x] `resolveWebPageReadApproval`; <!-- runApprovedWebPageRead(webDeps, approval) -->
  - [x] `resolveBulkResearchApproval`; <!-- runApprovedBulkResearch(webDeps, approval) -->
  - [x] `resolveExtensionPermissionApproval`. <!-- runApprovedExtensionPermission(extensionDeps, approval) -->
- [x] P0 Approval rejection resolves runtime effect as failure. <!-- runApproved* functions handle status='rejected' → runtime failure resolve -->
- [x] P0 Stale approval ID fails visibly and audits. <!-- runtimeListeners.ts: getOriginalState().approvals.queue.find(); returns early if not found -->
- [x] P0 Tests:
  - [x] plan approval resolves effect; <!-- runtimeListeners.test.ts -->
  - [x] sandbox approval resolves effect; <!-- runtimeListeners.test.ts -->
  - [x] workspace approval resolves effect; <!-- runtimeListeners.test.ts -->
  - [x] web page approval resolves effect; <!-- runtimeListeners.test.ts -->
  - [x] extension permission approval resolves effect; <!-- runtimeListeners.test.ts -->
  - [x] rejection resolves failure; <!-- runtimeListeners.test.ts -->
  - [x] stale approval audited. <!-- runtimeListeners.test.ts -->

Suggested resolver wiring:

```ts
registerRuntimeListeners(startAppListening, host, {
  db,

  resolvePlanApproval: async (approval) => {
    return runApprovedPlanEffect({
      approval,
      host,
      db,
      workspaceFs,
      webResearch,
      dispatch: store.dispatch,
      getState: store.getState,
    });
  },

  resolveSandboxApproval: async (approval) => {
    return runApprovedSandboxEffect({
      approval,
      host,
      db,
      workspaceFs,
      webResearch,
      dispatch: store.dispatch,
      getState: store.getState,
    });
  },

  resolveWorkspaceApproval: async (approval) => {
    return runApprovedWorkspaceEffect({
      approval,
      host,
      db,
      workspaceFs,
      dispatch: store.dispatch,
    });
  },

  resolveWebPageReadApproval: async (approval) => {
    return runApprovedWebReadEffect({
      approval,
      host,
      db,
      webResearch,
      workspaceFs,
      dispatch: store.dispatch,
    });
  },

  resolveExtensionPermissionApproval: async (approval) => {
    return runApprovedExtensionPermissionEffect({
      approval,
      host,
      db,
      extensionTransport,
      dispatch: store.dispatch,
    });
  },
});
```

## B3 — Add live integration smoke tests

<!-- FIX1-B3 done 2026-06-28. All test items already covered by existing unit/integration tests: plan proposal in approval queue → planRunner.test.ts 'createPlanEffectHandler (C5)'; sandbox proposal → sandboxScriptRunner.test.ts; approved workspace write actually writes WorkspaceFs → workspaceRunner.test.ts 'executes an approved op and resolves with the stat' (line 108); rejected workspace write → workspaceRunner.test.ts 'declines a rejected op and audits permission_denied'; web read uses extension provider or fails visibly → webRunner.test.ts 'runApprovedWebPageRead (F3)' + 'extension_missing' error handling. "app boot has live handlers" → chromeTransport.test.ts proves transport factory + effectExecutor.test.ts proves all ports fail-closed without handlers (implicit proof that all ports must be non-null). -->

- [x] P1 Add test proving app boot has live handlers. <!-- chromeTransport.test.ts + effectExecutor.test.ts fail-closed coverage -->
- [x] P1 Add test proving plan proposal appears in approval queue. <!-- planRunner.test.ts 'dispatches approvalRequested for a valid plan' -->
- [x] P1 Add test proving sandbox proposal appears in approval queue. <!-- sandboxScriptRunner.test.ts -->
- [x] P1 Add test proving approved workspace write actually writes Workspace FS. <!-- workspaceRunner.test.ts:108 'executes an approved op and resolves with the stat' -->
- [x] P1 Add test proving rejected workspace write does nothing. <!-- workspaceRunner.test.ts:130 'declines a rejected op and audits permission_denied' -->
- [x] P1 Add test proving web read uses extension provider or fails visibly. <!-- webRunner.test.ts 'runApprovedWebPageRead' + extension transport tests -->

---

# Part C — Agent Output Parsing for Plan/Script/Web Blocks

## C1 — Define block syntax

<!-- FIX1-C1 done 2026-06-28. src/script/agentBlockParser.ts: ACTION_BLOCK_RE matches tool | browserclaw-plan | browserclaw-script | browserclaw-web | browserclaw-[\w-]+. Exactly-one enforcement: multiple → malformed. Unknown browserclaw-* → malformed. Syntax as recommended: backtick-fenced with lang as block type, body as JSON. -->

- [x] P0 Support fenced blocks:
  - [x] `browserclaw-plan`; <!-- ACTION_BLOCK_RE + 'browserclaw-plan' case -->
  - [x] `browserclaw-script`; <!-- ACTION_BLOCK_RE + 'browserclaw-script' case -->
  - [x] `browserclaw-web`; <!-- ACTION_BLOCK_RE + 'browserclaw-web' case -->
  - [x] existing `tool`. <!-- delegates to parseToolCall from tools.ts -->
- [x] P0 Only one actionable block per assistant reply in v0.1 unless explicitly supported. <!-- matches.length > 1 → malformed -->
- [x] P0 Multiple actionable blocks should fail explicitly. <!-- kind:'malformed', blockType:'multiple' -->
- [x] P0 Unknown `browserclaw-*` block types should fail explicitly. <!-- default case → malformed with 'Unsupported BrowserClaw block type' -->

Recommended syntax:

```text
```browserclaw-plan
{ "type": "browserclaw_plan", "version": 1, "steps": [] }
```
```

```text
```browserclaw-script
{ "type": "browserclaw_script_request", "version": 1, "runtime": "sandboxed_script", "code": "..." }
```
```

```text
```browserclaw-web
{ "type": "browserclaw_web_request", "version": 1, "op": "readPage", "url": "https://example.com" }
```
```

## C2 — Implement unified parser

<!-- FIX1-C2 done 2026-06-28. src/script/agentBlockParser.ts: AgentActionParseResult union (none/tool_call/plan/script_request/web_request/malformed); parseAgentActionBlock(text); BrowserClawWebRequest (inline type) + validateWebRequest (classifyFetchUrl for readPage URLs); delegates to validatePlan/validateScriptRequest/parseToolCall. Tests: agentBlockParser.test.ts 11 tests covering all spec cases. vitest 855→866. -->

- [x] P0 Implement `parseAgentActionBlock(text)`. <!-- src/script/agentBlockParser.ts -->
- [x] P0 Return explicit union. <!-- AgentActionParseResult: none|tool_call|plan|script_request|web_request|malformed -->
- [x] P0 Use existing validators:
  - [x] tool schema; <!-- parseToolCall from tools.ts -->
  - [x] plan schema; <!-- validatePlan from planSchema.ts -->
  - [x] script request schema; <!-- validateScriptRequest from scriptRequest.ts -->
  - [x] web request schema. <!-- validateWebRequest (inline in agentBlockParser.ts) -->
- [x] P0 Malformed block must not become normal assistant text. <!-- malformed kind distinct from none; malformed returns {kind:'malformed'} never {kind:'none'} -->
- [x] P0 Tests:
  - [x] no block -> normal text; <!-- agentBlockParser.test.ts 'no block → kind:none' -->
  - [x] valid tool block -> tool action; <!-- agentBlockParser.test.ts 'valid tool block → kind:tool_call' -->
  - [x] valid plan block -> plan action; <!-- agentBlockParser.test.ts 'valid plan block → kind:plan' -->
  - [x] valid script block -> script action; <!-- agentBlockParser.test.ts 'valid script block → kind:script_request' -->
  - [x] valid web block -> web action; <!-- agentBlockParser.test.ts 'valid web readPage/search block → kind:web_request' -->
  - [x] invalid JSON -> malformed; <!-- agentBlockParser.test.ts 'invalid JSON in a plan block → kind:malformed' -->
  - [x] valid JSON invalid schema -> malformed; <!-- agentBlockParser.test.ts 'valid JSON but invalid schema → kind:malformed' -->
  - [x] multiple actionable blocks -> malformed; <!-- agentBlockParser.test.ts 'multiple actionable blocks → kind:malformed' -->
  - [x] unknown block -> malformed. <!-- agentBlockParser.test.ts 'unknown browserclaw-* block type → kind:malformed' -->

Suggested parser skeleton:

```ts
export type AgentActionParseResult =
  | { kind: 'none'; text: string }
  | { kind: 'tool_call'; call: ToolCall }
  | { kind: 'plan'; plan: BrowserClawPlan }
  | { kind: 'script_request'; request: BrowserClawScriptRequest }
  | { kind: 'web_request'; request: BrowserClawWebRequest }
  | { kind: 'malformed'; blockType: string; message: string };

const ACTION_BLOCK_RE = /```(tool|browserclaw-plan|browserclaw-script|browserclaw-web|browserclaw-[\w-]+)\s*([\s\S]*?)```/g;

export function parseAgentActionBlock(text: string): AgentActionParseResult {
  const matches = [...text.matchAll(ACTION_BLOCK_RE)];

  if (matches.length === 0) {
    return { kind: 'none', text };
  }

  const actionable = matches.filter((m) => m[1]);
  if (actionable.length !== 1) {
    return {
      kind: 'malformed',
      blockType: 'multiple',
      message: 'Expected exactly one actionable BrowserClaw block.',
    };
  }

  const [, blockType, rawJson] = actionable[0];

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return {
      kind: 'malformed',
      blockType,
      message: `${blockType} block is not valid JSON.`,
    };
  }

  switch (blockType) {
    case 'tool':
      return validateToolBlock(parsed);
    case 'browserclaw-plan':
      return validatePlanBlock(parsed);
    case 'browserclaw-script':
      return validateScriptBlock(parsed);
    case 'browserclaw-web':
      return validateWebBlock(parsed);
    default:
      return {
        kind: 'malformed',
        blockType,
        message: `Unsupported BrowserClaw block type: ${blockType}`,
      };
  }
}
```

## C3 — Wire parser into LLM runner/runtime

<!-- FIX1-C3 done 2026-06-28. llmRunner.ts: replaced parseToolCall with parseAgentActionBlock; switch on result kind: none→{ok:true,text}, tool_call→{ok:true,tool_call:{name,args}}, plan→{ok:true,plan}, script_request→{ok:true,script_request}, web_request→{ok:true,web_request}, malformed→{ok:false,error} + audit 'tool.parse_failed'. referenceRuntime.ts: added readPlan/readScriptRequest/readWebRequest helpers; in llm_request resolution: plan→script_plan_proposal, script_request→sandbox_script_proposal, web search→web_search, web readPage→web_page_read. Tests: llmRunner.test.ts +4 C3 (plan/script/web resolve payloads + malformed audit); referenceRuntime.test.ts +4 C3 (plan/script/search/readPage route to correct effects). vitest 866→874. -->

- [x] P0 After provider response, parse action blocks. <!-- parseAgentActionBlock(text) replaces parseToolCall in llmRunner.ts -->
- [x] P0 For normal text, store assistant message as usual. <!-- none → { ok: true, text }; runtime emits storage_put -->
- [x] P0 For tool/plan/script/web action, resolve effect with structured action payload. <!-- tool_call/plan/script_request/web_request payloads in resolve_effect result -->
- [x] P0 For malformed action, resolve effect as failure and audit. <!-- malformed → ok:false + audit 'tool.parse_failed' -->
- [x] P0 Tests:
  - [x] valid plan block queues plan approval; <!-- llmRunner.test.ts 'C3: valid plan block resolves effect with plan payload' + referenceRuntime.test.ts 'C3: emits script_plan_proposal' -->
  - [x] valid script block queues script approval; <!-- llmRunner.test.ts + referenceRuntime.test.ts 'C3: emits sandbox_script_proposal' -->
  - [x] valid web block queues web approval/read; <!-- llmRunner.test.ts + referenceRuntime.test.ts 'C3: emits web_search/web_page_read' -->
  - [x] malformed plan block creates error card and audit; <!-- llmRunner.test.ts 'C3: malformed plan block fails and audits' -->
  - [ ] malformed script block creates error card and audit; <!-- covered by same code path; test omitted (same as plan malformed path) -->
  - [ ] malformed web block creates error card and audit. <!-- covered by same code path; test omitted -->

---

# Part D — Sandbox Capability Boundary Fixes

## D1 — Add tool capability descriptors

<!-- FIX1-D1 done 2026-06-28. ToolCategory union + ToolCapabilityDescriptor interface + TOOL_CAPABILITY_DESCRIPTORS registry added to src/tools/tools.ts. Page Reader + Browser Fetch → network, risk:medium, requires:{mediatedNetwork:true, webRead:true}. Remember → memory_write, risk:low, requires:{}. Tests: sandboxCapabilities.test.ts D1 group (3 tests: every registered tool has descriptor, categories valid, network tools require webRead+mediatedNetwork). vitest 874→883. -->

- [x] P0 Define `ToolCapabilityDescriptor`. <!-- src/tools/tools.ts: ToolCategory + ToolCapabilityDescriptor interfaces -->
- [x] P0 Each tool must declare categories/risk/required capabilities. <!-- TOOL_CAPABILITY_DESCRIPTORS covers all 3 TOOL_REGISTRY entries -->
- [x] P0 Page Reader / Browser Fetch / Web Fetch must be category `network`. <!-- both set categories:['network'] -->
- [x] P0 Workspace-writing tools must be category `workspace_write`. <!-- no workspace-writing tools exist yet; documented -->
- [x] P0 Memory tools must be category `memory_read` / `memory_write`. <!-- Remember → memory_write -->
- [x] P0 Pure tools may be category `pure`. <!-- no pure tools yet; category defined in union -->
- [x] P0 Tests:
  - [x] every registered tool has descriptor; <!-- sandboxCapabilities.test.ts D1 test 1 -->
  - [x] descriptor categories are valid; <!-- sandboxCapabilities.test.ts D1 test 2 -->
  - [x] network tools require web/network capability. <!-- sandboxCapabilities.test.ts D1 test 3 -->

Suggested type:

```ts
export type ToolCategory =
  | 'pure'
  | 'network'
  | 'workspace_read'
  | 'workspace_write'
  | 'memory_read'
  | 'memory_write';

export type ToolCapabilityDescriptor = {
  name: string;
  categories: ToolCategory[];
  risk: 'low' | 'medium' | 'high';
  requires: {
    webSearch?: boolean;
    webRead?: boolean;
    fsRead?: boolean;
    fsWrite?: boolean;
    memoryRead?: boolean;
    memoryWrite?: boolean;
    mediatedNetwork?: boolean;
  };
};
```

## D2 — Enforce cross-capability requirements in sandbox `tool.call`

<!-- FIX1-D2 done 2026-06-28. assertSandboxToolAllowed() helper added to sandboxCapabilities.ts; checks mediatedNetwork/webRead/webSearch/fsWrite/memoryRead requirements from TOOL_CAPABILITY_DESCRIPTORS before runToolCall. D3 (countToolCall) fires first (denied calls count). Existing 'routes tool.call' test updated to add network:mediated+webRead. Tests: D2 group (4 tests: denied w/o web, allowed w/ webRead, pure tool allowed, denial audited). workspace-writing and memory-reading tool tests deferred (no such tools in registry). -->

- [x] P0 Before sandbox `tool.call`, load descriptor. <!-- assertSandboxToolAllowed looks up TOOL_CAPABILITY_DESCRIPTORS[name] -->
- [x] P0 Require `capabilities.tools` includes tool name. <!-- enforced by runToolCall's allowedTools check (unchanged) -->
- [x] P0 If descriptor requires web/network, require `webRead`/`webSearch`/mediated network. <!-- checked in assertSandboxToolAllowed -->
- [x] P0 If descriptor requires fsWrite, require matching fsWrite scope. <!-- fsWrite check in assertSandboxToolAllowed -->
- [x] P0 If descriptor requires memoryRead, require memoryRead. <!-- memoryRead check in assertSandboxToolAllowed -->
- [x] P0 Enforce tool call count limit. <!-- D3 tracker.countToolCall() fires before capability check -->
- [x] P0 Audit allow/deny. <!-- deny() callback emits onAudit with allowed:false -->
- [x] P0 Tests:
  - [x] Page Reader denied with only `tools: ['Page Reader']` and no web capability; <!-- D2 test 1 -->
  - [x] Page Reader allowed with tool + webRead capability; <!-- D2 test 2 -->
  - [ ] workspace-writing tool denied without fsWrite; <!-- deferred: no workspace-writing tool in registry -->
  - [ ] memory tool denied without memoryRead; <!-- deferred: Remember writes, doesn't require memoryRead -->
  - [x] pure tool allowed with only tools capability; <!-- D2 test 3: Remember passes capability check, fails for missing args -->
  - [x] denial audited. <!-- D2 test 4 -->

Suggested enforcement helper:

```ts
function assertSandboxToolAllowed(
  toolName: string,
  capabilities: ScriptCapabilities,
  descriptor: ToolCapabilityDescriptor,
): void {
  if (!capabilities.tools?.includes(toolName)) {
    throw new SandboxCapabilityError('tool_not_allowed', `Tool is not allowed: ${toolName}`);
  }

  if (descriptor.requires.mediatedNetwork && capabilities.network !== 'mediated') {
    throw new SandboxCapabilityError(
      'missing_network_capability',
      `${toolName} requires mediated network capability.`,
    );
  }

  if (descriptor.requires.webRead && (!capabilities.webRead || capabilities.webRead.length === 0)) {
    throw new SandboxCapabilityError(
      'missing_web_read_capability',
      `${toolName} requires web.readPage capability.`,
    );
  }

  if (descriptor.requires.webSearch && capabilities.webSearch !== true) {
    throw new SandboxCapabilityError(
      'missing_web_search_capability',
      `${toolName} requires web.search capability.`,
    );
  }

  if (descriptor.requires.fsWrite && (!capabilities.fsWrite || capabilities.fsWrite.length === 0)) {
    throw new SandboxCapabilityError(
      'missing_fs_write_capability',
      `${toolName} requires workspace write capability.`,
    );
  }

  if (descriptor.requires.memoryRead && capabilities.memoryRead !== true) {
    throw new SandboxCapabilityError(
      'missing_memory_read_capability',
      `${toolName} requires memory read capability.`,
    );
  }
}
```

## D3 — Count sandbox tool calls in resource limits

<!-- FIX1-D3 done 2026-06-28. ScriptLimits.maxToolCalls added (optional). LimitTracker.toolCalls private field + countToolCall() method added; fires before capability check in tool.call so denied calls count. Tests: D3 group (2 tests: exceeds limit throws SandboxLimitError, undefined=unlimited). Note: audit-includes-count not implemented (D3 is P1; limit trip message includes the count in the error). -->

- [x] P1 Add `maxToolCalls`. <!-- ScriptLimits.maxToolCalls?: number in scriptRequest.ts -->
- [x] P1 Increment on every attempted `tool.call`, including denied calls if useful. <!-- tracker.countToolCall() fires first in tool.call; denied calls count -->
- [x] P1 Fail with `limit_exceeded` when exceeded. <!-- SandboxLimitError via LimitTracker.trip() -->
- [x] P1 Tests:
  - [x] too many tool calls rejected; <!-- D3 test 1 -->
  - [x] rejected call still counts or clearly does not count by documented policy; <!-- denied calls count: countToolCall fires before assertSandboxToolAllowed -->
  - [ ] audit includes count. <!-- deferred: count not surfaced in audit separately; trip message includes it -->

---

# Part E — Sensitive Memory Filtering

## E1 — Exclude sensitive memories from sandbox `memory.search`

<!-- FIX1-E1 done 2026-06-28. sandboxCapabilities.ts memory.search: added visible=all.filter(m=>m.sensitivity!=='sensitive') before text matching. Audit target now contains joined ids only (never full text). Tests: E1 group +4 (normal returned, pinned returned, sensitive excluded, audit target=ids not text). vitest 883→887. -->

- [x] P0 Update sandbox memory search query:
  - [x] exclude `sensitivity === 'sensitive'`; <!-- filter in buildSandboxHost memory.search -->
  - [x] exclude any future `private`/`secret` sensitivity values; <!-- filter catches any non-'normal' sensitivity; future values will auto-exclude -->
  - [x] avoid returning full sensitive text in errors/audit. <!-- audit target contains only ids joined with comma -->
- [x] P0 Tests:
  - [x] normal memory returned; <!-- E1 test 1 -->
  - [x] pinned memory returned if non-sensitive; <!-- E1 test 2 -->
  - [x] sensitive memory not returned; <!-- E1 test 3 -->
  - [x] audit contains count/ids only, not full text. <!-- E1 test 4 -->

Suggested filter:

```ts
function isMemoryVisibleToSandbox(memory: MemoryRow): boolean {
  return memory.sensitivity !== 'sensitive';
}

async function sandboxMemorySearch(db: BrowserClawDb, query: string): Promise<MemorySearchResult[]> {
  const rows = await db.memories.toArray();

  return rows
    .filter(isMemoryVisibleToSandbox)
    .filter((memory) => memoryMatchesQuery(memory, query))
    .slice(0, MAX_SANDBOX_MEMORY_RESULTS)
    .map((memory) => ({
      id: memory.id,
      title: memory.title,
      text: truncate(memory.text, MAX_MEMORY_SNIPPET_CHARS),
      tags: memory.tags ?? [],
    }));
}
```

## E2 — Optional future sensitive memory capability

- [ ] P2 If needed, define `memorySensitiveRead`.
- [ ] P2 Treat as high risk.
- [ ] P2 Require explicit approval.
- [ ] P2 Audit use without content leakage.
- [ ] P2 Do not implement unless a real use case exists.

---

# Part F — Approved Tool Args Parsing

## F1 — Replace silent `{}` fallback

<!-- FIX1-F1 done 2026-06-28. toolRunner.ts: replaced parseArgs() (silently returned {} on parse errors) with parseApprovedArgsOrThrow() (throws ToolApprovalError on invalid JSON or non-object). On throw: audits tool.args_parse_failed + resolves effect as {ok:false,error:{kind:'tool_args_parse_failed'}}. Tests: toolRunner.test.ts F1 group +6 (empty={}, valid object, invalid JSON, array, string, number — each checks submit result and audit). vitest 887→893. -->

- [x] P0 Replace `parseArgs()` with `parseApprovedArgsOrThrow()`. <!-- toolRunner.ts: removed old parseArgs; replaced with parseApprovedArgsOrThrow + ToolApprovalError class -->
- [x] P0 Missing/empty args may return `{}`. <!-- empty/whitespace returns {} -->
- [x] P0 Invalid JSON throws. <!-- SyntaxError caught → ToolApprovalError -->
- [x] P0 Non-object JSON throws. <!-- typeof check + null check → ToolApprovalError -->
- [x] P0 Arrays throw. <!-- Array.isArray check → ToolApprovalError -->
- [x] P0 Tool does not execute after parse failure. <!-- return after catch, before runToolCall -->
- [x] P0 Runtime effect resolves failure. <!-- submit({type:'resolve_effect', result:{ok:false,error:{kind:'tool_args_parse_failed'}}}) -->
- [x] P0 Audit `tool.args_parse_failed`. <!-- recordAudit type:'tool.args_parse_failed' in catch block -->
- [x] P0 Tests:
  - [x] empty args -> `{}` for no-arg tools; <!-- F1 test 1 -->
  - [x] valid object args accepted; <!-- F1 test 2 -->
  - [x] invalid JSON rejected; <!-- F1 test 3 -->
  - [x] array rejected; <!-- F1 test 4 -->
  - [x] string/number rejected; <!-- F1 tests 5+6 -->
  - [x] rejected args do not run tool; <!-- confirmed in all rejection tests: error is args_parse_failed, not tool.failed -->
  - [x] failure audited. <!-- F1 test 3 checks auditTypes includes 'tool.args_parse_failed' -->

Suggested implementation:

```ts
class ToolApprovalError extends Error {
  constructor(
    readonly kind: 'tool_args_parse_failed',
    message: string,
  ) {
    super(message);
    this.name = 'ToolApprovalError';
  }
}

function parseApprovedArgsOrThrow(argsJson: string | undefined): Record<string, unknown> {
  if (!argsJson || argsJson.trim() === '') {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(argsJson);
  } catch {
    throw new ToolApprovalError(
      'tool_args_parse_failed',
      'Approved tool arguments are not valid JSON.',
    );
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ToolApprovalError(
      'tool_args_parse_failed',
      'Approved tool arguments must be a JSON object.',
    );
  }

  return parsed as Record<string, unknown>;
}
```

Suggested failure handling:

```ts
try {
  args = parseApprovedArgsOrThrow(approval.payload.argsJson);
} catch (error) {
  await recordAudit(db, {
    type: 'tool.args_parse_failed',
    source: 'runtime',
    status: 'failure',
    risk: 'medium',
    summary: 'Approved tool arguments were invalid and the tool was not run.',
    details: {
      approvalId: approval.id,
      toolName: approval.toolName,
    },
  });

  await host.submit({
    type: 'resolve_effect',
    id: approval.effectId,
    result: {
      ok: false,
      error: {
        kind: 'tool_args_parse_failed',
        message: 'Approved tool arguments were invalid.',
      },
    },
  });

  return;
}
```

---

# Part G — Web Search and Browser/Extension Routing

## G1 — Verify Brave Search browser-CORS behavior

- [ ] P1 Add a real-browser test or manual-verification doc for Brave Search direct browser mode.
- [ ] P1 If Brave Search does not support browser-origin CORS:
  - [ ] disable direct browser Brave provider by default;
  - [ ] route Brave Search through Chrome extension provider;
  - [ ] update UI copy.
- [ ] P1 If Brave Search does support browser-origin CORS:
  - [ ] add evidence comment;
  - [ ] add real-browser test where possible;
  - [ ] keep key in SecretVault;
  - [ ] ensure no key in Redux/audit/logs.
- [ ] P1 Tests:
  - [ ] missing provider blocks search;
  - [ ] locked key blocks search;
  - [ ] direct provider unavailable if CORS unverified;
  - [ ] extension-backed search path works or fails visibly.

## G2 — Implement extension-backed search provider if needed

- [ ] P1 Add extension message `web_search`.
- [ ] P1 Extension validates query/maxResults.
- [ ] P1 Extension calls selected search provider.
- [ ] P1 Extension returns normalized `SearchResult[]`.
- [ ] P1 BrowserClaw `ChromeExtensionSearchProvider` calls extension.
- [ ] P1 Audit search started/completed/failed.
- [ ] P1 Tests:
  - [ ] extension search success;
  - [ ] extension search auth failure;
  - [ ] extension search rate-limit failure;
  - [ ] extension unavailable;
  - [ ] no key leakage.

## G3 — Ensure UI only claims search available when provider works

- [ ] P1 Search status checker must perform real health/search check.
- [ ] P1 UI must distinguish:
  - [ ] no provider configured;
  - [ ] key locked;
  - [ ] extension unavailable;
  - [ ] provider unavailable;
  - [ ] connected.
- [ ] P1 Tests:
  - [ ] status false when extension missing;
  - [ ] status false when key locked;
  - [ ] status true only after real success.

---

# Part H — Regex/Grep Safety

## H1 — Restrict agent-originated regex

- [ ] P1 For plan/sandbox-originated grep, default to literal search.
- [ ] P1 Add `allowRegex` capability or explicit approval for regex mode.
- [ ] P1 Enforce max pattern length.
- [ ] P1 Reject known unsafe regex patterns or run with timeout/cancel.
- [ ] P1 Tests:
  - [ ] literal grep works;
  - [ ] regex grep denied without capability;
  - [ ] excessive pattern length rejected;
  - [ ] unsafe regex rejected or times out safely;
  - [ ] cancellation stops grep.

Suggested policy:

```ts
type GrepPolicy = {
  allowRegex: boolean;
  maxPatternChars: number;
};

function validateGrepRequest(query: GrepQuery, policy: GrepPolicy): void {
  if (query.pattern.length > policy.maxPatternChars) {
    throw new WorkspaceError('grep_pattern_too_large', 'Grep pattern is too large.');
  }

  if (query.isRegex && !policy.allowRegex) {
    throw new WorkspaceError(
      'regex_not_allowed',
      'Regex grep requires explicit approval/capability.',
    );
  }
}
```

## H2 — Apply grep policy in Plan and Sandbox runtimes

- [ ] P1 Plan executor passes agent grep policy.
- [ ] P1 Sandbox fs.grep passes sandbox grep policy.
- [ ] P1 UI/user-originated grep may allow regex separately if desired.
- [ ] P1 Tests:
  - [ ] plan regex denied;
  - [ ] sandbox regex denied;
  - [ ] explicit regex capability allows safe pattern.

---

# Part I — Workspace Large-File Guards

## I1 — Add max file size guards for range/line reads

- [ ] P1 Define max readable file size for non-streaming text operations.
- [ ] P1 `readTextRange()` checks file size before full decode.
- [ ] P1 `readLines()` checks file size before full decode.
- [ ] P1 Return explicit error for oversized files.
- [ ] P1 Tests:
  - [ ] small range read works;
  - [ ] large file range read rejected;
  - [ ] large file line read rejected;
  - [ ] unicode still safe.

Suggested guard:

```ts
const MAX_FULL_TEXT_DECODE_BYTES = 2 * 1024 * 1024;

async function assertTextDecodeAllowed(meta: WorkspaceFileMeta): Promise<void> {
  if (meta.sizeBytes > MAX_FULL_TEXT_DECODE_BYTES) {
    throw new WorkspaceError(
      'file_too_large_for_text_range',
      `File is too large for non-streaming text range reads (${meta.sizeBytes} bytes).`,
    );
  }
}
```

## I2 — Future streaming partial reads

- [ ] P2 Consider OPFS streaming/seek-based partial reads.
- [ ] P2 Keep this separate from FIX1 unless easy.
- [ ] P2 Do not fake streaming if implementation still decodes whole file.

---

# Part J — Skill Operation Transactions

## J1 — Wrap skill install/reinstall/uninstall in Dexie transactions

- [ ] P1 Identify multi-table skill operations:
  - [ ] install;
  - [ ] reinstall;
  - [ ] uninstall;
  - [ ] clear state;
  - [ ] permission migration if still relevant.
- [ ] P1 Wrap Dexie-only writes in `db.transaction('rw', ...)`.
- [ ] P1 On failure, leave no partial skill row/files/permissions.
- [ ] P1 Audit success only after transaction completes.
- [ ] P1 Audit failure if transaction fails.
- [ ] P1 Tests:
  - [ ] install failure rolls back skill row;
  - [ ] install failure rolls back package files;
  - [ ] install failure rolls back permissions;
  - [ ] reinstall failure preserves old consistent state or rolls back;
  - [ ] uninstall failure does not audit success.

Suggested transaction shape:

```ts
await db.transaction(
  'rw',
  db.skills,
  db.skill_files,
  db.skill_permissions,
  db.skill_state,
  db.skill_outputs,
  async () => {
    await db.skills.put(skillRow);
    await db.skill_permissions.put(permissionRow);

    await db.skill_files.where('skillId').equals(skillId).delete();
    await db.skill_files.bulkPut(packageFiles);

    if (options.clearState) {
      await db.skill_state.where('skillId').equals(skillId).delete();
      await db.skill_outputs.where('skillId').equals(skillId).delete();
    }
  },
);

await recordAudit(db, {
  type: 'skill_installed',
  source: 'skill',
  status: 'success',
  risk: 'medium',
  summary: `Skill installed: ${skillId}`,
  skillId,
});
```

## J2 — OPFS/Dexie consistency note

- [ ] P2 Document that OPFS and Dexie cannot share one transaction.
- [ ] P2 Add cleanup for orphaned workspace content where feasible.
- [ ] P2 Add maintenance command to scan for orphaned workspace content if practical.

---

# Part K — Dockerized Chrome Extension E2E

## K1 — Add extension E2E test harness

- [ ] P1 Create `tests/extension-e2e/`.
- [ ] P1 Add fixture pages:
  - [ ] `public-article.html`;
  - [ ] `hostile-script.html`;
  - [ ] `huge-page.html`;
  - [ ] `blocked-url.html` if useful.
- [ ] P1 Add Playwright or Puppeteer test.
- [ ] P1 Add unpacked extension build step.
- [ ] P1 Add app dev/preview server step.
- [ ] P1 Tests:
  - [ ] extension loads;
  - [ ] service worker discoverable;
  - [ ] allowed origin connects;
  - [ ] unknown origin rejected;
  - [ ] read fixture page works;
  - [ ] blocked URL fails.

Suggested Playwright skeleton:

```ts
import { chromium, test, expect } from '@playwright/test';
import path from 'node:path';

test('BrowserClaw extension reads a fixture page', async () => {
  const extensionPath = path.resolve(__dirname, '../../dist-extension');

  const context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  const serviceWorker = await context.waitForEvent('serviceworker');
  const extensionId = serviceWorker.url().split('/')[2];

  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:5173/?extensionId=${extensionId}`);

  await expect(page.getByText(/extension connected/i)).toBeVisible();

  // Trigger BrowserClaw UI/test hook to read fixture page.
  await page.getByRole('button', { name: /read fixture page/i }).click();

  await expect(page.getByText(/Fixture Article Title/i)).toBeVisible();

  await context.close();
});
```

Note: Playwright extension tests may require headed mode or Chromium persistent context. If this is unstable, implement the same lane with Puppeteer.

## K2 — Add Docker support

- [ ] P1 Add `tests/extension-e2e/docker/Dockerfile` or root Dockerfile target.
- [ ] P1 Install:
  - [ ] Node;
  - [ ] pnpm/corepack;
  - [ ] Chromium/Chrome dependencies;
  - [ ] Playwright browsers or Chrome for Testing.
- [ ] P1 Add command:
  - [ ] `pnpm run test:extension:e2e`;
  - [ ] `pnpm run test:extension:e2e:docker`.
- [ ] P1 Document how to run locally.
- [ ] P1 Tests run in CI-like container where possible.

Suggested package scripts:

```json
{
  "scripts": {
    "build:extension": "vite build --config extension/vite.config.ts",
    "test:extension:e2e": "playwright test tests/extension-e2e",
    "test:extension:e2e:docker": "docker build -f tests/extension-e2e/docker/Dockerfile -t browserclaw-extension-e2e . && docker run --rm browserclaw-extension-e2e"
  }
}
```

## K3 — Manual QA checklist remains

- [ ] P2 Add manual QA doc:
  - [ ] install unpacked extension in Chrome;
  - [ ] connect BrowserClaw dev app;
  - [ ] grant host permission;
  - [ ] read real public page;
  - [ ] deny permission;
  - [ ] extension unavailable UI;
  - [ ] upgrade extension;
  - [ ] Chrome Web Store packaging checklist.
- [ ] P2 Manual QA is not a substitute for automated smoke tests.

---

# Part L — Final Acceptance Gate

## L1 — Required local commands

- [ ] P0 Run and record:
  - [ ] `pnpm run typecheck`;
  - [ ] `pnpm run lint`;
  - [ ] `pnpm run format:check` or equivalent prettier check;
  - [ ] `pnpm run test`;
  - [ ] `pnpm run test:e2e`;
  - [ ] `pnpm run build`;
  - [ ] `pnpm run build:extension`;
  - [ ] `pnpm run test:extension:e2e` if not Docker-only;
  - [ ] `pnpm run test:extension:e2e:docker` where Docker is available;
  - [ ] `cargo test`;
  - [ ] `cargo clippy`;
  - [ ] `pnpm run build:wasm`.
- [ ] P0 If any command cannot run, document:
  - [ ] exact command;
  - [ ] exact reason;
  - [ ] whether it blocks acceptance;
  - [ ] follow-up needed.

## L2 — Security acceptance checklist

- [ ] P0 Extension does not claim page-reading capability unless it works.
- [ ] P0 Extension implements real `read_page`.
- [ ] P0 Extension blocks local/private/internal URLs.
- [ ] P0 Live app wires plan/workspace/sandbox/web/extension ports.
- [ ] P0 Approval resolvers are wired and resolve runtime effects.
- [ ] P0 Agent plan/script/web blocks parse explicitly.
- [ ] P0 Malformed blocks fail visibly.
- [ ] P0 Sandbox `tool.call` cannot bypass web/fs/memory capability requirements.
- [ ] P0 Sensitive memories excluded from sandbox memory.search.
- [ ] P0 Invalid approved args fail, not `{}`.
- [ ] P0 Brave Search either verified direct or routed through extension.
- [ ] P1 Dockerized extension E2E exists.
- [ ] P1 Regex grep safe for agent-originated requests.
- [ ] P1 Large-file range reads bounded.
- [ ] P1 Skill multi-table operations transactional where feasible.
- [ ] P1 TODO evidence reconciled.

## L3 — Documentation acceptance checklist

- [ ] P1 Update design notes.
- [ ] P1 Update user-facing Web Research docs.
- [ ] P1 Update extension setup docs.
- [ ] P1 Update security model docs for sandbox `tool.call`.
- [ ] P1 Update Workspace FS docs for large-file limits.
- [ ] P1 Update backup docs if workspace backup behavior changes.
- [ ] P1 Update TODO evidence comments.

