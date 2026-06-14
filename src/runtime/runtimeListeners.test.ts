import 'fake-indexeddb/auto';
import { configureStore, createListenerMiddleware } from '@reduxjs/toolkit';
import { describe, expect, it, vi } from 'vitest';
import chatReducer, {
  userMessageSubmitted,
  activeSkillSet,
} from '../store/slices/chatSlice.ts';
import approvalsReducer, {
  approvalRequested,
  approvalResolved,
} from '../store/slices/approvalsSlice.ts';
import { registerRuntimeListeners } from './runtimeListeners.ts';
import type { RuntimeHost } from './runtimeHost.ts';
import { BrowserClawDB } from '../db/db.ts';

const db = new BrowserClawDB();

function setup() {
  const submit = vi.fn<RuntimeHost['submit']>().mockResolvedValue(undefined);
  const host = { submit } as unknown as RuntimeHost;
  const listener = createListenerMiddleware();
  const store = configureStore({
    reducer: { chat: chatReducer, approvals: approvalsReducer },
    middleware: (getDefault) => getDefault().prepend(listener.middleware),
  });
  registerRuntimeListeners(listener.startListening as never, host, { db });
  return { submit, store };
}

describe('registerRuntimeListeners', () => {
  it('submits a runtime command when a user message is dispatched', async () => {
    const { submit, store } = setup();

    store.dispatch(
      userMessageSubmitted({ conversationId: 'c1', text: 'hello' }),
    );
    // reducer moves the run state immediately
    expect(store.getState().chat.runState).toBe('thinking');

    // the listener drives the host asynchronously
    await vi.waitFor(() => expect(submit).toHaveBeenCalled());
    expect(submit).toHaveBeenCalledWith({
      type: 'submit_user_message',
      conversation_id: 'c1',
      text: 'hello',
      skill_id: '',
    });
  });

  it('attributes the turn to the chat active skill', async () => {
    const { submit, store } = setup();
    store.dispatch(activeSkillSet('web-search'));

    store.dispatch(userMessageSubmitted({ conversationId: 'c1', text: 'hi' }));

    await vi.waitFor(() => expect(submit).toHaveBeenCalled());
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({ skill_id: 'web-search' }),
    );
  });

  it('resolves a rejected tool-call approval back into the runtime', async () => {
    const { submit, store } = setup();
    store.dispatch(
      approvalRequested({
        id: 'eff-3',
        kind: 'tool_call',
        title: 'Page Reader',
        risk: 'medium',
        summary: 'Tool call: Page Reader',
        payloadPreview: '{}',
        toolName: 'Page Reader',
        toolArgs: {},
      }),
    );

    store.dispatch(approvalResolved({ id: 'eff-3', status: 'rejected' }));

    await vi.waitFor(() => expect(submit).toHaveBeenCalled());
    expect(submit).toHaveBeenCalledWith({
      type: 'resolve_effect',
      id: 'eff-3',
      result: { ok: false, error: { kind: 'user_rejected' } },
    });
  });
});
