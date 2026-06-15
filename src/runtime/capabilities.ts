/**
 * Unified capability model (Part F1).
 *
 * Every mediated side effect in BrowserClaw — workspace I/O, web research,
 * script execution, skill tool calls — is named by a capability and bounded by
 * a scope (path globs, domains, URL prefixes, numeric limits). This module is
 * the single source of truth for the capability vocabulary, scope validation,
 * and risk classification used by the runtime-effect and approval layers
 * (F2/F3). It owns no runtime state and performs no I/O.
 */

import { classifyFetchUrl } from '../net/urlSafety.ts';
import { isValidWorkspacePath } from '../workspace/path.ts';
import type { ApprovalRisk } from '../store/slices/approvalsSlice.ts';

export const WORKSPACE_CAPABILITIES = [
  'workspace.read',
  'workspace.write',
  'workspace.delete',
  'workspace.search',
] as const;

export const WEB_CAPABILITIES = [
  'web.search',
  'web.readPage',
  'web.readCurrentTab',
] as const;

export const SCRIPT_CAPABILITIES = ['script.plan', 'script.sandbox'] as const;

/** A skill tool capability is `skill.tool.<toolName>`. */
export const SKILL_TOOL_PREFIX = 'skill.tool.';

/** All fixed capability names (skill tools are a `skill.tool.*` family). */
export const FIXED_CAPABILITIES = [
  ...WORKSPACE_CAPABILITIES,
  ...WEB_CAPABILITIES,
  ...SCRIPT_CAPABILITIES,
] as const;

export type FixedCapabilityName = (typeof FIXED_CAPABILITIES)[number];
export type CapabilityName = FixedCapabilityName | `skill.tool.${string}`;

const FIXED_SET = new Set<string>(FIXED_CAPABILITIES);

/** A scope bounds a capability: which paths/domains/URLs and what limits. */
export interface CapabilityScope {
  /** Workspace path globs (e.g. `/workspace/docs/**`). */
  paths?: readonly string[];
  /** Host domains (e.g. `example.com`). */
  domains?: readonly string[];
  /** URL prefixes (must be safe http(s) URLs). */
  urls?: readonly string[];
  /** Numeric ceilings (e.g. `{ maxPages: 5 }`). */
  limits?: Readonly<Record<string, number>>;
}

export interface Capability {
  name: CapabilityName;
  scope?: CapabilityScope;
}

/** True when `name` is a known capability (fixed name or a `skill.tool.*`). */
export function isKnownCapabilityName(name: string): name is CapabilityName {
  if (FIXED_SET.has(name)) return true;
  return (
    name.startsWith(SKILL_TOOL_PREFIX) && name.length > SKILL_TOOL_PREFIX.length
  );
}

/** The tool name of a `skill.tool.<name>` capability, or null. */
export function skillToolName(name: string): string | null {
  if (!name.startsWith(SKILL_TOOL_PREFIX)) return null;
  const tool = name.slice(SKILL_TOOL_PREFIX.length);
  return tool.length > 0 ? tool : null;
}

export type CapabilityValidation =
  | { ok: true; capability: Capability }
  | { ok: false; errors: string[] };

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function validateScope(raw: unknown, errors: string[]): CapabilityScope {
  if (!isObject(raw)) {
    errors.push('scope must be an object');
    return {};
  }
  const scope: {
    paths?: string[];
    domains?: string[];
    urls?: string[];
    limits?: Record<string, number>;
  } = {};

  if (raw.paths !== undefined) {
    if (
      !Array.isArray(raw.paths) ||
      raw.paths.some((p) => typeof p !== 'string')
    ) {
      errors.push('scope.paths must be an array of strings');
    } else {
      for (const path of raw.paths as string[]) {
        if (!isValidWorkspacePath(path)) {
          errors.push(`scope.paths "${path}" is not a safe workspace path`);
        }
      }
      scope.paths = raw.paths as string[];
    }
  }

  if (raw.urls !== undefined) {
    if (
      !Array.isArray(raw.urls) ||
      raw.urls.some((u) => typeof u !== 'string')
    ) {
      errors.push('scope.urls must be an array of strings');
    } else {
      for (const url of raw.urls as string[]) {
        if (!classifyFetchUrl(url).ok) {
          errors.push(`scope.urls "${url}" is not an allowed URL`);
        }
      }
      scope.urls = raw.urls as string[];
    }
  }

  if (raw.domains !== undefined) {
    if (
      !Array.isArray(raw.domains) ||
      raw.domains.some((d) => typeof d !== 'string' || d.length === 0)
    ) {
      errors.push('scope.domains must be an array of non-empty strings');
    } else {
      scope.domains = raw.domains as string[];
    }
  }

  if (raw.limits !== undefined) {
    if (!isObject(raw.limits)) {
      errors.push('scope.limits must be an object of numbers');
    } else {
      const limits: Record<string, number> = {};
      for (const [key, value] of Object.entries(raw.limits)) {
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
          errors.push(`scope.limits.${key} must be a non-negative number`);
        } else {
          limits[key] = value;
        }
      }
      scope.limits = limits;
    }
  }

  return scope;
}

/** Validate an untrusted value as a {@link Capability}. */
export function validateCapability(input: unknown): CapabilityValidation {
  const errors: string[] = [];
  if (!isObject(input)) {
    return { ok: false, errors: ['capability is not an object'] };
  }
  const name = input.name;
  if (typeof name !== 'string' || !isKnownCapabilityName(name)) {
    errors.push(`unknown capability name "${String(name)}"`);
  }

  let scope: CapabilityScope | undefined;
  if (input.scope !== undefined) {
    scope = validateScope(input.scope, errors);
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    capability: {
      name: name as CapabilityName,
      ...(scope ? { scope } : {}),
    },
  };
}

/** A path/url glob that covers everything in its namespace is "broad". */
const BROAD_SCOPES = new Set([
  '*',
  '**',
  '/*',
  '/**',
  '/workspace',
  '/workspace/*',
  '/workspace/**',
]);

function hasBroadPath(scope: CapabilityScope | undefined): boolean {
  return (scope?.paths ?? []).some((p) =>
    BROAD_SCOPES.has(p.trim().replace(/\/+$/, '')),
  );
}

/**
 * Classify a capability's risk for the approval card:
 * - high: destructive (delete), broad writes, or dynamic sandboxed scripting;
 * - medium: bounded writes, web access, plan execution, skill tools;
 * - low: read-only workspace access.
 */
export function classifyCapabilityRisk(capability: Capability): ApprovalRisk {
  const { name } = capability;
  if (name === 'workspace.delete' || name === 'script.sandbox') return 'high';
  if (name === 'workspace.write') {
    return hasBroadPath(capability.scope) ? 'high' : 'medium';
  }
  if (name === 'workspace.read' || name === 'workspace.search') return 'low';
  // web.*, script.plan, skill.tool.* are mediated side effects.
  return 'medium';
}

/** The highest risk across a set of capabilities (low when empty). */
export function aggregateRisk(
  capabilities: readonly Capability[],
): ApprovalRisk {
  let risk: ApprovalRisk = 'low';
  for (const capability of capabilities) {
    const r = classifyCapabilityRisk(capability);
    if (r === 'high') return 'high';
    if (r === 'medium') risk = 'medium';
  }
  return risk;
}
