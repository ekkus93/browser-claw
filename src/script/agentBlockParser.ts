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

// ---------------------------------------------------------------------------
// BrowserClawWebRequest (inline — no separate schema file yet)
// ---------------------------------------------------------------------------

const WEB_REQUEST_TYPE = 'browserclaw_web_request';
const WEB_REQUEST_VERSION = 1;
const KNOWN_WEB_OPS = ['readPage', 'search', 'readCurrentTab'] as const;
type WebOp = (typeof KNOWN_WEB_OPS)[number];

export interface BrowserClawWebRequest {
  type: typeof WEB_REQUEST_TYPE;
  version: typeof WEB_REQUEST_VERSION;
  op: WebOp;
  url?: string;
  query?: string;
  maxResults?: number;
  maxChars?: number;
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

  if (obj.op === 'readPage' || obj.op === 'readCurrentTab') {
    if (obj.op === 'readPage') {
      if (typeof obj.url !== 'string') {
        errors.push('readPage requires a string url');
      } else {
        const safe = classifyFetchUrl(obj.url);
        if (!safe.ok) {
          errors.push(`url is blocked: ${safe.reason}`);
        }
      }
    }
  }

  if (obj.op === 'search' && typeof obj.query !== 'string') {
    errors.push('search requires a string query');
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, request: obj as unknown as BrowserClawWebRequest };
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
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const match = matches[0]!;
  const blockType = match[1] ?? '';
  const rawJson = match[2] ?? '';

  if (blockType === 'tool') {
    const r = parseToolCall(text);
    if (r.kind === 'none') return { kind: 'none', text };
    if (r.kind === 'malformed') return { kind: 'malformed', blockType: 'tool', message: r.message };
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
