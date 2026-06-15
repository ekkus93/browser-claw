import type { BrowserClawDB } from '../db/db.ts';
import type { AppDispatch } from '../store/store.ts';
import { recordAudit } from '../audit/auditSink.ts';
import type { MessageRole } from '../db/types.ts';
import type { Effect } from './effectTypes.ts';

type StorageEffect = Extract<
  Effect,
  { type: 'storage_get' | 'storage_put' | 'storage_search' }
>;

export interface StorageEffectDeps {
  db: BrowserClawDB;
  dispatch: AppDispatch;
  /** Clock for the persisted row's createdAt (impure side). */
  now?: () => number;
}

const MESSAGE_ROLES: readonly MessageRole[] = [
  'user',
  'assistant',
  'system',
  'tool',
];

/**
 * Handles the runtime's durable storage effects. Today the deterministic
 * runtime only emits `storage_put { store: 'messages' }` (the assistant reply
 * when an llm_request resolves); this is the single source of truth for that
 * write, so the message persists exactly once. The handler fails closed: an
 * unknown store, an unsupported op, or a malformed record is audited and
 * thrown rather than silently performed or skipped (see TODO 5.1 / 1.2).
 *
 * Idempotency (hardening A2.1): the persisted row id is DERIVED deterministically
 * from the effect (`conversation_id` + the runtime's stable per-message `key`,
 * e.g. `m3`), so replaying the same `storage_put` — e.g. after a snapshot
 * restore — upserts the same row instead of creating a duplicate message.
 */
export function createStorageEffectHandler(deps: StorageEffectDeps) {
  async function fail(effect: StorageEffect, reason: string): Promise<never> {
    const message = `Storage ${effect.type} failed: ${reason}`;
    await recordAudit(deps.db, deps.dispatch, {
      type: 'storage.effect_failed',
      summary: message,
      source: 'storage',
      risk: 'medium',
      status: 'failure',
    });
    throw new Error(message);
  }

  return async (effect: StorageEffect): Promise<void> => {
    // Only storage_put is produced by the runtime today; get/search aren't
    // backed by a real query yet, so fail closed instead of pretending.
    if (effect.type !== 'storage_put') {
      return fail(effect, `${effect.type} is not supported yet`);
    }
    if (effect.store !== 'messages') {
      return fail(effect, `unknown store '${effect.store}'`);
    }

    const value = effect.value as { role?: unknown; content?: unknown };
    const role = value.role;
    const content = value.content;
    if (
      typeof role !== 'string' ||
      !MESSAGE_ROLES.includes(role as MessageRole) ||
      typeof content !== 'string'
    ) {
      return fail(effect, 'invalid message record');
    }

    const now = deps.now ?? Date.now;
    // Deterministic id so a replay of the same effect upserts, not duplicates.
    await deps.db.messages.put({
      id: `${effect.conversation_id}:${effect.key}`,
      conversationId: effect.conversation_id,
      role: role as MessageRole,
      content,
      createdAt: now(),
    });
  };
}
