/**
 * Workspace operation proposals, risk classification, audit, and execution
 * (Part B6). A workspace write/delete/move is a meaningful side effect, so it is
 * PROPOSED with a risk + preview (a diff for text updates), then on approval it
 * executes through {@link WorkspaceFs} and audits the outcome; on rejection it
 * audits a permission_denied and does nothing.
 *
 * This module is Redux-agnostic (it only needs db + dispatch for the audit sink).
 * The inline approval-card queue + resolution listener are wired in the approval
 * integration phase (Part F3) on top of these primitives.
 */

import type { BrowserClawDB } from '../db/db.ts';
import type { AppDispatch } from '../store/store.ts';
import type { ApprovalRisk } from '../store/slices/approvalsSlice.ts';
import { recordAudit } from '../audit/auditSink.ts';
import type { WorkspaceActor } from './types.ts';
import { WorkspaceFs, type FileStat } from './workspaceFs.ts';

export type WorkspaceOp =
  | { kind: 'create'; path: string; content: string; actor?: WorkspaceActor }
  | { kind: 'update'; path: string; content: string; actor?: WorkspaceActor }
  | { kind: 'append'; path: string; content: string; actor?: WorkspaceActor }
  | { kind: 'delete'; path: string }
  | { kind: 'move'; from: string; to: string }
  | { kind: 'copy'; from: string; to: string };

/** Mutating ops always need approval; reads do not. Delete is the high-risk one. */
export function classifyWorkspaceRisk(op: WorkspaceOp): ApprovalRisk {
  switch (op.kind) {
    case 'delete':
      return 'high';
    case 'create':
    case 'update':
    case 'append':
    case 'move':
    case 'copy':
      return 'medium';
  }
}

const PREVIEW_LIMIT = 2_000;

function truncate(text: string, limit = PREVIEW_LIMIT): string {
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

/**
 * A minimal line-based diff preview for a text update: lines only in `before`
 * are `- `, lines only in `after` are `+ `. Not a true LCS diff — enough for a
 * human to see what an approval will change.
 */
export function textDiffPreview(
  before: string,
  after: string,
  maxLines = 200,
): string {
  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');
  const beforeSet = new Set(beforeLines);
  const afterSet = new Set(afterLines);
  const out: string[] = [];
  for (const line of beforeLines) {
    if (!afterSet.has(line)) out.push(`- ${line}`);
    if (out.length >= maxLines) break;
  }
  for (const line of afterLines) {
    if (!beforeSet.has(line)) out.push(`+ ${line}`);
    if (out.length >= maxLines) break;
  }
  return out.join('\n');
}

export interface WorkspaceProposal {
  op: WorkspaceOp;
  risk: ApprovalRisk;
  title: string;
  summary: string;
  /** Display-safe preview of the content/operation to be performed. */
  payloadPreview: string;
  /** Unified-ish diff for a text update over an existing file. */
  diff?: string;
}

export interface WorkspaceOpsDeps {
  fs: WorkspaceFs;
  db: BrowserClawDB;
  dispatch: AppDispatch;
}

/** Build an approval proposal (risk, preview, and a diff for updates). */
export async function buildWorkspaceProposal(
  deps: Pick<WorkspaceOpsDeps, 'fs'>,
  op: WorkspaceOp,
): Promise<WorkspaceProposal> {
  const risk = classifyWorkspaceRisk(op);
  const target = 'path' in op ? op.path : `${op.from} -> ${op.to}`;
  const base: WorkspaceProposal = {
    op,
    risk,
    title: `Workspace ${op.kind}: ${target}`,
    summary: `${op.kind} ${target}`,
    payloadPreview:
      'content' in op
        ? truncate(op.content)
        : JSON.stringify({ kind: op.kind, target }),
  };
  if (op.kind === 'update' && (await deps.fs.exists(op.path))) {
    const before = await deps.fs.readText(op.path);
    base.diff = textDiffPreview(before, op.content);
  }
  return base;
}

const AUDIT_EVENT: Record<WorkspaceOp['kind'], string> = {
  create: 'workspace.file_created',
  update: 'workspace.file_updated',
  append: 'workspace.file_updated',
  delete: 'workspace.file_deleted',
  move: 'workspace.file_moved',
  copy: 'workspace.file_copied',
};

/** Perform an APPROVED workspace op and audit the outcome. */
export async function executeWorkspaceOp(
  deps: WorkspaceOpsDeps,
  op: WorkspaceOp,
): Promise<FileStat | undefined> {
  let result: FileStat | undefined;
  switch (op.kind) {
    case 'create':
      result = await deps.fs.createFile(op.path, op.content, {
        ...(op.actor ? { actor: op.actor } : {}),
      });
      break;
    case 'update':
      result = await deps.fs.updateFile(op.path, op.content, op.actor);
      break;
    case 'append':
      result = await deps.fs.appendFile(op.path, op.content, op.actor);
      break;
    case 'delete':
      await deps.fs.deleteFile(op.path);
      break;
    case 'move':
      result = await deps.fs.moveFile(op.from, op.to);
      break;
    case 'copy':
      result = await deps.fs.copyFile(op.from, op.to);
      break;
  }
  const target = 'path' in op ? op.path : `${op.from} -> ${op.to}`;
  void recordAudit(deps.db, deps.dispatch, {
    type: AUDIT_EVENT[op.kind],
    summary: `Workspace ${op.kind}: ${target}`,
    source: 'system',
    risk: op.kind === 'delete' ? 'medium' : 'info',
    status: 'success',
  });
  return result;
}

/** Audit a REJECTED workspace op (nothing is performed). */
export function rejectWorkspaceOp(
  deps: WorkspaceOpsDeps,
  op: WorkspaceOp,
): void {
  const target = 'path' in op ? op.path : `${op.from} -> ${op.to}`;
  void recordAudit(deps.db, deps.dispatch, {
    type: 'workspace.permission_denied',
    summary: `Workspace ${op.kind} rejected: ${target}`,
    source: 'system',
    risk: 'low',
    status: 'rejected',
  });
}
