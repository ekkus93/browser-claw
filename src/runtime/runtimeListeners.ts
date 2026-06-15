import type { TypedStartListening } from '@reduxjs/toolkit';
import type { RootState, AppDispatch } from '../store/store.ts';
import type { BrowserClawDB } from '../db/db.ts';
import { userMessageSubmitted } from '../store/slices/chatSlice.ts';
import {
  approvalResolved,
  approvalEdited,
} from '../store/slices/approvalsSlice.ts';
import { recordAudit } from '../audit/auditSink.ts';
import type { RuntimeHost } from './runtimeHost.ts';
import { runApprovedToolCall } from './toolRunner.ts';
import type { ApprovedPlan } from './planRunner.ts';
import type { ApprovedSandboxScript } from './sandboxScriptRunner.ts';
import type { ApprovedWorkspaceOp } from './workspaceRunner.ts';
import type { ApprovedWebPageRead, ApprovedBulkResearch } from './webRunner.ts';
import type { ApprovedExtensionPermission } from './extensionRunner.ts';

export interface RuntimeListenerDeps {
  db: BrowserClawDB;
  /** Resolves a `plan` approval through the plan effect bridge (Part C5/F3). */
  resolvePlanApproval?: (approval: ApprovedPlan) => Promise<void>;
  /** Resolves a `sandbox_script` approval through the sandbox bridge (F3). */
  resolveSandboxApproval?: (approval: ApprovedSandboxScript) => Promise<void>;
  /** Resolves a `workspace_write`/`workspace_delete` approval (Part B6/F3). */
  resolveWorkspaceApproval?: (approval: ApprovedWorkspaceOp) => Promise<void>;
  /** Resolves a `web_page_read` approval through the web bridge (Part F3). */
  resolveWebPageReadApproval?: (approval: ApprovedWebPageRead) => Promise<void>;
  /** Resolves a `bulk_research` approval through the web bridge (Part F3). */
  resolveBulkResearchApproval?: (
    approval: ApprovedBulkResearch,
  ) => Promise<void>;
  /** Resolves an `extension_permission` approval through the extension bridge. */
  resolveExtensionPermissionApproval?: (
    approval: ApprovedExtensionPermission,
  ) => Promise<void>;
}

/**
 * Bridges Redux actions to the runtime: when the user submits a message, drive
 * the runtime host, whose emitted effects flow back out through the effect
 * executor (audit, approvals, storage, snapshots). When the user resolves a
 * tool-call approval, run (or decline) the tool and resolve the effect back so
 * the runtime continues the turn. This is the listener-middleware seam between
 * the UI control plane and the deterministic runtime.
 */
export function registerRuntimeListeners(
  startListening: TypedStartListening<RootState, AppDispatch>,
  host: RuntimeHost,
  deps: RuntimeListenerDeps,
): void {
  startListening({
    actionCreator: userMessageSubmitted,
    effect: async (action, api) => {
      // Attribute this turn's tool calls to the chat's active skill (if any) so
      // they're enforced against that skill's declared tools.
      const skillId = api.getState().chat.activeSkillId ?? '';
      await host.submit({
        type: 'submit_user_message',
        conversation_id: action.payload.conversationId,
        text: action.payload.text,
        skill_id: skillId,
      });
    },
  });

  startListening({
    actionCreator: approvalResolved,
    effect: async (action, api) => {
      // Read the entry from the pre-action state so it's still present even if
      // the UI dismisses it immediately after resolving.
      const approval = api
        .getOriginalState()
        .approvals.queue.find((a) => a.id === action.payload.id);
      if (!approval) return;

      // A plan or sandboxed-script approval resolves through its own effect
      // bridge (F3); each runs (or declines) the proposal and resolves the
      // runtime effect so the turn continues.
      if (approval.kind === 'plan') {
        await deps.resolvePlanApproval?.({
          id: approval.id,
          status: action.payload.status,
          ...(approval.payloadPreview !== undefined
            ? { payloadPreview: approval.payloadPreview }
            : {}),
        });
        return;
      }
      if (approval.kind === 'sandbox_script') {
        await deps.resolveSandboxApproval?.({
          id: approval.id,
          status: action.payload.status,
          ...(approval.payloadPreview !== undefined
            ? { payloadPreview: approval.payloadPreview }
            : {}),
        });
        return;
      }
      if (
        approval.kind === 'workspace_write' ||
        approval.kind === 'workspace_delete'
      ) {
        await deps.resolveWorkspaceApproval?.({
          id: approval.id,
          status: action.payload.status,
          ...(approval.payloadPreview !== undefined
            ? { payloadPreview: approval.payloadPreview }
            : {}),
        });
        return;
      }
      if (approval.kind === 'web_page_read') {
        await deps.resolveWebPageReadApproval?.({
          id: approval.id,
          status: action.payload.status,
          ...(approval.payloadPreview !== undefined
            ? { payloadPreview: approval.payloadPreview }
            : {}),
        });
        return;
      }
      if (approval.kind === 'bulk_research') {
        await deps.resolveBulkResearchApproval?.({
          id: approval.id,
          status: action.payload.status,
          ...(approval.payloadPreview !== undefined
            ? { payloadPreview: approval.payloadPreview }
            : {}),
        });
        return;
      }
      if (approval.kind === 'extension_permission') {
        await deps.resolveExtensionPermissionApproval?.({
          id: approval.id,
          status: action.payload.status,
          ...(approval.payloadPreview !== undefined
            ? { payloadPreview: approval.payloadPreview }
            : {}),
        });
        return;
      }

      if (approval.kind !== 'tool_call') return;
      // Provenance for a persisting tool: the skill that requested it and the
      // conversation it was approved in.
      const conversationId =
        api.getOriginalState().chat.activeConversationId ?? '';
      await runApprovedToolCall(
        { db: deps.db, dispatch: api.dispatch, submit: (c) => host.submit(c) },
        {
          id: approval.id,
          status: action.payload.status,
          // The (possibly edited) args the user reviewed are the source of truth.
          argsJson: approval.payloadPreview,
          conversationId,
          ...(approval.toolName !== undefined
            ? { toolName: approval.toolName }
            : {}),
          ...(approval.skillId !== undefined
            ? { skillId: approval.skillId }
            : {}),
        },
      );
    },
  });

  startListening({
    actionCreator: approvalEdited,
    effect: (action, api) => {
      // The edit already updated payloadPreview; record that the user changed
      // the proposed tool's args before approving (audited tool lifecycle).
      const approval = api
        .getState()
        .approvals.queue.find((a) => a.id === action.payload.id);
      if (!approval || approval.kind !== 'tool_call') return;
      void recordAudit(deps.db, api.dispatch, {
        type: 'tool.edited',
        summary: `Tool '${approval.toolName ?? approval.title}' arguments edited`,
        source: 'skill',
        risk: 'info',
        status: 'pending',
        toolName: approval.toolName ?? approval.title,
      });
    },
  });
}
