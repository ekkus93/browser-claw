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
}

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

export function createReferenceRuntime(
  initial?: RuntimeSnapshot,
): ClawRuntimePort {
  const state: RuntimeSnapshot = initial
    ? {
        next_effect_id: initial.next_effect_id,
        message_count: initial.message_count,
        pending: { ...initial.pending },
      }
    : { next_effect_id: 0, message_count: 0, pending: {} };

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
      if (kind === 'llm_request') {
        state.message_count += 1;
        const putId = nextId();
        const auditId = nextId();
        return [
          {
            type: 'storage_put',
            id: putId,
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
      };
    },
  };
}
