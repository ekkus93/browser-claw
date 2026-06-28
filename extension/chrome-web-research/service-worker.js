/**
 * BrowserClaw Web Research Companion — MV3 background service worker.
 *
 * Accepts messages ONLY from the allowed BrowserClaw origins (enforced by the
 * manifest's `externally_connectable` plus a defensive sender check). Handles:
 *   ping / get_status        (v0.1 — implemented)
 *   read_page                (FIX1-A3 — implemented; requires chrome.tabs/scripting)
 *   read_current_tab         (FIX1-A4 — stub: undefined)
 *   request_host_permission  (stub: undefined)
 *
 * get_status reports capabilities truthfully: pageReadingAvailable is true
 * when read_page is wired in the handlers object. It is read-only and never
 * reads cookies, fills forms, or runs page scripts.
 *
 * Protocol mirrors src/extension/protocol.ts (the BrowserClaw-side copy).
 */

const PROTOCOL_VERSION = 1;
const EXTENSION_VERSION = '0.1.0';
const DEFAULT_MAX_CHARS = 50_000;
const DEFAULT_TIMEOUT_MS = 15_000;

// Allowed message origins. Kept in sync with manifest externally_connectable;
// the production origin is appended at release time.
const ALLOWED_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];

function isAllowedSender(sender) {
  const url = sender && sender.url ? sender.url : '';
  return ALLOWED_ORIGINS.some((origin) => url.startsWith(origin + '/'));
}

// ---------------------------------------------------------------------------
// URL safety (mirrors src/net/urlSafety.ts; duplicated since the extension
// is a separate plain-JS build target with no module imports from the app).
// ---------------------------------------------------------------------------

function parseIpv4Octets(host) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const octets = [+m[1], +m[2], +m[3], +m[4]];
  if (octets.some((o) => o > 255)) return null;
  return octets;
}

function isBlockedIpv4(host) {
  const ip = parseIpv4Octets(host);
  if (!ip) return false;
  const [a, b] = ip;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

function isBlockedIpv6(rawHost) {
  let host = rawHost.toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  const zone = host.indexOf('%');
  if (zone !== -1) host = host.slice(0, zone);
  if (!host.includes(':')) return false;
  if (host === '::1' || host === '::') return true;
  const mapped = /^::ffff:(.+)$/.exec(host);
  if (mapped && mapped[1]) {
    const rest = mapped[1];
    if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(rest))
      return isBlockedIpv4(rest);
    const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(rest);
    if (hex && hex[1] && hex[2]) {
      const hi = parseInt(hex[1], 16);
      const lo = parseInt(hex[2], 16);
      return isBlockedIpv4(
        `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`,
      );
    }
    return true;
  }
  return /^fe[89ab]/.test(host) || /^f[cd]/.test(host) || /^ff/.test(host);
}

function classifyExtensionUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'Invalid URL.' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: 'Only http(s) URLs are allowed.' };
  }
  const h = url.hostname.toLowerCase();
  if (
    h.length === 0 ||
    h === 'localhost' ||
    h.endsWith('.localhost') ||
    h.endsWith('.local') ||
    isBlockedIpv4(h) ||
    isBlockedIpv6(url.hostname)
  ) {
    return { ok: false, reason: `Blocked host: ${url.hostname}` };
  }
  return { ok: true, url };
}

// ---------------------------------------------------------------------------
// Host permission helpers (real chrome.permissions — browser-only)
// ---------------------------------------------------------------------------

async function hasHostPermission(rawUrl) {
  const parsed = classifyExtensionUrl(rawUrl);
  if (!parsed.ok) return false;
  const pattern = `${parsed.url.protocol}//${parsed.url.host}/*`;
  return chrome.permissions.contains({ origins: [pattern] });
}

async function requestHostPermissionForUrl(rawUrl) {
  const parsed = classifyExtensionUrl(rawUrl);
  if (!parsed.ok) return false;
  const pattern = `${parsed.url.protocol}//${parsed.url.host}/*`;
  return chrome.permissions.request({ origins: [pattern] });
}

// ---------------------------------------------------------------------------
// Tab lifecycle helpers
// ---------------------------------------------------------------------------

function waitForTabComplete(tabId, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('page_load_timeout'));
    }, timeoutMs);

    function listener(id, info) {
      if (id === tabId && info.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

// ---------------------------------------------------------------------------
// Content extraction — injected into the target page via executeScript func:
// This function runs in the page context (no app globals available).
// ---------------------------------------------------------------------------

function extractPageContent({ maxChars }) {
  try {
    const STRIP =
      'script,style,noscript,template,iframe,svg,canvas,object,embed';
    const clone = document.documentElement.cloneNode(true);
    clone.querySelectorAll(STRIP).forEach((el) => el.remove());

    const ogTitle = document.querySelector('meta[property="og:title"]');
    const title =
      (ogTitle && ogTitle.getAttribute('content')) ||
      (document.querySelector('title') &&
        document.querySelector('title').textContent.trim()) ||
      (document.querySelector('h1') &&
        document.querySelector('h1').textContent.trim()) ||
      '';

    const ogSite = document.querySelector('meta[property="og:site_name"]');
    const siteName = (ogSite && ogSite.getAttribute('content')) || '';

    const raw = (clone.textContent || '').replace(/\s+/g, ' ').trim();
    const text = raw.slice(0, maxChars);

    return {
      ok: true,
      finalUrl: location.href,
      title,
      ...(siteName ? { siteName } : {}),
      text,
      markdown: text,
      excerpt: text.slice(0, 280),
      length: text.length,
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

// ---------------------------------------------------------------------------
// read_page handler
// ---------------------------------------------------------------------------

async function handleReadPage(message) {
  const { requestId, url, format: _format, maxChars, timeoutMs } = message;

  if (typeof url !== 'string' || url.length === 0) {
    return errorResponse(
      'invalid_request',
      'read_page requires a url string',
      requestId,
    );
  }

  const safety = classifyExtensionUrl(url);
  if (!safety.ok) {
    return errorResponse('url_blocked', safety.reason, requestId);
  }

  const hasPerm = await hasHostPermission(url);
  if (!hasPerm) {
    const granted = await requestHostPermissionForUrl(url).catch(() => false);
    if (!granted) {
      return errorResponse(
        'host_permission_missing',
        `Host permission not granted for ${safety.url.host}`,
        requestId,
      );
    }
  }

  let tabId;
  try {
    const tab = await chrome.tabs.create({ url, active: false });
    tabId = tab.id;
    if (tabId === undefined || tabId === null) {
      return errorResponse(
        'tab_create_failed',
        'Chrome did not return a tab id',
        requestId,
      );
    }

    await waitForTabComplete(tabId, timeoutMs ?? DEFAULT_TIMEOUT_MS);

    const [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      func: extractPageContent,
      args: [{ maxChars: maxChars ?? DEFAULT_MAX_CHARS }],
    });

    const result = injection && injection.result;
    if (!result || !result.ok) {
      return errorResponse(
        'extraction_failed',
        (result && result.error) || 'Could not extract readable page content',
        requestId,
      );
    }

    return {
      ok: true,
      requestId,
      url,
      finalUrl: result.finalUrl,
      title: result.title,
      ...(result.siteName ? { siteName: result.siteName } : {}),
      text: result.text,
      markdown: result.markdown,
      excerpt: result.excerpt,
      length: result.length,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === 'page_load_timeout') {
      return errorResponse(
        'page_load_timeout',
        'Page did not finish loading in time',
        requestId,
        true,
      );
    }
    return errorResponse('internal_error', msg, requestId);
  } finally {
    if (tabId !== undefined && tabId !== null) {
      chrome.tabs.remove(tabId).catch(() => undefined);
    }
  }
}

// ---------------------------------------------------------------------------
// read_current_tab handler (FIX1-A4)
// ---------------------------------------------------------------------------

async function handleReadCurrentTab(message) {
  const { requestId, maxChars, timeoutMs: _timeoutMs } = message;

  let tabs;
  try {
    tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch (e) {
    return errorResponse(
      'internal_error',
      'Could not query active tab',
      requestId,
    );
  }

  const tab = tabs && tabs[0];
  if (!tab || tab.id === undefined || tab.id === null) {
    return errorResponse('internal_error', 'No active tab found', requestId);
  }

  const tabUrl = tab.url || tab.pendingUrl || '';
  if (tabUrl) {
    const safety = classifyExtensionUrl(tabUrl);
    if (!safety.ok) {
      return errorResponse('url_blocked', safety.reason, requestId);
    }
  }

  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractPageContent,
      args: [{ maxChars: maxChars ?? DEFAULT_MAX_CHARS }],
    });

    const result = injection && injection.result;
    if (!result || !result.ok) {
      return errorResponse(
        'extraction_failed',
        (result && result.error) || 'Could not extract readable page content',
        requestId,
      );
    }

    return {
      ok: true,
      requestId,
      url: tabUrl,
      finalUrl: result.finalUrl,
      title: result.title,
      ...(result.siteName ? { siteName: result.siteName } : {}),
      text: result.text,
      markdown: result.markdown,
      excerpt: result.excerpt,
      length: result.length,
    };
  } catch (e) {
    return errorResponse(
      'script_injection_failed',
      e instanceof Error ? e.message : String(e),
      requestId,
    );
  }
}

// ---------------------------------------------------------------------------
// Core message handlers
// ---------------------------------------------------------------------------

function handlePing(message) {
  return { ok: true, requestId: message.requestId, type: 'pong' };
}

function handleGetStatus(message) {
  const readPage = typeof handlers.read_page === 'function';
  const readCurrentTab = typeof handlers.read_current_tab === 'function';
  const requestHostPermission =
    typeof handlers.request_host_permission === 'function';
  const webSearch = typeof handlers.web_search === 'function';
  return {
    ok: true,
    requestId: message.requestId,
    protocolVersion: PROTOCOL_VERSION,
    extensionVersion: EXTENSION_VERSION,
    capabilities: {
      ping: true,
      getStatus: true,
      readPage,
      readCurrentTab,
      requestHostPermission,
      webSearch,
    },
    pageReadingAvailable: readPage,
    currentTabReadingAvailable: readCurrentTab,
    webSearchAvailable: webSearch,
  };
}

// ---------------------------------------------------------------------------
// FIX1-G2 — web_search handler
// The extension acts as a CORS-bypassing intermediary: the app forwards the
// API key from SecretVault in-memory; the key is used for this request only
// and is never logged, stored, or included in the response.
// ---------------------------------------------------------------------------

const BRAVE_SEARCH_URL_SW = 'https://api.search.brave.com/res/v1/web/search';
const SEARCH_MAX_RESULTS = 20;

async function handleWebSearch(message) {
  const { requestId, query, apiKey, maxResults } = message;

  if (typeof query !== 'string' || query.trim().length === 0) {
    return errorResponse(
      'invalid_request',
      'web_search: query must be a non-empty string',
      requestId,
    );
  }

  const count = Math.min(
    typeof maxResults === 'number' && maxResults > 0 ? maxResults : 10,
    SEARCH_MAX_RESULTS,
  );

  if (typeof apiKey !== 'string' || apiKey.trim().length === 0) {
    return errorResponse(
      'permission_denied',
      'web_search: no API key provided',
      requestId,
    );
  }

  const url = `${BRAVE_SEARCH_URL_SW}?q=${encodeURIComponent(query)}&count=${String(count)}`;

  let response;
  try {
    response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'X-Subscription-Token': apiKey,
      },
    });
  } catch (e) {
    return errorResponse(
      'internal_error',
      `web_search network error: ${e instanceof Error ? e.message : 'unknown'}`,
      requestId,
      true,
    );
  }

  if (!response.ok) {
    const kind =
      response.status === 401 || response.status === 403
        ? 'permission_denied'
        : response.status === 429
          ? 'internal_error'
          : 'internal_error';
    return errorResponse(
      kind,
      `web_search: provider returned ${response.status}`,
      requestId,
      response.status === 429 || response.status >= 500,
    );
  }

  let body;
  try {
    body = await response.json();
  } catch {
    return errorResponse(
      'internal_error',
      'web_search: invalid JSON from provider',
      requestId,
    );
  }

  const web = body && typeof body === 'object' ? body.web : null;
  const items = Array.isArray(web?.results) ? web.results : [];
  const results = items
    .map((r, i) =>
      typeof r?.url === 'string'
        ? {
            title: typeof r.title === 'string' ? r.title : r.url,
            url: r.url,
            ...(typeof r.description === 'string'
              ? { snippet: r.description }
              : {}),
            rank: i + 1,
          }
        : null,
    )
    .filter(Boolean);

  return { ok: true, requestId, results };
}

/**
 * Handler registry. get_status inspects typeof entries to report truthful
 * capability flags. Add entries here to enable new capabilities.
 */
const handlers = {
  ping: handlePing,
  get_status: handleGetStatus,
  read_page: handleReadPage, // FIX1-A3
  read_current_tab: handleReadCurrentTab, // FIX1-A4
  request_host_permission: undefined,
  web_search: handleWebSearch, // FIX1-G2
};

// ---------------------------------------------------------------------------
// Request routing and validation
// ---------------------------------------------------------------------------

/**
 * Build a structured error response. `retryable` defaults to false; set true
 * for transient failures the caller may safely retry.
 */
function errorResponse(kind, message, requestId, retryable = false) {
  return {
    ok: false,
    ...(requestId !== undefined ? { requestId } : {}),
    error: { kind, message, retryable },
  };
}

function handle(message) {
  if (!message || typeof message !== 'object') {
    return errorResponse('internal_error', 'message must be an object');
  }
  if (typeof message.type !== 'string' || message.type.length === 0) {
    return errorResponse(
      'invalid_request',
      'message type must be a non-empty string',
      message.requestId,
    );
  }
  if (typeof message.requestId !== 'string' || message.requestId.length === 0) {
    return errorResponse(
      'invalid_request',
      'message requestId must be a non-empty string',
      undefined,
    );
  }
  const handler = handlers[message.type];
  if (typeof handler !== 'function') {
    return errorResponse(
      'unsupported_message_type',
      `unknown message type: ${message.type}`,
      message.requestId,
    );
  }
  return handler(message);
}

// ---------------------------------------------------------------------------
// Message listener (browser-only; skipped in unit-test environments)
// ---------------------------------------------------------------------------

if (typeof chrome !== 'undefined' && chrome.runtime?.onMessageExternal) {
  chrome.runtime.onMessageExternal.addListener(
    (message, sender, sendResponse) => {
      if (!isAllowedSender(sender)) {
        sendResponse({
          ok: false,
          error: { kind: 'forbidden', message: 'origin not allowed' },
        });
        return false;
      }
      // handleReadPage is async; for async handlers return true and resolve later.
      const handler = handlers[message && message.type];
      if (handler && handler.constructor.name === 'AsyncFunction') {
        handler(message).then(sendResponse);
        return true;
      }
      sendResponse(handle(message));
      return false;
    },
  );
}

export {
  handle,
  handleReadPage,
  handleReadCurrentTab,
  handleGetStatus,
  handlers,
  isAllowedSender,
  errorResponse,
  classifyExtensionUrl,
  ALLOWED_ORIGINS,
  PROTOCOL_VERSION,
  EXTENSION_VERSION,
};
