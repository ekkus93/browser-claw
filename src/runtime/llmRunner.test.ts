import 'fake-indexeddb/auto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';
import chatReducer from '../store/slices/chatSlice.ts';
import auditReducer from '../store/slices/auditSlice.ts';
import { db } from '../db/db.ts';
import { createLlmRequestHandler } from './llmRunner.ts';
import type { FallbackTarget } from './llmRunner.ts';
import { createMockProvider } from '../providers/mockProvider.ts';
import { ProviderError } from '../providers/errors.ts';
import type { ApiKeyResolution } from '../providers/providerKey.ts';
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

  it('resolves with a tool_call when the reply contains a tool block', async () => {
    await db.open();
    await db.messages.clear();
    const store = configureStore({ reducer: { chat: chatReducer } });
    await db.messages.put({
      id: 'u5',
      conversationId: 'c5',
      role: 'user',
      content: 'read the page',
      createdAt: 1,
    });
    const provider: LlmProvider = {
      id: 'mock',
      complete: () =>
        Promise.resolve({
          text: '```tool\n{ "tool": "Page Reader", "args": { "url": "https://x" } }\n```',
        }),
      checkHealth: () => Promise.resolve('connected'),
    };
    const submit = vi
      .fn<(command: unknown) => Promise<void>>()
      .mockResolvedValue(undefined);
    const handler = createLlmRequestHandler({
      db,
      dispatch: store.dispatch,
      getProvider: () => provider,
      submit,
    });

    await handler({
      type: 'llm_request',
      id: 'eff-2',
      conversation_id: 'c5',
      prompt: 'read the page',
    });

    expect(submit.mock.calls[0]?.[0]).toMatchObject({
      type: 'resolve_effect',
      id: 'eff-2',
      result: {
        ok: true,
        tool_call: { name: 'Page Reader', args: { url: 'https://x' } },
      },
    });
  });

  it('surfaces a relevant memory into the prompt, marks it used, and audits the retrieval', async () => {
    await db.open();
    await db.messages.clear();
    await db.memories.clear();
    const store = configureStore({
      reducer: { chat: chatReducer, audit: auditReducer },
    });
    await db.messages.put({
      id: 'u7',
      conversationId: 'c7',
      role: 'user',
      content: 'remind me about rust ownership',
      createdAt: 1,
    });
    await db.memories.bulkPut([
      {
        id: 'mem-rust',
        title: 'Rust ownership',
        text: 'the borrow checker enforces ownership',
        tags: ['rust'],
        source: 'skill',
        createdBy: 'assistant',
        createdAt: 1,
        pinned: false,
        sensitivity: 'normal',
      },
      {
        id: 'mem-other',
        title: 'Pasta',
        text: 'boil water and add salt',
        tags: [],
        source: 'user',
        createdBy: 'user',
        createdAt: 1,
        pinned: false,
        sensitivity: 'normal',
      },
    ]);

    const complete = vi
      .fn<LlmProvider['complete']>()
      .mockResolvedValue({ text: 'sure' });
    const handler = createLlmRequestHandler({
      db,
      dispatch: store.dispatch,
      getProvider: () => ({
        id: 'mock',
        complete,
        checkHealth: () => Promise.resolve('connected'),
      }),
      submit: vi
        .fn<(c: unknown) => Promise<void>>()
        .mockResolvedValue(undefined),
    });

    await handler({
      type: 'llm_request',
      id: 'eff-7',
      conversation_id: 'c7',
      prompt: 'remind me about rust ownership',
    });

    // The relevant memory is injected as a leading system message; the
    // irrelevant one is not.
    const sent = complete.mock.calls[0]?.[0].messages ?? [];
    expect(sent[0]?.role).toBe('system');
    expect(sent[0]?.content).toContain('Rust ownership');
    expect(sent[0]?.content).not.toContain('Pasta');

    // The surfaced memory is marked used; the untouched one is not.
    expect((await db.memories.get('mem-rust'))?.lastUsedAt).toBeGreaterThan(0);
    expect((await db.memories.get('mem-other'))?.lastUsedAt).toBeUndefined();

    // The retrieval is audited.
    expect(
      store.getState().audit.recent.some((e) => e.type === 'memory.retrieved'),
    ).toBe(true);
  });

  it('feeds a prior tool result back into the model as context', async () => {
    await db.open();
    await db.messages.clear();
    const store = configureStore({ reducer: { chat: chatReducer } });
    await db.messages.bulkPut([
      {
        id: 'u6',
        conversationId: 'c6',
        role: 'user',
        content: 'read it',
        createdAt: 1,
      },
      {
        id: 't6',
        conversationId: 'c6',
        role: 'tool',
        content: 'PAGE BODY',
        createdAt: 2,
      },
    ]);
    const complete = vi
      .fn<LlmProvider['complete']>()
      .mockResolvedValue({ text: 'done' });
    const handler = createLlmRequestHandler({
      db,
      dispatch: store.dispatch,
      getProvider: () => ({
        id: 'mock',
        complete,
        checkHealth: () => Promise.resolve('connected'),
      }),
      submit: vi
        .fn<(c: unknown) => Promise<void>>()
        .mockResolvedValue(undefined),
    });

    await handler({
      type: 'llm_request',
      id: 'eff-2',
      conversation_id: 'c6',
      prompt: '',
    });

    const sent = complete.mock.calls[0]?.[0].messages ?? [];
    // The tool result is included (as user-prefixed context), not dropped.
    expect(sent).toContainEqual({
      role: 'user',
      content: 'Tool result:\nPAGE BODY',
    });
  });

  describe('fallback provider failover', () => {
    function fallbackTarget(
      complete: LlmProvider['complete'],
      key: ApiKeyResolution,
    ): FallbackTarget {
      return {
        id: 'anthropic',
        provider: {
          id: 'anthropic',
          complete,
          checkHealth: () => Promise.resolve('connected' as const),
        },
        getApiKey: () => Promise.resolve(key),
      };
    }

    async function seedUser(conversationId: string) {
      await db.open();
      await db.messages.clear();
      await db.memories.clear();
      await db.messages.put({
        id: `u-${conversationId}`,
        conversationId,
        role: 'user',
        content: 'hi',
        createdAt: 1,
      });
    }

    it('fails over to the fallback on an unreachable primary error', async () => {
      await seedUser('cf1');
      const store = configureStore({
        reducer: { chat: chatReducer, audit: auditReducer },
      });
      const primary: LlmProvider = {
        id: 'openai',
        complete: () =>
          Promise.reject(new ProviderError('unreachable', 'down')),
        checkHealth: () => Promise.resolve('connected'),
      };
      const fallbackComplete = vi
        .fn<LlmProvider['complete']>()
        .mockResolvedValue({ text: 'from fallback' });
      const submit = vi
        .fn<(c: unknown) => Promise<void>>()
        .mockResolvedValue(undefined);
      const handler = createLlmRequestHandler({
        db,
        dispatch: store.dispatch,
        getProvider: () => primary,
        resolveFallback: () =>
          Promise.resolve(
            fallbackTarget(fallbackComplete, { ok: true, apiKey: 'sk-fb' }),
          ),
        submit,
      });

      await handler({
        type: 'llm_request',
        id: 'eff-f1',
        conversation_id: 'cf1',
        prompt: 'hi',
      });

      // The fallback ran (with its OWN key) and its reply resolved the effect.
      expect(fallbackComplete).toHaveBeenCalledWith(expect.anything(), {
        apiKey: 'sk-fb',
      });
      expect(submit).toHaveBeenCalledWith({
        type: 'resolve_effect',
        id: 'eff-f1',
        result: { ok: true, text: 'from fallback' },
      });
      // Failover is never silent — it's audited.
      expect(
        store
          .getState()
          .audit.recent.some((e) => e.type === 'provider.failover_used'),
      ).toBe(true);
      expect(store.getState().chat.runState).toBe('idle');
    });

    it('does NOT fail over on an auth error (surfaces it, fallback untouched)', async () => {
      await seedUser('cf2');
      const store = configureStore({
        reducer: { chat: chatReducer, audit: auditReducer },
      });
      const primary: LlmProvider = {
        id: 'openai',
        complete: () => Promise.reject(new ProviderError('auth', 'bad key')),
        checkHealth: () => Promise.resolve('auth_failed'),
      };
      const resolveFallback = vi.fn();
      const submit = vi
        .fn<(c: unknown) => Promise<void>>()
        .mockResolvedValue(undefined);
      const handler = createLlmRequestHandler({
        db,
        dispatch: store.dispatch,
        getProvider: () => primary,
        resolveFallback,
        submit,
      });

      await handler({
        type: 'llm_request',
        id: 'eff-f2',
        conversation_id: 'cf2',
        prompt: 'hi',
      });

      expect(resolveFallback).not.toHaveBeenCalled();
      expect(submit).toHaveBeenCalledWith({
        type: 'resolve_effect',
        id: 'eff-f2',
        result: { ok: false, error: expect.objectContaining({ kind: 'auth' }) },
      });
      expect(
        store
          .getState()
          .audit.recent.some((e) => e.type === 'provider.failover_used'),
      ).toBe(false);
    });

    it('skips failover when the fallback key is locked (surfaces the original error)', async () => {
      await seedUser('cf3');
      const store = configureStore({
        reducer: { chat: chatReducer, audit: auditReducer },
      });
      const primary: LlmProvider = {
        id: 'openai',
        complete: () =>
          Promise.reject(new ProviderError('unreachable', 'down')),
        checkHealth: () => Promise.resolve('connected'),
      };
      const fallbackComplete = vi.fn<LlmProvider['complete']>();
      const submit = vi
        .fn<(c: unknown) => Promise<void>>()
        .mockResolvedValue(undefined);
      const handler = createLlmRequestHandler({
        db,
        dispatch: store.dispatch,
        getProvider: () => primary,
        resolveFallback: () =>
          Promise.resolve(
            fallbackTarget(fallbackComplete, {
              ok: false,
              kind: 'secret_locked',
              message: 'locked',
            }),
          ),
        submit,
      });

      await handler({
        type: 'llm_request',
        id: 'eff-f3',
        conversation_id: 'cf3',
        prompt: 'hi',
      });

      // Fail-closed: no unauthenticated fallback call, original error surfaced.
      expect(fallbackComplete).not.toHaveBeenCalled();
      expect(submit).toHaveBeenCalledWith({
        type: 'resolve_effect',
        id: 'eff-f3',
        result: {
          ok: false,
          error: expect.objectContaining({ kind: 'unreachable' }),
        },
      });
    });

    it("surfaces the fallback's error when the fallback also fails", async () => {
      await seedUser('cf4');
      const store = configureStore({
        reducer: { chat: chatReducer, audit: auditReducer },
      });
      const primary: LlmProvider = {
        id: 'openai',
        complete: () =>
          Promise.reject(new ProviderError('unreachable', 'down')),
        checkHealth: () => Promise.resolve('connected'),
      };
      const fallbackComplete = vi
        .fn<LlmProvider['complete']>()
        .mockRejectedValue(new ProviderError('cors', 'blocked'));
      const submit = vi
        .fn<(c: unknown) => Promise<void>>()
        .mockResolvedValue(undefined);
      const handler = createLlmRequestHandler({
        db,
        dispatch: store.dispatch,
        getProvider: () => primary,
        resolveFallback: () =>
          Promise.resolve(
            fallbackTarget(fallbackComplete, { ok: true, apiKey: 'sk-fb' }),
          ),
        submit,
      });

      await handler({
        type: 'llm_request',
        id: 'eff-f4',
        conversation_id: 'cf4',
        prompt: 'hi',
      });

      // The last attempt's (fallback's) error is what the user sees.
      expect(submit).toHaveBeenCalledWith({
        type: 'resolve_effect',
        id: 'eff-f4',
        result: { ok: false, error: expect.objectContaining({ kind: 'cors' }) },
      });
      expect(
        store
          .getState()
          .audit.recent.some((e) => e.type === 'provider.failover_used'),
      ).toBe(false);
    });
  });
});
