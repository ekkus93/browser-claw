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
  it('persists the assistant reply and resolves the effect', async () => {
    await db.open();
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

    const messages = await db.messages
      .where('conversationId')
      .equals('c1')
      .sortBy('createdAt');
    const assistant = messages.find((m) => m.role === 'assistant');
    expect(assistant?.content).toContain('Mock response');
    expect(store.getState().chat.runState).toBe('idle');

    const command = submit.mock.calls[0]?.[0];
    expect(command).toMatchObject({ type: 'resolve_effect', id: 'eff-2' });
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
      complete: () =>
        Promise.reject(new ProviderError('auth', 'unauthorized')),
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
      store.getState().audit.recent.some((e) => e.type === 'provider.request_failed'),
    ).toBe(true);

    // The effect resolved as a failure.
    expect(submit.mock.calls[0]?.[0]).toMatchObject({
      type: 'resolve_effect',
      id: 'eff-2',
      result: { ok: false },
    });
  });
});
