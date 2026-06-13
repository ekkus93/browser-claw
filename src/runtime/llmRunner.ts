import type { BrowserClawDB } from '../db/db.ts';
import type { AppDispatch } from '../store/store.ts';
import { runStateSet, chatErrored } from '../store/slices/chatSlice.ts';
import { recordAudit } from '../audit/auditSink.ts';
import type { Command, Effect } from './effectTypes.ts';
import type { LlmProvider, ChatMessage } from '../providers/types.ts';
import { describeProviderError } from '../providers/errors.ts';
import type { ApiKeyResolution } from '../providers/providerKey.ts';

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

    const messages: ChatMessage[] = history
      .filter((message) => message.role !== 'tool')
      .map((message) => ({
        role: message.role as ChatMessage['role'],
        content: message.content,
      }));

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

    // Resolve the effect with the reply; the deterministic runtime then emits
    // the storage_put that persists the assistant message (the single source of
    // truth, handled by the storage effect port). We deliberately do NOT write
    // db.messages here — doing both would store the reply twice.
    await deps.submit({
      type: 'resolve_effect',
      id: effect.id,
      result: { ok: true, text },
    });
  };
}
