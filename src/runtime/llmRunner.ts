import type { BrowserClawDB } from '../db/db.ts';
import type { AppDispatch } from '../store/store.ts';
import { runStateSet } from '../store/slices/chatSlice.ts';
import type { Command, Effect } from './effectTypes.ts';
import type { LlmProvider, ChatMessage } from '../providers/types.ts';
import { ProviderError } from '../providers/errors.ts';

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
      text =
        error instanceof ProviderError
          ? `The provider could not respond (${error.kind}).`
          : 'The model could not respond.';
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
      result: { text },
    });
  };
}
