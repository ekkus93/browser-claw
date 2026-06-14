import type { BrowserClawDB } from '../db/db.ts';
import type { AppDispatch } from '../store/store.ts';
import { runStateSet, chatErrored } from '../store/slices/chatSlice.ts';
import { recordAudit } from '../audit/auditSink.ts';
import type { Command, Effect } from './effectTypes.ts';
import type { LlmProvider, ChatMessage } from '../providers/types.ts';
import { describeProviderError } from '../providers/errors.ts';
import type { ApiKeyResolution } from '../providers/providerKey.ts';
import { parseToolCall } from '../tools/tools.ts';
import {
  selectMemoriesForContext,
  formatMemoryContext,
} from '../memories/retrieveMemories.ts';

export interface LlmRequestDeps {
  db: BrowserClawDB;
  dispatch: AppDispatch;
  getProvider: () => LlmProvider;
  /**
   * Resolve the active provider's API key from the SecretVault. Optional: when
   * absent (e.g. mock/local-only setups) the call proceeds with no key.
   */
  getApiKey?: () => Promise<ApiKeyResolution>;
  /** Feed a command back into the runtime (host.submit). */
  submit: (command: Command) => Promise<void>;
}

/**
 * Handles the runtime's `llm_request` effect: loads the conversation history,
 * calls the active provider, and resolves the effect back into the
 * deterministic runtime. The runtime then emits the `storage_put` that persists
 * the assistant reply (handled by the storage effect port — the single source
 * of truth), which the chat view picks up via its live query.
 */
export function createLlmRequestHandler(deps: LlmRequestDeps) {
  return async (effect: Extract<Effect, { type: 'llm_request' }>) => {
    const history = await deps.db.messages
      .where('conversationId')
      .equals(effect.conversation_id)
      .sortBy('createdAt');

    // Include prior tool results in context so the model can use them on a
    // follow-up turn. ChatMessage has no 'tool' role, so a tool message is fed
    // back as user input with a clear prefix.
    const messages: ChatMessage[] = history.map((message) =>
      message.role === 'tool'
        ? { role: 'user', content: `Tool result:\n${message.content}` }
        : {
            role: message.role as ChatMessage['role'],
            content: message.content,
          },
    );

    // Retrieve the API key from the SecretVault just before the call. A locked
    // vault or a missing key fails closed with a specific reason — never a
    // silent unauthenticated request or a fake reply.
    const keyResult: ApiKeyResolution = deps.getApiKey
      ? await deps.getApiKey()
      : { ok: true };
    if (!keyResult.ok) {
      deps.dispatch(
        chatErrored({ kind: keyResult.kind, message: keyResult.message }),
      );
      void recordAudit(deps.db, deps.dispatch, {
        type: 'provider.secret_unavailable',
        summary: `Provider key unavailable (${keyResult.kind})`,
        source: 'provider',
        risk: 'medium',
        status: 'failure',
        conversationId: effect.conversation_id,
      });
      await deps.submit({
        type: 'resolve_effect',
        id: effect.id,
        result: {
          ok: false,
          error: { kind: keyResult.kind, message: keyResult.message },
        },
      });
      return;
    }
    const callOptions =
      keyResult.apiKey !== undefined ? { apiKey: keyResult.apiKey } : undefined;

    // Surface relevant saved memories into the prompt as a system message. This
    // runs only once the call is actually going out (the key resolved), so we
    // never mark a memory used or audit a retrieval for a request that fails to
    // launch. Sensitive memories are excluded by selectMemoriesForContext.
    const lastUserText =
      [...history].reverse().find((message) => message.role === 'user')
        ?.content ?? effect.prompt;
    const retrieved = selectMemoriesForContext(
      await deps.db.memories.toArray(),
      lastUserText,
    );
    if (retrieved.length > 0) {
      messages.unshift({
        role: 'system',
        content: formatMemoryContext(retrieved),
      });
      const usedAt = Date.now();
      await Promise.all(
        retrieved.map((memory) =>
          deps.db.memories.update(memory.id, { lastUsedAt: usedAt }),
        ),
      );
      void recordAudit(deps.db, deps.dispatch, {
        type: 'memory.retrieved',
        summary: `Surfaced ${retrieved.length} ${
          retrieved.length === 1 ? 'memory' : 'memories'
        } into context`,
        source: 'runtime',
        risk: 'info',
        status: 'success',
        conversationId: effect.conversation_id,
        details: {
          memoryIds: retrieved.map((memory) => memory.id),
          count: retrieved.length,
        },
      });
    }

    let text: string;
    try {
      const result = await deps
        .getProvider()
        .complete({ messages }, callOptions);
      text = result.text;
    } catch (error) {
      // Provider failures are NOT written as a fake assistant reply. Surface an
      // error card, audit the failure, and resolve the effect as a failure so
      // the runtime records it (and stores no message). See HARDENING_NOTES.md.
      const failure = describeProviderError(error);
      deps.dispatch(chatErrored(failure));
      void recordAudit(deps.db, deps.dispatch, {
        type: 'provider.request_failed',
        summary: `Provider request failed (${failure.kind})`,
        source: 'provider',
        risk: 'medium',
        status: 'failure',
        conversationId: effect.conversation_id,
      });
      await deps.submit({
        type: 'resolve_effect',
        id: effect.id,
        result: { ok: false, error: failure },
      });
      return;
    }

    deps.dispatch(runStateSet('idle'));

    // If the reply is a tool call, resolve with it so the runtime proposes the
    // tool (subject to skill-permission enforcement + approval) rather than
    // storing the raw block as an assistant message. Otherwise resolve with the
    // reply text; the runtime then emits the storage_put that persists the
    // assistant message (single source of truth — we don't write db.messages
    // here, which would store the reply twice).
    const toolCall = parseToolCall(text);
    await deps.submit({
      type: 'resolve_effect',
      id: effect.id,
      result: toolCall
        ? { ok: true, tool_call: { name: toolCall.name, args: toolCall.args } }
        : { ok: true, text },
    });
  };
}
