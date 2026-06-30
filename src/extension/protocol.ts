/**
 * Extension message protocol (Part E6). The strict, versioned contract between
 * BrowserClaw and the Web Research Companion. Every message carries a
 * `requestId`; requests and responses are validated on BOTH sides; messages from
 * non-BrowserClaw origins are rejected. These are pure shapes + validators (the
 * BrowserClaw side); the extension's service worker mirrors them.
 */

import type { ReadFormat } from '../webresearch/types.ts';

export const EXTENSION_PROTOCOL_VERSION = 1;

export type ExtensionRequest =
  | { type: 'ping'; requestId: string }
  | { type: 'get_status'; requestId: string }
  | {
      type: 'read_page';
      requestId: string;
      url: string;
      format?: ReadFormat;
      maxChars?: number;
      timeoutMs?: number;
    }
  | {
      type: 'read_pages';
      requestId: string;
      urls: string[];
      format?: ReadFormat;
      maxChars?: number;
      timeoutMs?: number;
      maxPages?: number;
    }
  | {
      type: 'read_current_tab';
      requestId: string;
      format?: ReadFormat;
      maxChars?: number;
    }
  | { type: 'request_host_permission'; requestId: string; origin: string }
  | {
      type: 'web_search';
      requestId: string;
      query: string;
      /** Optional API key forwarded from SecretVault; never stored or logged. */
      apiKey?: string;
      maxResults?: number;
    };

export type ExtensionRequestType = ExtensionRequest['type'];

const REQUEST_TYPES: readonly ExtensionRequestType[] = [
  'ping',
  'get_status',
  'read_page',
  'read_pages',
  'read_current_tab',
  'request_host_permission',
  'web_search',
];

export type ExtensionErrorKind =
  // A2 canonical error kinds (used by A3+ service-worker handlers)
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
  | 'internal_error'
  // C2: permission request flow must be done from extension popup (user gesture)
  | 'permission_flow_required'
  // C3: current-tab read unavailable in v0.1 (activeTab not grantable via externally_connectable)
  | 'current_tab_read_unavailable'
  // Legacy kinds (v0.1 service-worker; kept for backward compat)
  | 'timeout'
  | 'navigation_failed'
  | 'unsupported_url'
  | 'extension_missing'
  | 'unsupported'
  | 'forbidden';

export interface ExtensionError {
  kind: ExtensionErrorKind;
  message: string;
  retryable?: boolean;
}

export type ExtensionResponse =
  | { ok: true; requestId: string; [field: string]: unknown }
  | { ok: false; requestId: string; error: ExtensionError };

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

export type RequestParse =
  | { ok: true; request: ExtensionRequest }
  | { ok: false; reason: string };

/** Validate an untrusted message as an {@link ExtensionRequest}. */
export function parseExtensionRequest(message: unknown): RequestParse {
  if (!isObject(message)) return { ok: false, reason: 'not an object' };
  if (typeof message.requestId !== 'string' || message.requestId.length === 0) {
    return { ok: false, reason: 'missing requestId' };
  }
  const type = message.type;
  if (typeof type !== 'string' || !(REQUEST_TYPES as string[]).includes(type)) {
    return { ok: false, reason: `unknown type "${String(type)}"` };
  }
  if (
    (type === 'read_page' || type === 'request_host_permission') &&
    typeof message[type === 'read_page' ? 'url' : 'origin'] !== 'string'
  ) {
    return { ok: false, reason: `${type} requires a string url/origin` };
  }
  // D1 (FIX11): validate read_page.maxChars inline — cap matches service-worker MAX_CHARS.
  if (type === 'read_page') {
    if (
      message.maxChars !== undefined &&
      (typeof message.maxChars !== 'number' ||
        !Number.isInteger(message.maxChars) ||
        message.maxChars < 1 ||
        message.maxChars > 50_000)
    ) {
      return {
        ok: false,
        reason: 'read_page maxChars must be a positive integer ≤ 50000',
      };
    }
  }
  if (type === 'read_pages') {
    const urls = message.urls;
    if (
      !Array.isArray(urls) ||
      !urls.every((u) => typeof u === 'string') ||
      urls.length === 0
    ) {
      return {
        ok: false,
        reason: 'read_pages requires a non-empty string[] urls',
      };
    }
    // D2 (FIX11): validate read_pages.maxChars inline — same cap as read_page.
    if (
      message.maxChars !== undefined &&
      (typeof message.maxChars !== 'number' ||
        !Number.isInteger(message.maxChars) ||
        message.maxChars < 1 ||
        message.maxChars > 50_000)
    ) {
      return {
        ok: false,
        reason: 'read_pages maxChars must be a positive integer ≤ 50000',
      };
    }
  }
  if (type === 'web_search') {
    if (
      typeof message.query !== 'string' ||
      message.query.trim().length === 0
    ) {
      return {
        ok: false,
        reason: 'web_search requires a non-empty string query',
      };
    }
    if (
      message.maxResults !== undefined &&
      (typeof message.maxResults !== 'number' ||
        !Number.isInteger(message.maxResults) ||
        message.maxResults < 1)
    ) {
      return {
        ok: false,
        reason: 'web_search maxResults must be a positive integer',
      };
    }
  }
  return { ok: true, request: message as unknown as ExtensionRequest };
}

/** Validate an untrusted message as an {@link ExtensionResponse}. */
export function isExtensionResponse(
  message: unknown,
): message is ExtensionResponse {
  if (!isObject(message)) return false;
  if (typeof message.requestId !== 'string') return false;
  if (message.ok === true) return true;
  if (message.ok === false) {
    return isObject(message.error) && typeof message.error.kind === 'string';
  }
  return false;
}

/** Reject any message whose sender origin isn't an allowed BrowserClaw origin. */
export function isAllowedSenderUrl(
  senderUrl: string | undefined,
  allowedOrigins: readonly string[],
): boolean {
  if (!senderUrl) return false;
  return allowedOrigins.some((origin) => senderUrl.startsWith(`${origin}/`));
}

let counter = 0;
/** A unique request id. Uses crypto.randomUUID when available, else a counter. */
export function newRequestId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `req_${crypto.randomUUID()}`;
  }
  counter += 1;
  return `req_${counter}`;
}
