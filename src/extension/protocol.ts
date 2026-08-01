/**
 * Extension message protocol. Every message carries a requestId; requests and
 * responses are validated on both sides, and external senders must match an
 * explicitly configured BrowserClaw application URL.
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
  | 'startup_failure'
  | 'permission_flow_required'
  | 'current_tab_read_unavailable'
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

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export type RequestParse =
  | { ok: true; request: ExtensionRequest }
  | { ok: false; reason: string };

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
      !urls.every((url) => typeof url === 'string') ||
      urls.length === 0
    ) {
      return {
        ok: false,
        reason: 'read_pages requires a non-empty string[] urls',
      };
    }
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
    const searchMaxResults = 20;
    if (
      message.maxResults !== undefined &&
      (typeof message.maxResults !== 'number' ||
        !Number.isFinite(message.maxResults) ||
        !Number.isInteger(message.maxResults) ||
        message.maxResults < 1 ||
        message.maxResults > searchMaxResults)
    ) {
      return {
        ok: false,
        reason:
          'web_search maxResults must be a positive integer no greater than 20.',
      };
    }
  }
  return { ok: true, request: message as unknown as ExtensionRequest };
}

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

/**
 * Require exact scheme, host, and port. When an allowed application URL has a
 * path, the sender must be at that path or below it on a segment boundary.
 */
export function isAllowedSenderUrl(
  senderUrl: string | undefined,
  allowedApplicationUrls: readonly string[],
): boolean {
  if (!senderUrl) return false;

  let sender: URL;
  try {
    sender = new URL(senderUrl);
  } catch {
    return false;
  }

  return allowedApplicationUrls.some((allowedUrl) => {
    let allowed: URL;
    try {
      allowed = new URL(allowedUrl);
    } catch {
      return false;
    }
    if (sender.origin !== allowed.origin) return false;

    const allowedPath = allowed.pathname.replace(/\/$/, '');
    if (allowedPath.length === 0) return true;
    return (
      sender.pathname === allowedPath ||
      sender.pathname.startsWith(`${allowedPath}/`)
    );
  });
}

let counter = 0;
export function newRequestId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `req_${crypto.randomUUID()}`;
  }
  counter += 1;
  return `req_${counter}`;
}
