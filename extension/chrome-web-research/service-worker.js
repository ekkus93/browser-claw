/**
 * BrowserClaw Web Research Companion — MV3 background service worker.
 *
 * Accepts messages ONLY from the allowed BrowserClaw origins (enforced by the
 * manifest's `externally_connectable` plus a defensive sender check). v0.1
 * handles `ping` / `get_status`; `read_page` / `read_current_tab` land in E7.
 * It is read-only and never reads cookies, fills forms, or runs page scripts.
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

function handle(message) {
  if (!message || typeof message.type !== 'string') {
    return {
      ok: false,
      error: { kind: 'internal_error', message: 'bad message' },
    };
  }
  switch (message.type) {
    case 'ping':
      return { ok: true, requestId: message.requestId, type: 'pong' };
    case 'get_status':
      return {
        ok: true,
        requestId: message.requestId,
        protocolVersion: PROTOCOL_VERSION,
        version: EXTENSION_VERSION,
        pageReadingAvailable: true,
      };
    default:
      return {
        ok: false,
        requestId: message.requestId,
        error: {
          kind: 'unsupported',
          message: `unknown message type: ${message.type}`,
        },
      };
  }
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

export { handle, isAllowedSender, ALLOWED_ORIGINS, PROTOCOL_VERSION };
