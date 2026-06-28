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

/** A `{ plan: ... }` resolution means the model proposed a structured plan. */
function readPlan(result: unknown): unknown | null {
  if (typeof result !== 'object' || result === null) return null;
  const r = result as Record<string, unknown>;
  return 'plan' in r && r.plan !== undefined ? r.plan : null;
}

/** A `{ script_request: ... }` resolution means the model proposed a script. */
function readScriptRequest(result: unknown): unknown | null {
  if (typeof result !== 'object' || result === null) return null;
  const r = result as Record<string, unknown>;
  return 'script_request' in r && r.script_request !== undefined
    ? r.script_request
    : null;
}

/** A `{ web_request: { op, ... } }` resolution means the model wants a web op. */
function readWebRequest(result: unknown): Record<string, unknown> | null {
  if (typeof result !== 'object' || result === null) return null;
  const r = result as Record<string, unknown>;
  const wr = r.web_request;
  if (typeof wr !== 'object' || wr === null) return null;
  return wr as Record<string, unknown>;
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

        // FIX1-C3: the model proposed a structured plan block.
        const plan = readPlan(command.result);
        if (plan !== null) {
          const proposalId = nextId();
          state.pending[proposalId] = 'script_plan_proposal';
          state.pending_conversation[proposalId] = conversationId;
          return [{ type: 'script_plan_proposal', id: proposalId, plan }];
        }

        // FIX1-C3: the model proposed a sandboxed script.
        const scriptRequest = readScriptRequest(command.result);
        if (scriptRequest !== null) {
          const proposalId = nextId();
          state.pending[proposalId] = 'sandbox_script_proposal';
          state.pending_conversation[proposalId] = conversationId;
          return [{ type: 'sandbox_script_proposal', id: proposalId, request: scriptRequest }];
        }

        // FIX1-C3: the model proposed a web op (search / readPage / readCurrentTab).
        const webRequest = readWebRequest(command.result);
        if (webRequest !== null) {
          const proposalId = nextId();
          const op = webRequest.op;
          state.pending_conversation[proposalId] = conversationId;
          const query = typeof webRequest.query === 'string' ? webRequest.query : '';
          const url = typeof webRequest.url === 'string' ? webRequest.url : '';
          if (op === 'search') {
            state.pending[proposalId] = 'web_search';
            return [{ type: 'web_search', id: proposalId, query }];
          }
          if (op === 'readPage') {
            state.pending[proposalId] = 'web_page_read';
            return [{ type: 'web_page_read', id: proposalId, url }];
          }
          // readCurrentTab and future ops: emit as web_page_read.
          state.pending[proposalId] = 'web_page_read';
          return [{ type: 'web_page_read', id: proposalId, url }];
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
      if (kind === 'tool_call') {
        state.message_count += 1;
        // A rejected/failed tool stores a note and ends the turn.
        if (isFailure(command.result)) {
          return [
            {
              type: 'storage_put',
              id: nextId(),
              conversation_id: conversationId,
              store: 'messages',
              key: `m${state.message_count}`,
              value: { role: 'tool', content: 'Tool call was not completed.' },
            },
            {
              type: 'audit_append',
              id: nextId(),
              event_type: 'tool_call_rejected',
              summary: 'Tool call rejected',
              risk: 'low',
            },
          ];
        }
        // Approved: store the tool result, then ask the model again with it in
        // context.
        const putId = nextId();
        const llmId = nextId();
        const auditId = nextId();
        state.pending[llmId] = 'llm_request';
        state.pending_conversation[llmId] = conversationId;
        state.pending_skill[llmId] = skillId;
        return [
          {
            type: 'storage_put',
            id: putId,
            conversation_id: conversationId,
            store: 'messages',
            key: `m${state.message_count}`,
            value: { role: 'tool', content: readText(command.result) },
          },
          {
            type: 'llm_request',
            id: llmId,
            conversation_id: conversationId,
            prompt: '',
          },
          {
            type: 'audit_append',
            id: auditId,
            event_type: 'tool_result_stored',
            summary: 'Tool result stored',
            risk: 'info',
          },
        ];
      }
      // Unknown or non-pending effect id (hardening A2.2): never silently return
      // nothing — audit it so a stray/duplicate resolve is visible. Recoverable.
      return [
        {
          type: 'audit_append',
          id: nextId(),
          event_type: 'runtime.resolve_unknown_effect',
          summary: `Resolve for unknown or non-pending effect ${command.id}`,
          risk: 'medium',
        },
      ];
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
