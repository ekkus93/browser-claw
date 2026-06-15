/**
 * Sandboxed script request schema + validator (Part D2, spec §4.3).
 *
 * A `BrowserClawScriptRequest` is the untrusted manifest the agent submits when
 * it wants to run dynamic code in the v0.2 sandbox. This validator fails closed:
 * the request must declare its runtime, an explicit reason, the code, a bounded
 * capability manifest (safe workspace path scopes only), and the required
 * resource limits. Secrets are never grantable, and there is no raw-network
 * capability — network access is only ever the mediated web capability.
 *
 * Validation here is structural/policy gating only; it runs no code. The
 * sandbox itself (D3) and capability mediation (D4) enforce the rest at runtime.
 */

import { classifyFetchUrl } from '../net/urlSafety.ts';
import { isValidWorkspacePath } from '../workspace/path.ts';
import type { ApprovalRisk } from '../store/slices/approvalsSlice.ts';
import {
  classifyCapabilityRisk,
  SANDBOXED_SCRIPT_RUNTIME,
  type ScriptCapabilities,
} from './scriptPolicy.ts';

export const SCRIPT_REQUEST_TYPE = 'browserclaw_script_request';
export const SCRIPT_REQUEST_VERSION = 1;

/** Upper bounds the validator enforces so a request cannot ask for the moon. */
export const MAX_TIMEOUT_MS = 30_000;
export const MAX_OUTPUT_BYTES = 1_048_576; // 1 MiB
export const MAX_FILE_READS = 1_000;
export const MAX_FILE_WRITES = 200;
export const MAX_CODE_CHARS = 100_000;

/**
 * Resource limits a script must declare (spec §4.5). The four core fields are
 * required; the extended ceilings are optional and enforced by D5 when present.
 */
export interface ScriptLimits {
  timeoutMs: number;
  maxOutputBytes: number;
  maxFileReads: number;
  maxFileWrites: number;
  maxLogBytes?: number;
  maxTotalBytesRead?: number;
  maxTotalBytesWritten?: number;
  maxWebRequests?: number;
  maxPagesRead?: number;
}

export interface BrowserClawScriptRequest {
  type: typeof SCRIPT_REQUEST_TYPE;
  version: number;
  runtime: typeof SANDBOXED_SCRIPT_RUNTIME;
  title: string;
  reason: string;
  code: string;
  capabilities: ScriptCapabilities;
  limits: ScriptLimits;
}

export type ScriptRequestValidation =
  | { ok: true; request: BrowserClawScriptRequest; risk: ApprovalRisk }
  | { ok: false; errors: string[] };

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** A capability path scope must be a safe workspace path/glob. */
function validateScopes(
  raw: unknown,
  field: string,
  errors: string[],
): string[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.some((s) => typeof s !== 'string')) {
    errors.push(`${field} must be an array of path scopes`);
    return undefined;
  }
  const scopes = raw as string[];
  for (const scope of scopes) {
    if (!isValidWorkspacePath(scope)) {
      errors.push(`${field} scope "${scope}" is not a safe workspace path`);
    }
  }
  return scopes;
}

function validatePositiveLimit(
  limits: Record<string, unknown>,
  key: keyof ScriptLimits,
  max: number,
  errors: string[],
): void {
  const value = limits[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    errors.push(`limits.${key} is required and must be a positive number`);
  } else if (value > max) {
    errors.push(`limits.${key} exceeds the maximum of ${max}`);
  }
}

/**
 * Validate an untrusted value as a {@link BrowserClawScriptRequest}. Returns the
 * typed request plus its capability risk on success, or the full list of
 * rejection reasons.
 */
export function validateScriptRequest(input: unknown): ScriptRequestValidation {
  const errors: string[] = [];
  if (!isObject(input)) {
    return { ok: false, errors: ['script request is not an object'] };
  }

  if (input.type !== SCRIPT_REQUEST_TYPE) {
    errors.push(`type must be "${SCRIPT_REQUEST_TYPE}"`);
  }
  if (input.version !== SCRIPT_REQUEST_VERSION) {
    errors.push(`version must be ${SCRIPT_REQUEST_VERSION}`);
  }
  if (input.runtime !== SANDBOXED_SCRIPT_RUNTIME) {
    errors.push(`runtime must be "${SANDBOXED_SCRIPT_RUNTIME}"`);
  }
  if (typeof input.title !== 'string' || input.title.trim().length === 0) {
    errors.push('title is required');
  }
  if (typeof input.reason !== 'string' || input.reason.trim().length === 0) {
    errors.push('reason is required');
  }
  if (typeof input.code !== 'string' || input.code.trim().length === 0) {
    errors.push('code is required');
  } else if (input.code.length > MAX_CODE_CHARS) {
    errors.push(`code exceeds the maximum of ${MAX_CODE_CHARS} characters`);
  }

  const capabilities = validateCapabilities(input.capabilities, errors);
  validateLimits(input.limits, errors);

  if (errors.length > 0) return { ok: false, errors };

  const request = input as unknown as BrowserClawScriptRequest;
  return { ok: true, request, risk: classifyCapabilityRisk(capabilities) };
}

function validateCapabilities(
  raw: unknown,
  errors: string[],
): ScriptCapabilities {
  if (!isObject(raw)) {
    errors.push('capabilities manifest is required');
    return {};
  }

  const fsRead = validateScopes(raw.fsRead, 'capabilities.fsRead', errors);
  const fsWrite = validateScopes(raw.fsWrite, 'capabilities.fsWrite', errors);

  let webRead: string[] | undefined;
  if (raw.webRead !== undefined) {
    if (
      !Array.isArray(raw.webRead) ||
      raw.webRead.some((u) => typeof u !== 'string')
    ) {
      errors.push('capabilities.webRead must be an array of URLs');
    } else {
      webRead = raw.webRead as string[];
      for (const url of webRead) {
        if (!classifyFetchUrl(url).ok) {
          errors.push(`capabilities.webRead URL "${url}" is not allowed`);
        }
      }
    }
  }

  if (raw.webSearch !== undefined && typeof raw.webSearch !== 'boolean') {
    errors.push('capabilities.webSearch must be a boolean');
  }
  const webSearch = raw.webSearch === true;

  if (raw.memoryRead !== undefined && typeof raw.memoryRead !== 'boolean') {
    errors.push('capabilities.memoryRead must be a boolean');
  }
  const memoryRead = raw.memoryRead === true;

  let tools: string[] | undefined;
  if (raw.tools !== undefined) {
    if (
      !Array.isArray(raw.tools) ||
      raw.tools.some((t) => typeof t !== 'string')
    ) {
      errors.push('capabilities.tools must be an array of tool names');
    } else {
      tools = raw.tools as string[];
    }
  }

  // Secrets are never grantable to a script.
  if (raw.secrets !== undefined && raw.secrets !== 'deny') {
    errors.push(
      'capabilities.secrets must be "deny" — scripts cannot read secrets',
    );
  }

  // Network can only be denied or mediated; raw network is never available, and
  // a mediated grant must come with an actual web capability.
  let network: 'deny' | 'mediated' = 'deny';
  if (raw.network !== undefined) {
    if (raw.network !== 'deny' && raw.network !== 'mediated') {
      errors.push('capabilities.network must be "deny" or "mediated"');
    } else {
      network = raw.network;
    }
  }
  if (
    network === 'mediated' &&
    !webSearch &&
    (webRead === undefined || webRead.length === 0)
  ) {
    errors.push(
      'capabilities.network "mediated" requires a web capability (webSearch or webRead)',
    );
  }

  return {
    ...(fsRead ? { fsRead } : {}),
    ...(fsWrite ? { fsWrite } : {}),
    ...(webRead ? { webRead } : {}),
    ...(tools ? { tools } : {}),
    webSearch,
    memoryRead,
    network,
    secrets: 'deny',
  };
}

function validateLimits(raw: unknown, errors: string[]): void {
  if (!isObject(raw)) {
    errors.push('limits are required');
    return;
  }
  validatePositiveLimit(raw, 'timeoutMs', MAX_TIMEOUT_MS, errors);
  validatePositiveLimit(raw, 'maxOutputBytes', MAX_OUTPUT_BYTES, errors);
  validatePositiveLimit(raw, 'maxFileReads', MAX_FILE_READS, errors);
  validatePositiveLimit(raw, 'maxFileWrites', MAX_FILE_WRITES, errors);
}
