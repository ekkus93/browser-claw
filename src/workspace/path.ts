/**
 * Workspace path validation + normalization (Part B2, spec §2.4).
 *
 * Workspace paths are VIRTUAL and absolute under {@link WORKSPACE_ROOT}. They are
 * not OS paths. Validation is strict and fails closed: anything that could
 * escape the workspace namespace — traversal (raw or percent-encoded), OS
 * absolute paths, backslashes, null bytes, control characters, or reserved/
 * hidden segments — is rejected before any storage operation runs.
 */

import { WORKSPACE_ROOT } from './types.ts';

export type WorkspacePathResult =
  | { ok: true; path: string }
  | { ok: false; reason: string };

const ROOT_SEGMENT = WORKSPACE_ROOT.replace(/^\//, ''); // 'workspace'

/** Any C0 control char or DEL — checked by code point to avoid a control regex. */
function hasControlChar(text: string): boolean {
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * Validate and canonicalize a workspace path. On success returns the normalized
 * path (collapsed slashes, no trailing slash). Both the raw and the
 * percent-decoded form are checked, so encoded traversal can't slip through.
 */
export function validateWorkspacePath(input: string): WorkspacePathResult {
  if (typeof input !== 'string' || input.length === 0) {
    return { ok: false, reason: 'empty path' };
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(input);
  } catch {
    return { ok: false, reason: 'malformed percent-encoding' };
  }

  for (const form of [input, decoded]) {
    if (form.includes('\\')) return { ok: false, reason: 'backslash' };
    if (form.includes('\0')) return { ok: false, reason: 'null byte' };
    if (hasControlChar(form)) {
      return { ok: false, reason: 'control character' };
    }
  }

  // Validate the decoded form (so `%2e%2e` is treated as `..`).
  if (!decoded.startsWith('/')) {
    return { ok: false, reason: 'not an absolute workspace path' };
  }
  const segments = decoded.split('/').filter((s) => s.length > 0);
  if (segments[0] !== ROOT_SEGMENT) {
    return { ok: false, reason: 'outside the workspace root' };
  }
  for (const seg of segments) {
    if (seg === '.' || seg === '..') {
      return { ok: false, reason: 'path traversal' };
    }
    if (seg.startsWith('.')) {
      return { ok: false, reason: 'reserved or hidden segment' };
    }
    if (seg.trim().length === 0) {
      return { ok: false, reason: 'blank segment' };
    }
  }

  return { ok: true, path: `/${segments.join('/')}` };
}

/** Like {@link validateWorkspacePath} but throws on an invalid path. */
export function normalizeWorkspacePath(input: string): string {
  const result = validateWorkspacePath(input);
  if (!result.ok) {
    throw new Error(`Invalid workspace path: ${result.reason}`);
  }
  return result.path;
}

/** True when the path is a valid workspace path. */
export function isValidWorkspacePath(input: string): boolean {
  return validateWorkspacePath(input).ok;
}
