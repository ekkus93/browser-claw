import { configureStore, createListenerMiddleware } from '@reduxjs/toolkit';
import { describe, expect, it, vi } from 'vitest';
import chatReducer, {
  userMessageSubmitted,
} from '../store/slices/chatSlice.ts';
import { registerRuntimeListeners } from './runtimeListeners.ts';
import type { RuntimeHost } from './runtimeHost.ts';

describe('registerRuntimeListeners', () => {
  it('submits a runtime command when a user message is dispatched', async () => {
    const submit = vi.fn<RuntimeHost['submit']>().mockResolvedValue(undefined);
    const host = { submit } as unknown as RuntimeHost;

    const listener = createListenerMiddleware();
    const store = configureStore({
      reducer: { chat: chatReducer },
      middleware: (getDefault) => getDefault().prepend(listener.middleware),
    });
    registerRuntimeListeners(listener.startListening as never, host);

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
    });
  });
});
