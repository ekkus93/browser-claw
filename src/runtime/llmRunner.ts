import type { BrowserClawDB } from '../db/db.ts';
import type { AppDispatch } from '../store/store.ts';
import { runStateSet, chatErrored } from '../store/slices/chatSlice.ts';
import { recordAudit } from '../audit/auditSink.ts';
import type { Command, Effect } from './effectTypes.ts';
import type { LlmProvider, ChatMessage } from '../providers/types.ts';
import { describeProviderError } from '../providers/errors.ts';

export interface LlmRequestDeps {
  db: BrowserClawDB;
  dispatch: AppDispatch;
  getProvider: () => LlmProvider;
  /** Feed a command back into the runtime (host.submit). */
  submit: (command: Command) => Promise<void>;
}

/**
 * Handles the runtime's `llm_request` effect: loads the conversation history,
 * calls the active provider, persists the assistant reply to Dexie (so the
 * chat view updates via its live query), and resolves the effect back into the
 * deterministic runtime for its audit record.
 */
export function createLlmRequestHandler(deps: LlmRequestDeps) {
  return async (effect: Extract<Effect, { type: 'llm_request' }>) => {
    const history = await deps.db.messages
      .where('conversationId')
      .equals(effect.conversation_id)
      .sortBy('createdAt');

    const messages: ChatMessage[] = history
      .filter((message) => message.role !== 'tool')
      .map((message) => ({
        role: message.role as ChatMessage['role'],
        content: message.content,
      }));

    let text: string;
    try {
      const result = await deps.getProvider().complete({ messages });
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

    await deps.db.messages.put({
      id: crypto.randomUUID(),
      conversationId: effect.conversation_id,
      role: 'assistant',
      content: text,
      createdAt: Date.now(),
    });
    deps.dispatch(runStateSet('idle'));

    await deps.submit({
      type: 'resolve_effect',
      id: effect.id,
      result: { ok: true, text },
    });
  };
}
