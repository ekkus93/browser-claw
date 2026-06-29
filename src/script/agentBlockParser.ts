/**
 * Agent output block parser (FIX1-C1 + C2).
 *
 * Parses fenced action blocks from a model reply:
 *   ```tool          — existing tool-call block
 *   ```browserclaw-plan   — structured plan JSON
 *   ```browserclaw-script — sandboxed script request JSON
 *   ```browserclaw-web    — web request (readPage / search) JSON
 *
 * Rules (v0.1):
 *   - Exactly one actionable block per reply. Multiple → malformed.
 *   - Unknown `browserclaw-*` types → malformed (not silently dropped).
 *   - Invalid JSON or schema mismatch → malformed (not ordinary text).
 */

import { validatePlan, type BrowserClawPlan } from './planSchema.ts';
import {
  validateScriptRequest,
  type BrowserClawScriptRequest,
} from './scriptRequest.ts';
import { parseToolCall, type ToolCall } from '../tools/tools.ts';
import { classifyFetchUrl } from '../net/urlSafety.ts';
import {
  MAX_BATCH_PAGE_READS,
  MAX_SEARCH_RESULTS,
  MAX_WEB_PAGE_CHARS,
  normalizeOptionalPositiveIntegerLimit,
  LimitValidationError,
} from '../webresearch/limits.ts';

// ---------------------------------------------------------------------------
// BrowserClawWebRequest (inline — no separate schema file yet)
// ---------------------------------------------------------------------------

const WEB_REQUEST_TYPE = 'browserclaw_web_request';
const WEB_REQUEST_VERSION = 1;
const KNOWN_WEB_OPS = [
  'readPage',
  'search',
  'readCurrentTab',
  'readPages',
  'research',
] as const;
type WebOp = (typeof KNOWN_WEB_OPS)[number];

/** Canonical nested options object on a parsed web request. */
export interface CanonicalWebOptions {
  maxPages?: number;
  maxChars?: number;
  maxResults?: number;
}

export interface BrowserClawWebRequest {
  type: typeof WEB_REQUEST_TYPE;
  version: typeof WEB_REQUEST_VERSION;
  op: WebOp;
  url?: string;
  query?: string;
  urls?: string[];
  /** Canonical normalized options (top-level maxPages/maxChars/maxResults merged here). */
  options?: CanonicalWebOptions;
}

/**
 * Merge top-level convenience fields into a canonical options object.
 * Rejects conflicting top-level/nested values and invalid maxPages.
 */
const KNOWN_WEB_OPTION_FIELDS = new Set(['maxPages', 'maxChars', 'maxResults']);

function canonicalizeWebRequestOptions(
  obj: Record<string, unknown>,
  errors: string[],
): CanonicalWebOptions | undefined {
  if (
    obj.options !== undefined &&
    (obj.options === null ||
      typeof obj.options !== 'object' ||
      Array.isArray(obj.options))
  ) {
    errors.push('options must be a plain object');
    return undefined;
  }

  const rawOptions =
    obj.options !== undefined
      ? (obj.options as Record<string, unknown>)
      : undefined;

  // C3 (FIX9): reject unknown fields in options object.
  if (rawOptions) {
    for (const key of Object.keys(rawOptions)) {
      if (!KNOWN_WEB_OPTION_FIELDS.has(key)) {
        errors.push(`Unknown web request option: options.${key}`);
      }
    }
  }

  function mergeField(field: 'maxPages' | 'maxChars' | 'maxResults'): unknown {
    const top = obj[field];
    const nested = rawOptions?.[field];
    if (top !== undefined && nested !== undefined && top !== nested) {
      errors.push(
        `Conflicting web request option: ${field} set both top-level and in options`,
      );
      return undefined;
    }
    return nested !== undefined ? nested : top;
  }

  function validateField(
    value: unknown,
    field: string,
    max: number,
  ): number | undefined {
    if (value === undefined) return undefined;
    try {
      return normalizeOptionalPositiveIntegerLimit(value, field, { max });
    } catch (err) {
      errors.push(
        err instanceof LimitValidationError
          ? err.message
          : `${field} is invalid: ${String(value)}`,
      );
      return undefined;
    }
  }

  const maxPages = validateField(
    mergeField('maxPages'),
    'maxPages',
    MAX_BATCH_PAGE_READS,
  );
  const maxChars = validateField(
    mergeField('maxChars'),
    'maxChars',
    MAX_WEB_PAGE_CHARS,
  );
  const maxResults = validateField(
    mergeField('maxResults'),
    'maxResults',
    MAX_SEARCH_RESULTS,
  );

  const result: CanonicalWebOptions = {};
  if (maxPages !== undefined) result.maxPages = maxPages;
  if (maxChars !== undefined) result.maxChars = maxChars;
  if (maxResults !== undefined) result.maxResults = maxResults;

  return Object.keys(result).length > 0 ? result : undefined;
}

type WebRequestValidation =
  | { ok: true; request: BrowserClawWebRequest }
  | { ok: false; errors: string[] };

function validateWebRequest(input: unknown): WebRequestValidation {
  if (typeof input !== 'object' || input === null) {
    return { ok: false, errors: ['web request must be an object'] };
  }
  const obj = input as Record<string, unknown>;
  const errors: string[] = [];

  if (obj.type !== WEB_REQUEST_TYPE) {
    errors.push(`type must be "${WEB_REQUEST_TYPE}"`);
  }
  if (obj.version !== WEB_REQUEST_VERSION) {
    errors.push(`version must be ${WEB_REQUEST_VERSION}`);
  }
  if (
    typeof obj.op !== 'string' ||
    !(KNOWN_WEB_OPS as readonly string[]).includes(obj.op)
  ) {
    errors.push(
      `op must be one of: ${KNOWN_WEB_OPS.join(', ')}; got ${String(obj.op)}`,
    );
  }

  if (obj.op === 'readPage') {
    if (typeof obj.url !== 'string' || obj.url.trim() === '') {
      errors.push('readPage requires a non-empty string url');
    } else {
      const safe = classifyFetchUrl(obj.url);
      if (!safe.ok) {
        errors.push(`url is blocked: ${safe.reason}`);
      }
    }
  }

  if (obj.op === 'search') {
    if (typeof obj.query !== 'string' || obj.query.trim() === '') {
      errors.push('search requires a non-empty string query');
    }
  }

  if (obj.op === 'research') {
    if (typeof obj.query !== 'string' || obj.query.trim() === '') {
      errors.push('research requires a non-empty string query');
    }
  }

  if (obj.op === 'readPages') {
    if (!Array.isArray(obj.urls) || obj.urls.length === 0) {
      errors.push('readPages requires a non-empty urls array');
    } else {
      for (let i = 0; i < obj.urls.length; i++) {
        const u = obj.urls[i];
        if (typeof u !== 'string' || u.trim() === '') {
          errors.push(`readPages urls[${i}] must be a non-empty string`);
        } else {
          const safe = classifyFetchUrl(u);
          if (!safe.ok) {
            errors.push(`readPages urls[${i}] is blocked: ${safe.reason}`);
          }
        }
      }
    }
  }

  // A1/A2 (FIX8): normalize top-level limit fields into canonical options and
  // validate maxPages. Must happen after op-specific checks so errors accumulate.
  const canonicalOptions = canonicalizeWebRequestOptions(obj, errors);

  if (errors.length > 0) return { ok: false, errors };

  const request: BrowserClawWebRequest = {
    type: obj.type as typeof WEB_REQUEST_TYPE,
    version: obj.version as typeof WEB_REQUEST_VERSION,
    op: obj.op as WebOp,
    ...(typeof obj.url === 'string' ? { url: obj.url } : {}),
    ...(typeof obj.query === 'string' ? { query: obj.query } : {}),
    ...(Array.isArray(obj.urls) ? { urls: obj.urls as string[] } : {}),
    ...(canonicalOptions ? { options: canonicalOptions } : {}),
  };
  return { ok: true, request };
}

// ---------------------------------------------------------------------------
// Result union
// ---------------------------------------------------------------------------

export type AgentActionParseResult =
  | { kind: 'none'; text: string }
  | { kind: 'tool_call'; call: ToolCall }
  | { kind: 'plan'; plan: BrowserClawPlan }
  | { kind: 'script_request'; request: BrowserClawScriptRequest }
  | { kind: 'web_request'; request: BrowserClawWebRequest }
  | { kind: 'malformed'; blockType: string; message: string };

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

const ACTION_BLOCK_RE =
  /```(tool|browserclaw-plan|browserclaw-script|browserclaw-web|browserclaw-[\w-]+)\s*\n([\s\S]*?)```/g;

export function parseAgentActionBlock(text: string): AgentActionParseResult {
  const matches = [...text.matchAll(ACTION_BLOCK_RE)];

  if (matches.length === 0) {
    return { kind: 'none', text };
  }

  if (matches.length > 1) {
    return {
      kind: 'malformed',
      blockType: 'multiple',
      message: `Expected exactly one actionable block; found ${matches.length}.`,
    };
  }

  // matches.length === 1 at this point (checked above)
  const match = matches[0]!;
  const blockType = match[1] ?? '';
  const rawJson = match[2] ?? '';

  if (blockType === 'tool') {
    const r = parseToolCall(text);
    if (r.kind === 'none') return { kind: 'none', text };
    if (r.kind === 'malformed')
      return { kind: 'malformed', blockType: 'tool', message: r.message };
    return r;
  }

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
    case 'browserclaw-plan': {
      const v = validatePlan(parsed);
      if (!v.ok) {
        return {
          kind: 'malformed',
          blockType,
          message: v.errors.join('; '),
        };
      }
      return { kind: 'plan', plan: v.plan };
    }
    case 'browserclaw-script': {
      const v = validateScriptRequest(parsed);
      if (!v.ok) {
        return {
          kind: 'malformed',
          blockType,
          message: v.errors.join('; '),
        };
      }
      return { kind: 'script_request', request: v.request };
    }
    case 'browserclaw-web': {
      const v = validateWebRequest(parsed);
      if (!v.ok) {
        return {
          kind: 'malformed',
          blockType,
          message: v.errors.join('; '),
        };
      }
      return { kind: 'web_request', request: v.request };
    }
    default:
      return {
        kind: 'malformed',
        blockType,
        message: `Unsupported BrowserClaw block type: ${blockType}`,
      };
  }
}
