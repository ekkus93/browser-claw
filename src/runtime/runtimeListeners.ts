import type { TypedStartListening } from '@reduxjs/toolkit';
import type { RootState, AppDispatch } from '../store/store.ts';
import { userMessageSubmitted } from '../store/slices/chatSlice.ts';
import type { RuntimeHost } from './runtimeHost.ts';

/**
 * Bridges Redux actions to the runtime: when the user submits a message, drive
 * the runtime host, whose emitted effects flow back out through the effect
 * executor (audit, approvals, storage, snapshots). This is the listener-
 * middleware seam between the UI control plane and the deterministic runtime.
 */
export function registerRuntimeListeners(
  startListening: TypedStartListening<RootState, AppDispatch>,
  host: RuntimeHost,
): void {
  startListening({
    actionCreator: userMessageSubmitted,
    effect: async (action) => {
      await host.submit({
        type: 'submit_user_message',
        conversation_id: action.payload.conversationId,
        text: action.payload.text,
      });
    },
  });
}
