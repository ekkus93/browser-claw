/**
 * Sandboxed script approval + audit (Part D6, spec §4.6).
 *
 * A v0.2 sandboxed script is the highest-trust side effect BrowserClaw can run,
 * so it is PROPOSED with a full preview (runtime, reason, code, capabilities,
 * limits, risk, network/web permissions, file scopes), then on approval it runs
 * through {@link runSandboxWithLimits} with its whole lifecycle audited
 * (requested → approved → started → completed/failed/timeout/cancelled). A
 * rejection is audited and runs nothing. Per-capability usage is summarized to
 * the audit log as it happens.
 *
 * Redux-agnostic (uses the audit sink only). The inline approval card and the
 * resolution listener are wired in the approval-integration phase (Part F3/G2).
 */

import { recordAudit } from '../audit/auditSink.ts';
import type { ApprovalRisk } from '../store/slices/approvalsSlice.ts';
import {
  runSandboxWithLimits,
  type CapabilityAudit,
  type LimitedSandboxResult,
  type SandboxCapabilityContext,
} from './sandboxCapabilities.ts';
import { SANDBOX_RUNTIME_LABEL } from './scriptPolicy.ts';
import {
  validateScriptRequest,
  type BrowserClawScriptRequest,
  type ScriptLimits,
} from './scriptRequest.ts';

/** Maximum characters of script source shown on the approval card. */
export const CODE_PREVIEW_LIMIT = 2_000;

export interface ScriptProposal {
  runtime: typeof SANDBOX_RUNTIME_LABEL;
  title: string;
  reason: string;
  codePreview: string;
  codeTruncated: boolean;
  risk: ApprovalRisk;
  capabilities: string[];
  fileScopes: { reads: string[]; writes: string[] };
  webPermissions: { search: boolean; read: string[] };
  network: 'deny' | 'mediated';
  limits: ScriptLimits;
}

/** The distinct capabilities a script requests, for the approval card summary. */
function summarizeCapabilities(request: BrowserClawScriptRequest): string[] {
  const caps = new Set<string>();
  const c = request.capabilities;
  if ((c.fsRead?.length ?? 0) > 0) caps.add('workspace.read');
  if ((c.fsWrite?.length ?? 0) > 0) caps.add('workspace.write');
  if (c.webSearch === true) caps.add('web.search');
  if ((c.webRead?.length ?? 0) > 0) caps.add('web.readPage');
  if (c.memoryRead === true) caps.add('memory.read');
  if ((c.tools?.length ?? 0) > 0) caps.add('skill.tool');
  if (c.network === 'mediated') caps.add('network.mediated');
  return [...caps].sort();
}

/** Build the approval preview for a validated script request. */
export function buildScriptProposal(
  request: BrowserClawScriptRequest,
  risk: ApprovalRisk,
): ScriptProposal {
  const c = request.capabilities;
  const truncated = request.code.length > CODE_PREVIEW_LIMIT;
  return {
    runtime: SANDBOX_RUNTIME_LABEL,
    title: request.title,
    reason: request.reason,
    codePreview: request.code.slice(0, CODE_PREVIEW_LIMIT),
    codeTruncated: truncated,
    risk,
    capabilities: summarizeCapabilities(request),
    fileScopes: {
      reads: [...(c.fsRead ?? [])],
      writes: [...(c.fsWrite ?? [])],
    },
    webPermissions: {
      search: c.webSearch === true,
      read: [...(c.webRead ?? [])],
    },
    network: c.network === 'mediated' ? 'mediated' : 'deny',
    limits: request.limits,
  };
}

export type ScriptRuntimeContext = SandboxCapabilityContext;

type AuditStatus = 'success' | 'failure' | 'pending' | 'rejected' | 'cancelled';

function audit(
  ctx: ScriptRuntimeContext,
  type: string,
  summary: string,
  risk: ApprovalRisk | 'info',
  status: AuditStatus,
): void {
  void recordAudit(ctx.db, ctx.dispatch, {
    type,
    summary,
    source: 'script',
    risk: risk === 'low' ? 'low' : risk,
    status,
  });
}

export type ScriptProposalResult =
  | { ok: true; proposal: ScriptProposal }
  | { ok: false; errors: string[] };

/**
 * Validate and propose a sandboxed script for approval. Audits
 * `script.sandbox_requested` on success, or `script.sandbox_rejected` when the
 * request is malformed (nothing runs either way).
 */
export function proposeScript(
  ctx: ScriptRuntimeContext,
  input: unknown,
): ScriptProposalResult {
  const validation = validateScriptRequest(input);
  if (!validation.ok) {
    audit(
      ctx,
      'script.sandbox_rejected',
      `Sandboxed script invalid: ${validation.errors.join('; ')}`,
      'medium',
      'rejected',
    );
    return { ok: false, errors: validation.errors };
  }
  const proposal = buildScriptProposal(validation.request, validation.risk);
  audit(
    ctx,
    'script.sandbox_requested',
    `Sandboxed script proposed: ${validation.request.title}`,
    validation.risk,
    'pending',
  );
  return { ok: true, proposal };
}

/** Audit a rejected sandboxed script (nothing runs). */
export function rejectScript(
  ctx: ScriptRuntimeContext,
  request: BrowserClawScriptRequest,
): void {
  audit(
    ctx,
    'script.sandbox_rejected',
    `Sandboxed script rejected: ${request.title}`,
    'low',
    'rejected',
  );
}

export interface ApprovedScriptOptions {
  signal?: AbortSignal;
  now?: () => number;
}

/**
 * Run an APPROVED sandboxed script with full lifecycle auditing. Re-validates,
 * audits approved + started, runs the limited sandbox (with per-capability
 * usage summarized to the audit log), then audits the terminal state by error
 * kind (completed / failed / timeout / cancelled).
 */
export async function runApprovedScript(
  ctx: ScriptRuntimeContext,
  input: unknown,
  options: ApprovedScriptOptions = {},
): Promise<LimitedSandboxResult> {
  const validation = validateScriptRequest(input);
  if (!validation.ok) {
    audit(
      ctx,
      'script.sandbox_failed',
      `Sandboxed script invalid: ${validation.errors.join('; ')}`,
      'medium',
      'failure',
    );
    return {
      ok: false,
      error: validation.errors.join('; '),
      errorKind: 'internal_error',
    };
  }
  const request = validation.request;

  audit(
    ctx,
    'script.sandbox_approved',
    `Sandboxed script approved: ${request.title}`,
    validation.risk,
    'pending',
  );
  audit(
    ctx,
    'script.sandbox_started',
    `Sandboxed script started: ${request.title}`,
    'info',
    'pending',
  );

  // Summarize each mediated capability call as it happens.
  const onAudit = (entry: CapabilityAudit): void => {
    audit(
      ctx,
      entry.allowed ? 'script.capability_used' : 'script.capability_denied',
      `${entry.capability}${entry.target ? ` ${entry.target}` : ''}${
        entry.reason ? ` — ${entry.reason}` : ''
      }`,
      entry.allowed ? 'info' : 'medium',
      entry.allowed ? 'success' : 'failure',
    );
  };

  const result = await runSandboxWithLimits({ ...ctx, onAudit }, request.code, {
    capabilities: request.capabilities,
    limits: request.limits,
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.now ? { now: options.now } : {}),
  });

  if (result.ok) {
    audit(
      ctx,
      'script.sandbox_completed',
      `Sandboxed script completed: ${request.title}`,
      'info',
      'success',
    );
  } else if (result.errorKind === 'timeout') {
    audit(
      ctx,
      'script.sandbox_timeout',
      `Sandboxed script timed out: ${request.title}`,
      'medium',
      'failure',
    );
  } else if (result.errorKind === 'cancelled') {
    audit(
      ctx,
      'script.sandbox_cancelled',
      `Sandboxed script cancelled: ${request.title}`,
      'low',
      'cancelled',
    );
  } else {
    audit(
      ctx,
      'script.sandbox_failed',
      `Sandboxed script failed: ${request.title} (${result.error})`,
      'medium',
      'failure',
    );
  }
  return result;
}
