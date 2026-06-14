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
  /**
   * Outstanding effect id -> originating skill id, so a tool call proposed from
   * a turn stays attributed to the skill that may run it. Additive + defaulted.
   */
  pending_skill: Record<string, string>;
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

/** A `{ tool_call: { name, args } }` resolution means the model wants a tool. */
function readToolCall(result: unknown): { name: string; args: unknown } | null {
  if (typeof result !== 'object' || result === null) return null;
  const call = (result as Record<string, unknown>).tool_call;
  if (typeof call !== 'object' || call === null) return null;
  const name = (call as Record<string, unknown>).name;
  if (typeof name !== 'string' || name.length === 0) return null;
  return { name, args: (call as Record<string, unknown>).args ?? null };
}

export function createReferenceRuntime(
  initial?: RuntimeSnapshot,
): ClawRuntimePort {
  const state: RuntimeSnapshot = initial
    ? {
        next_effect_id: initial.next_effect_id,
        message_count: initial.message_count,
        pending: { ...initial.pending },
        // Tolerate snapshots written before these fields existed.
        pending_conversation: { ...(initial.pending_conversation ?? {}) },
        pending_skill: { ...(initial.pending_skill ?? {}) },
      }
    : {
        next_effect_id: 0,
        message_count: 0,
        pending: {},
        pending_conversation: {},
        pending_skill: {},
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
        // Remember the active skill so a tool call this turn produces is
        // attributed to it for permission enforcement.
        state.pending_skill[llmId] = command.skill_id ?? '';
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
      const skillId = state.pending_skill[command.id] ?? '';
      delete state.pending_skill[command.id];
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
        // The model asked to run a tool: propose it (attributed to the active
        // skill) instead of storing a reply. The host enforces the skill's tool
        // permissions and gates it behind approval before running it.
        const toolCall = readToolCall(command.result);
        if (toolCall) {
          const proposalId = nextId();
          state.pending[proposalId] = 'tool_call';
          state.pending_conversation[proposalId] = conversationId;
          state.pending_skill[proposalId] = skillId;
          return [
            {
              type: 'tool_call_proposal',
              id: proposalId,
              skill_id: skillId,
              name: toolCall.name,
              args: toolCall.args,
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
        pending_skill: { ...state.pending_skill },
      };
    },
  };
}
