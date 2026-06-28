/**
 * BrowserClaw Web Research Companion — MV3 background service worker.
 *
 * Accepts messages ONLY from the allowed BrowserClaw origins (enforced by the
 * manifest's `externally_connectable` plus a defensive sender check). Handles:
 *   ping / get_status  (v0.1 — implemented)
 *   read_page          (FIX1-A3 — stub: undefined)
 *   read_current_tab   (FIX1-A4 — stub: undefined)
 *
 * get_status reports capabilities truthfully: pageReadingAvailable is false
 * until read_page is wired into the handlers object. It is read-only and never
 * reads cookies, fills forms, or runs page scripts.
 *
 * Protocol mirrors src/extension/protocol.ts (the BrowserClaw-side copy).
 */

const PROTOCOL_VERSION = 1;
const EXTENSION_VERSION = '0.1.0';

// Allowed message origins. Kept in sync with manifest externally_connectable;
// the production origin is appended at release time.
const ALLOWED_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];

function isAllowedSender(sender) {
  const url = sender && sender.url ? sender.url : '';
  return ALLOWED_ORIGINS.some((origin) => url.startsWith(origin + '/'));
}

function handlePing(message) {
  return { ok: true, requestId: message.requestId, type: 'pong' };
}

function handleGetStatus(message) {
  const readPage = typeof handlers.read_page === 'function';
  const readCurrentTab = typeof handlers.read_current_tab === 'function';
  const requestHostPermission =
    typeof handlers.request_host_permission === 'function';
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
    },
    pageReadingAvailable: readPage,
    currentTabReadingAvailable: readCurrentTab,
  };
}

/**
 * Handler registry. Add entries here when implementing new capabilities.
 * get_status inspects this object to report truthful capability flags:
 *   pageReadingAvailable        = typeof handlers.read_page === 'function'
 *   currentTabReadingAvailable  = typeof handlers.read_current_tab === 'function'
 */
const handlers = {
  ping: handlePing,
  get_status: handleGetStatus,
  // FIX1-A3: read_page will be added here when implemented.
  read_page: undefined,
  // FIX1-A4: read_current_tab will be added here when implemented.
  read_current_tab: undefined,
  // FIX1-A3: request_host_permission will be added here when implemented.
  request_host_permission: undefined,
};

function handle(message) {
  if (!message || typeof message.type !== 'string') {
    return {
      ok: false,
      error: { kind: 'internal_error', message: 'bad message' },
    };
  }
  const handler = handlers[message.type];
  if (typeof handler !== 'function') {
    return {
      ok: false,
      requestId: message.requestId,
      error: {
        kind: 'unsupported',
        message: `unknown message type: ${message.type}`,
      },
    };
  }
  return handler(message);
}

// This file runs in the extension's service-worker context, where `chrome` is a
// browser-provided global (the extension is a separate build target, not part of
// the app's TypeScript/lint program).
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
      sendResponse(handle(message));
      return false;
    },
  );
}

export { handle, handleGetStatus, handlers, isAllowedSender, ALLOWED_ORIGINS, PROTOCOL_VERSION, EXTENSION_VERSION };
