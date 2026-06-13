import type { Command, Effect } from './effectTypes.ts';

/**
 * A faithful TypeScript port of the deterministic `claw-core` runtime
 * (crates/claw-core). It lets the host run the effect pipeline before the
 * wasm build is wired in; the WASM `ClawRuntime` satisfies the same port, so
 * swapping it in is a drop-in change.
 */

export interface RuntimeSnapshot {
  next_effect_id: number;
  message_count: number;
  pending: Record<string, string>;
  /**
   * Outstanding effect id -> originating conversation id, so an effect resolved
   * later (e.g. a stored assistant message) stays conversation scoped. Additive
   * + defaulted: snapshots predating this field restore with it empty.
   */
  pending_conversation: Record<string, string>;
}

/**
 * Bump whenever the persisted RuntimeSnapshot shape changes in a way an older
 * or newer runtime cannot faithfully restore. A stored snapshot stamped with a
 * different version is discarded on load (never restored into a runtime that
 * would misinterpret it). See loadLatestSnapshot in runtimeHost.ts.
 */
export const SNAPSHOT_SCHEMA_VERSION = 1;

export interface ClawRuntimePort {
  dispatch(command: Command): Effect[];
  snapshot(): RuntimeSnapshot;
}

function readText(result: unknown): string {
  if (
    typeof result === 'object' &&
    result !== null &&
    'text' in result &&
    typeof (result as { text: unknown }).text === 'string'
  ) {
    return (result as { text: string }).text;
  }
  return '';
}

/** A resolution is a failure when the host marks it `ok: false` or `error`. */
function isFailure(result: unknown): boolean {
  if (typeof result !== 'object' || result === null) return false;
  const record = result as Record<string, unknown>;
  return record.ok === false || 'error' in record;
}

export function createReferenceRuntime(
  initial?: RuntimeSnapshot,
): ClawRuntimePort {
  const state: RuntimeSnapshot = initial
    ? {
        next_effect_id: initial.next_effect_id,
        message_count: initial.message_count,
        pending: { ...initial.pending },
        // Tolerate snapshots written before this field existed.
        pending_conversation: { ...(initial.pending_conversation ?? {}) },
      }
    : {
        next_effect_id: 0,
        message_count: 0,
        pending: {},
        pending_conversation: {},
      };

  function nextId(): string {
    state.next_effect_id += 1;
    return `eff-${state.next_effect_id}`;
  }

  return {
    dispatch(command) {
      if (command.type === 'submit_user_message') {
        state.message_count += 1;
        const auditId = nextId();
        const llmId = nextId();
        state.pending[llmId] = 'llm_request';
        // Remember the conversation so the message stored when this resolves
        // stays correctly scoped.
        state.pending_conversation[llmId] = command.conversation_id;
        return [
          {
            type: 'audit_append',
            id: auditId,
            event_type: 'llm_request_sent',
            summary: 'User message submitted',
            risk: 'info',
          },
          {
            type: 'llm_request',
            id: llmId,
            conversation_id: command.conversation_id,
            prompt: command.text,
          },
        ];
      }

      const kind = state.pending[command.id];
      delete state.pending[command.id];
      const conversationId = state.pending_conversation[command.id] ?? '';
      delete state.pending_conversation[command.id];
      if (kind === 'llm_request') {
        // A failed provider call stores no assistant message — it is audited
        // as a failure so the runtime never claims a reply it didn't get.
        if (isFailure(command.result)) {
          return [
            {
              type: 'audit_append',
              id: nextId(),
              event_type: 'llm_request_failed',
              summary: 'Provider request failed',
              risk: 'medium',
            },
          ];
        }
        state.message_count += 1;
        const putId = nextId();
        const auditId = nextId();
        return [
          {
            type: 'storage_put',
            id: putId,
            conversation_id: conversationId,
            store: 'messages',
            key: `m${state.message_count}`,
            value: { role: 'assistant', content: readText(command.result) },
          },
          {
            type: 'audit_append',
            id: auditId,
            event_type: 'llm_response_received',
            summary: 'Assistant message stored',
            risk: 'info',
          },
        ];
      }
      return [];
    },

    snapshot() {
      return {
        next_effect_id: state.next_effect_id,
        message_count: state.message_count,
        pending: { ...state.pending },
        pending_conversation: { ...state.pending_conversation },
      };
    },
  };
}
