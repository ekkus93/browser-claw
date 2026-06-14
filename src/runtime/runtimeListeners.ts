import type { TypedStartListening } from '@reduxjs/toolkit';
import type { RootState, AppDispatch } from '../store/store.ts';
import type { BrowserClawDB } from '../db/db.ts';
import { userMessageSubmitted } from '../store/slices/chatSlice.ts';
import { approvalResolved } from '../store/slices/approvalsSlice.ts';
import type { RuntimeHost } from './runtimeHost.ts';
import { runApprovedToolCall } from './toolRunner.ts';

export interface RuntimeListenerDeps {
  db: BrowserClawDB;
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
      if (!approval || approval.kind !== 'tool_call') return;
      await runApprovedToolCall(
        { db: deps.db, dispatch: api.dispatch, submit: (c) => host.submit(c) },
        {
          id: approval.id,
          status: action.payload.status,
          ...(approval.toolName !== undefined
            ? { toolName: approval.toolName }
            : {}),
          toolArgs: approval.toolArgs,
        },
      );
    },
  });
}
