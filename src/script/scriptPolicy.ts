/**
 * Script Runtime selection policy + router (Part D1).
 *
 * BrowserClaw has two script runtimes: the structured Plan DSL (v0.1, the safe
 * default) and the sandboxed dynamic-script runtime (v0.2, an explicit
 * escalation). This module owns the decision of which one a task may use.
 *
 * Fail-closed posture: the sandbox is DISABLED by default and additionally
 * advanced-gated, so with the default policy a v0.2 escalation is always
 * rejected. A v0.2 escalation must carry an explicit reason and a capability
 * manifest, and — even when allowed — always requires user approval before it
 * can run. Broad capability scopes are marked high risk.
 */

import type { ApprovalRisk } from '../store/slices/approvalsSlice.ts';

export const PLAN_DSL_RUNTIME = 'plan_dsl';
export const SANDBOXED_SCRIPT_RUNTIME = 'sandboxed_script';

/** Human label shown on the v0.2 approval card (Part D6). */
export const SANDBOX_RUNTIME_LABEL = 'Sandboxed Script Runtime v0.2';

export type ScriptRuntimeKind =
  | typeof PLAN_DSL_RUNTIME
  | typeof SANDBOXED_SCRIPT_RUNTIME;

/**
 * Whether the sandboxed dynamic-script runtime may run, and under what gate.
 * Both flags default to off, so v0.2 is unavailable until a user deliberately
 * turns it on in advanced settings.
 */
export interface ScriptExecutionPolicy {
  /** Default runtime when a task does not escalate. Always the Plan DSL. */
  readonly defaultRuntime: typeof PLAN_DSL_RUNTIME;
  /** Whether the sandboxed v0.2 runtime is permitted at all. Default: false. */
  readonly sandboxedScriptingEnabled: boolean;
  /** v0.2 is advanced-only; this gate must also be on. Default: false. */
  readonly advancedMode: boolean;
}

export const DEFAULT_SCRIPT_POLICY: ScriptExecutionPolicy = {
  defaultRuntime: PLAN_DSL_RUNTIME,
  sandboxedScriptingEnabled: false,
  advancedMode: false,
};

/**
 * The capability manifest a v0.2 script requests. Path scopes are globs (e.g.
 * `/workspace/docs/**`); `network`/`secrets` are explicit allow/deny words. This
 * shape is shared with the full request schema validated in Part D2.
 */
export interface ScriptCapabilities {
  fsRead?: readonly string[];
  fsWrite?: readonly string[];
  webSearch?: boolean;
  webRead?: readonly string[];
  /** Read-only memory search (Part D4). */
  memoryRead?: boolean;
  /** Tools the script may call via `tool.call`, through the permission model. */
  tools?: readonly string[];
  network?: 'deny' | 'mediated';
  secrets?: 'deny';
}

/**
 * A request to escalate from the Plan DSL to the sandboxed runtime. The agent
 * provides this only when the structured DSL is genuinely insufficient.
 */
export interface ScriptEscalation {
  /** Why the structured DSL cannot do this task. Required for v0.2. */
  reason?: string;
  /** The capabilities the script needs. Required for v0.2. */
  capabilities?: ScriptCapabilities;
  /** The user explicitly asked for a script (vs. the agent escalating). */
  userRequested?: boolean;
}

export interface RouteInput {
  /** Whether the task can be expressed with the known Plan DSL operations. */
  fitsKnownOps: boolean;
  /** A v0.2 escalation request, when one is being made. */
  escalation?: ScriptEscalation;
}

export type RuntimeDecision =
  | { runtime: typeof PLAN_DSL_RUNTIME }
  | {
      runtime: typeof SANDBOXED_SCRIPT_RUNTIME;
      requiresApproval: true;
      risk: ApprovalRisk;
    }
  | { runtime: null; rejected: true; reason: string };

/** A glob that covers the whole workspace (or everything) is "broad". */
const BROAD_SCOPES = new Set([
  '*',
  '**',
  '/*',
  '/**',
  '/workspace',
  '/workspace/*',
  '/workspace/**',
]);

function isBroadScope(glob: string): boolean {
  const trimmed = glob.trim().replace(/\/+$/, '');
  return BROAD_SCOPES.has(trimmed);
}

function hasBroadScope(scopes: readonly string[] | undefined): boolean {
  return (scopes ?? []).some(isBroadScope);
}

/**
 * Classify how risky a capability manifest is for the approval card.
 * - high: real network, or a broad read/write scope (whole workspace);
 * - medium: any bounded write, or any web read/search;
 * - low: read-only within bounded scopes.
 */
export function classifyCapabilityRisk(
  capabilities: ScriptCapabilities,
): ApprovalRisk {
  if (
    capabilities.network === 'mediated' ||
    hasBroadScope(capabilities.fsWrite) ||
    hasBroadScope(capabilities.fsRead)
  ) {
    return 'high';
  }
  if (
    (capabilities.fsWrite?.length ?? 0) > 0 ||
    capabilities.webSearch === true ||
    (capabilities.webRead?.length ?? 0) > 0 ||
    (capabilities.tools?.length ?? 0) > 0
  ) {
    return 'medium';
  }
  return 'low';
}

/**
 * Choose which script runtime a task may use. Defaults to the Plan DSL; only
 * routes to the sandbox when an escalation is present, the policy permits it,
 * and the escalation is well-formed. The sandbox decision always requires
 * approval and carries a risk for the approval card.
 */
export function routeScript(
  input: RouteInput,
  policy: ScriptExecutionPolicy = DEFAULT_SCRIPT_POLICY,
): RuntimeDecision {
  const { escalation } = input;

  // No escalation: use the structured DSL (the default runtime).
  if (!escalation) {
    return { runtime: PLAN_DSL_RUNTIME };
  }

  // A task that fits known ops and is not explicitly user-requested should not
  // escalate — the DSL can do it simply.
  if (input.fitsKnownOps && !escalation.userRequested) {
    return { runtime: PLAN_DSL_RUNTIME };
  }

  // From here the task wants v0.2. The sandbox must be enabled AND advanced.
  if (!policy.sandboxedScriptingEnabled) {
    return {
      runtime: null,
      rejected: true,
      reason: 'sandboxed scripting is disabled by policy',
    };
  }
  if (!policy.advancedMode) {
    return {
      runtime: null,
      rejected: true,
      reason: 'sandboxed scripting requires advanced mode',
    };
  }

  // A v0.2 escalation must explain itself and declare its capabilities.
  if (
    typeof escalation.reason !== 'string' ||
    escalation.reason.trim().length === 0
  ) {
    return {
      runtime: null,
      rejected: true,
      reason: 'sandboxed scripting requires an explicit reason',
    };
  }
  if (!escalation.capabilities) {
    return {
      runtime: null,
      rejected: true,
      reason: 'sandboxed scripting requires a declared capability manifest',
    };
  }

  // Secrets are never grantable to a script.
  if (
    escalation.capabilities.secrets &&
    escalation.capabilities.secrets !== 'deny'
  ) {
    return {
      runtime: null,
      rejected: true,
      reason: 'sandboxed scripting may not request secrets',
    };
  }

  return {
    runtime: SANDBOXED_SCRIPT_RUNTIME,
    requiresApproval: true,
    risk: classifyCapabilityRisk(escalation.capabilities),
  };
}
