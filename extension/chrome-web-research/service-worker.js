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
// C2 — request_host_permission handler
// Explicit, separate flow for acquiring host permission. read_page no longer
// requests permission opportunistically; callers must send this message first
// when pageReadingAvailable is true but the target URL lacks a permission.
// ---------------------------------------------------------------------------

async function handleRequestHostPermission(message) {
  const { requestId, origin } = message;

  if (typeof origin !== 'string' || origin.length === 0) {
    return errorResponse(
      'invalid_request',
      'request_host_permission requires a non-empty string origin',
      requestId,
    );
  }

  const parsed = classifyExtensionUrl(origin);
  if (!parsed.ok) {
    return errorResponse('url_blocked', parsed.reason, requestId);
  }
  const pattern = `${parsed.url.protocol}//${parsed.url.host}/*`;

  let granted;
  try {
    granted = await chrome.permissions.request({ origins: [pattern] });
  } catch {
    // Chrome throws when called outside a user gesture (requires extension popup).
    return {
      ok: false,
      requestId,
      error: {
        kind: 'permission_flow_required',
        message:
          'Host permission must be granted from the extension action popup.',
        retryable: false,
      },
    };
  }

  if (!granted) {
    return {
      ok: false,
      requestId,
      error: {
        kind: 'permission_denied',
        message: `User denied host permission for ${pattern}.`,
        retryable: false,
      },
    };
  }

  return { ok: true, requestId, origin: pattern };
}

// ---------------------------------------------------------------------------
// Tab lifecycle helpers
// ---------------------------------------------------------------------------

// H1 (FIX4): fixed race — install listener BEFORE checking current tab status
// so a tab that completes while we inspect it isn't missed.
function waitForTabComplete(tabId, timeoutMs) {
  return new Promise((resolve, reject) => {
    let done = false;
    let timeoutId;

    const cleanup = () => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    };

    const finish = (fn, value) => {
      if (done) return;
      done = true;
      cleanup();
      fn(value);
    };

    const onUpdated = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        finish(resolve);
      }
    };

    // Install listener first so we don't miss an update between the get() callback
    // and when we start listening.
    chrome.tabs.onUpdated.addListener(onUpdated);

    chrome.tabs.get(tabId, (tab) => {
      if (done) return;
      if (chrome.runtime.lastError) {
        finish(reject, new Error(chrome.runtime.lastError.message));
        return;
      }
      if (tab?.status === 'complete') {
        finish(resolve);
      }
    });

    timeoutId = setTimeout(() => {
      finish(reject, new Error('page_load_timeout'));
    }, timeoutMs);
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

  // E3 (FIX10): validate maxChars directly — defense-in-depth for callers that
  // bypass central validation (direct handler calls, tests, future refactors).
  const maxCharsDirectError = validateOptionalMaxChars(maxChars);
  if (maxCharsDirectError) {
    return errorResponse('invalid_request', maxCharsDirectError, requestId);
  }

  const safety = classifyExtensionUrl(url);
  if (!safety.ok) {
    return errorResponse('url_blocked', safety.reason, requestId);
  }

  // C2: do not opportunistically request permission here. read_page returns
  // host_permission_missing when permission is absent; the caller must use
  // request_host_permission separately to acquire permission first.
  const hasPerm = await hasHostPermission(url);
  if (!hasPerm) {
    return errorResponse(
      'host_permission_missing',
      `Host permission not granted for ${safety.url.host}`,
      requestId,
    );
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
// read_current_tab handler (FIX1-A4 / C3)
// ---------------------------------------------------------------------------
// C3: current-tab read is not supported in v0.1. The activeTab permission
// requires a direct user gesture (browser action click) to be granted; it is
// not available through the externally_connectable sendMessage path that
// BrowserClaw uses. Scripting also requires host_permissions for the active
// tab's URL, which is the same requirement as read_page — so read_current_tab
// offers no advantage over read_page + explicit URL. This handler returns
// current_tab_read_unavailable immediately; get_status reports supported:false.

function handleReadCurrentTab(message) {
  return errorResponse(
    'current_tab_read_unavailable',
    'Current tab reading is not supported in v0.1. Use read_page with an explicit URL instead.',
    message.requestId,
  );
}

// ---------------------------------------------------------------------------
// read_pages handler (FIX2-B1) — batch variant
// ---------------------------------------------------------------------------

async function handleReadPages(message) {
  const { requestId, urls, maxPages, maxChars } = message;

  // Defense-in-depth: also check here in case handler is called without going
  // through central validation (e.g. tests that call handleReadPages directly).
  if (!Array.isArray(urls) || urls.length === 0) {
    return errorResponse(
      'invalid_request',
      'read_pages: urls must be a non-empty array',
      requestId,
    );
  }

  // D1 (FIX8): validate maxPages directly — defense-in-depth for callers that
  // bypass central validation (direct handler calls, tests, future refactors).
  const maxPagesDirectError = validateOptionalPositiveIntegerLimit(
    maxPages,
    'maxPages',
    READ_PAGES_MAX,
  );
  if (maxPagesDirectError) {
    return errorResponse('invalid_request', maxPagesDirectError, requestId);
  }

  // E3 (FIX10): validate maxChars directly — mirrors maxPages defense-in-depth.
  const maxCharsDirectError = validateOptionalMaxChars(maxChars);
  if (maxCharsDirectError) {
    return errorResponse('invalid_request', maxCharsDirectError, requestId);
  }

  const effectiveMax = typeof maxPages === 'number' ? maxPages : urls.length;
  const limit = Math.min(effectiveMax, READ_PAGES_MAX);

  const results = [];
  for (let i = 0; i < limit; i++) {
    const url = urls[i];
    if (typeof url !== 'string') {
      results.push(
        errorResponse(
          'invalid_request',
          `urls[${i}] is not a string`,
          requestId,
        ),
      );
      continue;
    }
    // Reuse the single-page handler; it carries all safety/permission/tab logic.
    const result = await handleReadPage({
      requestId,
      url,
      maxChars: maxChars ?? DEFAULT_MAX_CHARS,
    });
    results.push(result);
  }

  return { ok: true, requestId, results };
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
    // C1: structured per-capability objects (replaces flat boolean map).
    capabilities: {
      readPage: {
        supported: readPage,
        // MV3 tab reads always require host permission for the target origin.
        requiresHostPermission: true,
        // F1 (FIX4): permissionRequestSupported is false — the handler exists
        // but chrome.permissions.request() requires a direct user gesture
        // (extension popup click); it always throws permission_flow_required
        // when called via the externally_connectable message path. No popup
        // UI exists in v0.1, so the programmatic permission flow is unavailable.
        permissionRequestSupported: false,
      },
      readCurrentTab: {
        // C3/F3 (FIX4): not supported in v0.1 — activeTab is not granted via
        // externally_connectable; scripting needs host_permissions for the
        // target URL (same requirement as read_page). Use read_page instead.
        supported: false,
        requiresActiveTab: true,
      },
      webSearch: {
        supported: webSearch,
        providerConfigured: webSearch,
      },
    },
    // F1 (FIX4): pageReadingAvailable is true if the read_page handler exists;
    // permission flow is separate — pre-granted permissions allow page reads even
    // without a working permission request path. Decoupled from permissionRequestSupported.
    pageReadingAvailable: readPage,
    currentTabReadingAvailable: false,
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
// E1 (FIX11): internal default used when maxResults is omitted; not exported.
const DEFAULT_SEARCH_RESULTS = 10;

async function handleWebSearch(message) {
  const { requestId, query, apiKey, maxResults } = message;

  if (typeof query !== 'string' || query.trim().length === 0) {
    return errorResponse(
      'invalid_request',
      'web_search: query must be a non-empty string',
      requestId,
    );
  }

  // E1 (FIX11): reject invalid maxResults instead of silently defaulting to 10.
  const maxResultsError = validateOptionalMaxResults(maxResults);
  if (maxResultsError) {
    return errorResponse(
      'invalid_request',
      `web_search: ${maxResultsError}`,
      requestId,
    );
  }

  const count = Math.min(
    maxResults !== undefined ? maxResults : DEFAULT_SEARCH_RESULTS,
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
  read_pages: handleReadPages, // FIX2-B1
  request_host_permission: handleRequestHostPermission, // C2
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

// ---------------------------------------------------------------------------
// D2 (FIX3): Central per-message schema validation — runs in handle() before
// the handler body is called. Defense-in-depth; handlers still validate for
// richer error messages, but this gate catches obviously malformed payloads.
// ---------------------------------------------------------------------------

// C1/C2 (FIX7): central validation helpers for read_pages.
const READ_PAGES_MAX = 10;

/**
 * Validate that value is a non-empty array of non-empty strings.
 * Returns an error message string on failure, null on success.
 */
function validateNonEmptyStringArray(value, field) {
  if (!Array.isArray(value) || value.length === 0) {
    return `${field} must be a non-empty array.`;
  }
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    if (typeof item !== 'string' || item.trim().length === 0) {
      return `${field}[${index}] must be a non-empty string.`;
    }
  }
  return null;
}

/**
 * Validate an optional positive integer limit (e.g. maxPages).
 * Returns an error message string on failure, null if valid or absent.
 */
function validateOptionalPositiveIntegerLimit(value, field, max) {
  if (value === undefined) return null;
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < 1
  ) {
    return `${field} must be a positive integer.`;
  }
  if (value > max) {
    return `${field} must be less than or equal to ${max}.`;
  }
  return null;
}

// E1 (FIX10): validate optional maxChars — defense-in-depth at both the central
// schema gate and the direct handler level; mirrors the maxPages pattern.
function validateOptionalMaxChars(value) {
  return validateOptionalPositiveIntegerLimit(
    value,
    'maxChars',
    DEFAULT_MAX_CHARS,
  );
}

// E1 (FIX11): validate optional maxResults — reject invalid values instead of
// silently defaulting to DEFAULT_SEARCH_RESULTS.
function validateOptionalMaxResults(value) {
  return validateOptionalPositiveIntegerLimit(
    value,
    'maxResults',
    SEARCH_MAX_RESULTS,
  );
}

/**
 * Return an invalid_request errorResponse if the message payload is missing
 * required fields, or null if it passes.
 */
function validateMessageSchema(message) {
  const id = message.requestId;
  const type = message.type;

  if (type === 'read_page') {
    if (typeof message.url !== 'string' || message.url.trim().length === 0) {
      return errorResponse(
        'invalid_request',
        'read_page requires a non-empty string url',
        id,
      );
    }
    // E2 (FIX10): validate optional maxChars centrally.
    const maxCharsError = validateOptionalMaxChars(message.maxChars);
    if (maxCharsError) {
      return errorResponse('invalid_request', maxCharsError, id);
    }
  } else if (type === 'read_pages') {
    // C1 (FIX7): per-slot validation in central schema check.
    const urlsError = validateNonEmptyStringArray(message.urls, 'urls');
    if (urlsError) {
      return errorResponse('invalid_request', urlsError, id);
    }
    // C2 (FIX7): validate optional maxPages centrally.
    const maxPagesError = validateOptionalPositiveIntegerLimit(
      message.maxPages,
      'maxPages',
      READ_PAGES_MAX,
    );
    if (maxPagesError) {
      return errorResponse('invalid_request', maxPagesError, id);
    }
    // E2 (FIX10): validate optional maxChars centrally.
    const maxCharsError = validateOptionalMaxChars(message.maxChars);
    if (maxCharsError) {
      return errorResponse('invalid_request', maxCharsError, id);
    }
  } else if (type === 'web_search') {
    if (
      typeof message.query !== 'string' ||
      message.query.trim().length === 0
    ) {
      return errorResponse(
        'invalid_request',
        'web_search requires a non-empty string query',
        id,
      );
    }
    // A1 (FIX13): validate maxResults before apiKey so a malformed request
    // shape returns invalid_request rather than being masked as permission_denied.
    const maxResultsError = validateOptionalMaxResults(message.maxResults);
    if (maxResultsError) {
      return errorResponse('invalid_request', maxResultsError, id);
    }
    if (
      typeof message.apiKey !== 'string' ||
      message.apiKey.trim().length === 0
    ) {
      return errorResponse(
        'permission_denied',
        'web_search requires a non-empty string apiKey',
        id,
      );
    }
  } else if (type === 'request_host_permission') {
    if (
      typeof message.origin !== 'string' ||
      message.origin.trim().length === 0
    ) {
      return errorResponse(
        'invalid_request',
        'request_host_permission requires a non-empty string origin',
        id,
      );
    }
  }
  // read_current_tab, ping, get_status: no required payload fields.
  return null;
}

// D1 (FIX3): handle() is now async so it catches throws from async handlers.
// The listener always routes through here — no handler is ever called directly.
async function handle(message) {
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
  // D2 (FIX3): validate required payload fields before invoking the handler.
  const schemaError = validateMessageSchema(message);
  if (schemaError) return schemaError;
  try {
    return await handler(message);
  } catch (error) {
    return errorResponse(
      'internal_error',
      error instanceof Error ? error.message : String(error),
      message.requestId,
    );
  }
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
      // D1 (FIX3): handle() is now async — always call it and resolve later.
      // This ensures validation runs for all handlers including async ones.
      handle(message).then(sendResponse);
      return true;
    },
  );
}

export {
  handle,
  handleReadPage,
  handleReadCurrentTab,
  handleReadPages,
  handleGetStatus,
  handleRequestHostPermission,
  handlers,
  isAllowedSender,
  errorResponse,
  validateMessageSchema,
  validateOptionalMaxChars,
  validateOptionalMaxResults,
  classifyExtensionUrl,
  extractPageContent,
  ALLOWED_ORIGINS,
  PROTOCOL_VERSION,
  EXTENSION_VERSION,
};
