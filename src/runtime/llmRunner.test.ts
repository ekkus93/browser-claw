import 'fake-indexeddb/auto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';
import chatReducer from '../store/slices/chatSlice.ts';
import auditReducer from '../store/slices/auditSlice.ts';
import { db } from '../db/db.ts';
import { createLlmRequestHandler } from './llmRunner.ts';
import { createMockProvider } from '../providers/mockProvider.ts';
import { ProviderError } from '../providers/errors.ts';
import type { LlmProvider } from '../providers/types.ts';

afterAll(() => {
  db.close();
});

describe('createLlmRequestHandler', () => {
  it('resolves the effect with the reply (persistence is the storage port)', async () => {
    await db.open();
    await db.messages.clear();
    const store = configureStore({ reducer: { chat: chatReducer } });
    await db.messages.put({
      id: 'u1',
      conversationId: 'c1',
      role: 'user',
      content: 'hello',
      createdAt: 1,
    });

    const submit = vi
      .fn<(command: unknown) => Promise<void>>()
      .mockResolvedValue(undefined);
    const handler = createLlmRequestHandler({
      db,
      dispatch: store.dispatch,
      getProvider: () => createMockProvider(),
      submit,
    });

    await handler({
      type: 'llm_request',
      id: 'eff-2',
      conversation_id: 'c1',
      prompt: 'hello',
    });

    // The runtime drives persistence via storage_put, so llmRunner must NOT
    // write the assistant message itself (doing both would duplicate it).
    const messages = await db.messages
      .where('conversationId')
      .equals('c1')
      .sortBy('createdAt');
    expect(messages.some((m) => m.role === 'assistant')).toBe(false);
    expect(store.getState().chat.runState).toBe('idle');

    // It resolves the effect with the reply text the runtime will persist.
    const command = submit.mock.calls[0]?.[0];
    expect(command).toMatchObject({
      type: 'resolve_effect',
      id: 'eff-2',
      result: { ok: true },
    });
    expect((command as { result: { text: string } }).result.text).toContain(
      'Mock response',
    );
  });

  it('surfaces a provider failure as an error, never a fake reply', async () => {
    await db.open();
    const store = configureStore({
      reducer: { chat: chatReducer, audit: auditReducer },
    });
    await db.messages.put({
      id: 'u2',
      conversationId: 'c2',
      role: 'user',
      content: 'hello',
      createdAt: 1,
    });

    const failing: LlmProvider = {
      id: 'openai',
      complete: () => Promise.reject(new ProviderError('auth', 'unauthorized')),
      checkHealth: () => Promise.resolve('auth_failed'),
    };
    const submit = vi
      .fn<(command: unknown) => Promise<void>>()
      .mockResolvedValue(undefined);
    const handler = createLlmRequestHandler({
      db,
      dispatch: store.dispatch,
      getProvider: () => failing,
      submit,
    });

    await handler({
      type: 'llm_request',
      id: 'eff-2',
      conversation_id: 'c2',
      prompt: 'hello',
    });

    // No assistant message was written.
    const messages = await db.messages
      .where('conversationId')
      .equals('c2')
      .sortBy('createdAt');
    expect(messages.some((m) => m.role === 'assistant')).toBe(false);

    // The error surfaced and the failure was audited.
    expect(store.getState().chat.runState).toBe('error');
    expect(store.getState().chat.error?.kind).toBe('auth');
    expect(
      store
        .getState()
        .audit.recent.some((e) => e.type === 'provider.request_failed'),
    ).toBe(true);

    // The effect resolved as a failure.
    expect(submit.mock.calls[0]?.[0]).toMatchObject({
      type: 'resolve_effect',
      id: 'eff-2',
      result: { ok: false },
    });
  });

  it('blocks the call with secret_locked when the key cannot be resolved', async () => {
    await db.open();
    const store = configureStore({
      reducer: { chat: chatReducer, audit: auditReducer },
    });
    await db.messages.put({
      id: 'u3',
      conversationId: 'c3',
      role: 'user',
      content: 'hello',
      createdAt: 1,
    });

    const complete = vi.fn();
    const provider: LlmProvider = {
      id: 'openai',
      complete,
      checkHealth: () => Promise.resolve('auth_failed'),
    };
    const submit = vi
      .fn<(command: unknown) => Promise<void>>()
      .mockResolvedValue(undefined);
    const handler = createLlmRequestHandler({
      db,
      dispatch: store.dispatch,
      getProvider: () => provider,
      getApiKey: () =>
        Promise.resolve({
          ok: false,
          kind: 'secret_locked',
          message: 'locked',
        }),
      submit,
    });

    await handler({
      type: 'llm_request',
      id: 'eff-3',
      conversation_id: 'c3',
      prompt: 'hello',
    });

    // The provider was never called, and no assistant message was written.
    expect(complete).not.toHaveBeenCalled();
    const messages = await db.messages
      .where('conversationId')
      .equals('c3')
      .sortBy('createdAt');
    expect(messages.some((m) => m.role === 'assistant')).toBe(false);

    expect(store.getState().chat.error?.kind).toBe('secret_locked');
    expect(
      store
        .getState()
        .audit.recent.some((e) => e.type === 'provider.secret_unavailable'),
    ).toBe(true);
    expect(submit.mock.calls[0]?.[0]).toMatchObject({
      result: { ok: false, error: { kind: 'secret_locked' } },
    });
  });

  it('passes the resolved API key to the provider', async () => {
    await db.open();
    const store = configureStore({ reducer: { chat: chatReducer } });
    await db.messages.put({
      id: 'u4',
      conversationId: 'c4',
      role: 'user',
      content: 'hello',
      createdAt: 1,
    });

    const complete = vi
      .fn<LlmProvider['complete']>()
      .mockResolvedValue({ text: 'hi' });
    const provider: LlmProvider = {
      id: 'openai',
      complete,
      checkHealth: () => Promise.resolve('connected'),
    };
    const handler = createLlmRequestHandler({
      db,
      dispatch: store.dispatch,
      getProvider: () => provider,
      getApiKey: () => Promise.resolve({ ok: true, apiKey: 'sk-runtime' }),
      submit: vi
        .fn<(c: unknown) => Promise<void>>()
        .mockResolvedValue(undefined),
    });

    await handler({
      type: 'llm_request',
      id: 'eff-4',
      conversation_id: 'c4',
      prompt: 'hello',
    });

    expect(complete).toHaveBeenCalledWith(expect.anything(), {
      apiKey: 'sk-runtime',
    });
  });
});
