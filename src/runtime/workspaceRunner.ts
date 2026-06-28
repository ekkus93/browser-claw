/**
 * Host handler for the runtime's `workspace_file_op` / `workspace_search`
 * effects (Part F3). A mutating workspace op (create/update/append/delete/move/
 * copy) is validated and queued for inline approval; nothing runs until the user
 * approves. On approval it executes through the audited workspace ops and the
 * effect resolves with the resulting file stat. A read-only `workspace_search`
 * needs no approval and resolves with its results directly. A rejected/invalid
 * op resolves as a failure.
 */

import { approvalRequested } from '../store/slices/approvalsSlice.ts';
import {
  buildWorkspaceProposal,
  executeWorkspaceOp,
  rejectWorkspaceOp,
  type WorkspaceOp,
  type WorkspaceOpsDeps,
} from '../workspace/workspaceOps.ts';
import { isValidWorkspacePath } from '../workspace/path.ts';
import type { WorkspaceActor } from '../workspace/types.ts';
import type { Command, Effect } from './effectTypes.ts';
import { tryParseApprovalPayload } from './approvalPayload.ts';

type WorkspaceEffect = Extract<
  Effect,
  { type: 'workspace_file_op' | 'workspace_search' }
>;

export interface WorkspaceEffectDeps {
  ops: WorkspaceOpsDeps;
  submit: (command: Command) => Promise<void>;
}

const CONTENT_KINDS = new Set(['create', 'update', 'append']);
const PAIR_KINDS = new Set(['move', 'copy']);

/** Parse an untrusted value into a {@link WorkspaceOp}, or null if malformed. */
export function parseWorkspaceOp(input: unknown): WorkspaceOp | null {
  if (typeof input !== 'object' || input === null) return null;
  const op = input as Record<string, unknown>;
  const kind = op.kind;
  if (typeof kind !== 'string') return null;

  if (CONTENT_KINDS.has(kind)) {
    if (typeof op.path !== 'string' || !isValidWorkspacePath(op.path)) {
      return null;
    }
    if (typeof op.content !== 'string') return null;
    return {
      kind: kind as 'create' | 'update' | 'append',
      path: op.path,
      content: op.content,
      ...(typeof op.actor === 'string'
        ? { actor: op.actor as WorkspaceActor }
        : {}),
    };
  }
  if (kind === 'delete') {
    if (typeof op.path !== 'string' || !isValidWorkspacePath(op.path)) {
      return null;
    }
    return { kind: 'delete', path: op.path };
  }
  if (PAIR_KINDS.has(kind)) {
    if (
      typeof op.from !== 'string' ||
      typeof op.to !== 'string' ||
      !isValidWorkspacePath(op.from) ||
      !isValidWorkspacePath(op.to)
    ) {
      return null;
    }
    return { kind: kind as 'move' | 'copy', from: op.from, to: op.to };
  }
  return null;
}

function sanitizeSearchQuery(input: unknown): {
  pathContains?: string;
  textContains?: string;
  extension?: string;
} {
  const q = (
    typeof input === 'object' && input !== null ? input : {}
  ) as Record<string, unknown>;
  return {
    ...(typeof q.pathContains === 'string'
      ? { pathContains: q.pathContains }
      : {}),
    ...(typeof q.textContains === 'string'
      ? { textContains: q.textContains }
      : {}),
    ...(typeof q.extension === 'string' ? { extension: q.extension } : {}),
  };
}

export function createWorkspaceEffectHandler(deps: WorkspaceEffectDeps) {
  return async (effect: WorkspaceEffect): Promise<void> => {
    if (effect.type === 'workspace_search') {
      // Read-only: run directly and resolve, no approval.
      const results = await deps.ops.fs.search(
        sanitizeSearchQuery(effect.query),
      );
      await deps.submit({
        type: 'resolve_effect',
        id: effect.id,
        result: { ok: true, results },
      });
      return;
    }

    const op = parseWorkspaceOp(effect.op);
    if (!op) {
      await deps.submit({
        type: 'resolve_effect',
        id: effect.id,
        result: {
          ok: false,
          error: { kind: 'workspace_invalid', message: 'invalid workspace op' },
        },
      });
      return;
    }
    const proposal = await buildWorkspaceProposal(deps.ops, op);
    deps.ops.dispatch(
      approvalRequested({
        id: effect.id,
        kind: op.kind === 'delete' ? 'workspace_delete' : 'workspace_write',
        title: proposal.title,
        risk: proposal.risk,
        summary: proposal.summary,
        payloadPreview: JSON.stringify(op),
      }),
    );
  };
}

export interface ApprovedWorkspaceOp {
  id: string;
  status: 'approved' | 'rejected';
  /** The workspace-op JSON the user reviewed (the approval's payloadPreview). */
  payloadPreview?: string;
}

/**
 * Perform (or decline) a workspace op the user resolved on the approval card,
 * then resolve the runtime effect. Called by the approval-resolution listener.
 */
export async function runApprovedWorkspaceEffect(
  deps: WorkspaceEffectDeps,
  approval: ApprovedWorkspaceOp,
): Promise<void> {
  const op = parseWorkspaceOp(tryParseApprovalPayload(approval.payloadPreview));

  if (approval.status !== 'approved') {
    if (op) rejectWorkspaceOp(deps.ops, op);
    await deps.submit({
      type: 'resolve_effect',
      id: approval.id,
      result: { ok: false, error: { kind: 'user_rejected' } },
    });
    return;
  }
  if (!op) {
    await deps.submit({
      type: 'resolve_effect',
      id: approval.id,
      result: {
        ok: false,
        error: { kind: 'workspace_invalid', message: 'invalid workspace op' },
      },
    });
    return;
  }

  try {
    const result = await executeWorkspaceOp(deps.ops, op);
    await deps.submit({
      type: 'resolve_effect',
      id: approval.id,
      result: { ok: true, stat: result ?? null },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await deps.submit({
      type: 'resolve_effect',
      id: approval.id,
      result: { ok: false, error: { kind: 'workspace_failed', message } },
    });
  }
}
