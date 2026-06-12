import 'fake-indexeddb/auto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';
import chatReducer from '../store/slices/chatSlice.ts';
import { db } from '../db/db.ts';
import { createLlmRequestHandler } from './llmRunner.ts';
import { createMockProvider } from '../providers/mockProvider.ts';

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
});
