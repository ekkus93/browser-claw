import type { Command, Effect } from './effectTypes.ts';
import { toolContentFromEffectResult } from './effectResultSerialization.ts';
import { toolContentFromEffectFailure } from './effectFailure.ts';
import { classifyFetchUrl } from '../net/urlSafety.ts';
import {
  MAX_BATCH_PAGE_READS,
  normalizeOptionalPositiveIntegerLimit,
} from '../webresearch/limits.ts';

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

/**
 * Like readText but returns `undefined` when the `text` field is absent,
 * so callers can distinguish "no text field" from "empty text field".
 */
function readTextStrict(result: unknown): string | undefined {
  if (typeof result !== 'object' || result === null) return undefined;
  if (!('text' in result)) return undefined;
  const text = (result as { text: unknown }).text;
  return typeof text === 'string' ? text : undefined;
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
          state.pending_skill[proposalId] = skillId;
          return [{ type: 'script_plan_proposal', id: proposalId, plan }];
        }

        // FIX1-C3: the model proposed a sandboxed script.
        const scriptRequest = readScriptRequest(command.result);
        if (scriptRequest !== null) {
          const proposalId = nextId();
          state.pending[proposalId] = 'sandbox_script_proposal';
          state.pending_conversation[proposalId] = conversationId;
          state.pending_skill[proposalId] = skillId;
          return [
            {
              type: 'sandbox_script_proposal',
              id: proposalId,
              request: scriptRequest,
            },
          ];
        }

        // FIX1-C3 / A2: the model proposed a web op.
        const webRequest = readWebRequest(command.result);
        if (webRequest !== null) {
          const proposalId = nextId();
          const op = webRequest.op;
          // E2: missing op is a protocol error, not a silent fallback.
          if (typeof op !== 'string' || op.trim() === '') {
            return [
              {
                type: 'audit_append',
                id: proposalId,
                event_type: 'runtime.invalid_web_request',
                summary: 'web_request missing required op field',
                risk: 'medium',
              },
            ];
          }
          if (op === 'search') {
            // E2: missing query is a protocol error, not a silent fallback.
            if (
              typeof webRequest.query !== 'string' ||
              webRequest.query.trim() === ''
            ) {
              return [
                {
                  type: 'audit_append',
                  id: proposalId,
                  event_type: 'runtime.invalid_web_request',
                  summary: 'web_request search missing required query field',
                  risk: 'medium',
                },
              ];
            }
            state.pending[proposalId] = 'web_search';
            state.pending_conversation[proposalId] = conversationId;
            state.pending_skill[proposalId] = skillId;
            return [
              { type: 'web_search', id: proposalId, query: webRequest.query },
            ];
          }
          if (op === 'readPage') {
            // E2: missing url is a protocol error, not a silent fallback.
            if (
              typeof webRequest.url !== 'string' ||
              webRequest.url.trim() === ''
            ) {
              return [
                {
                  type: 'audit_append',
                  id: proposalId,
                  event_type: 'runtime.invalid_web_request',
                  summary: 'web_request readPage missing required url field',
                  risk: 'medium',
                },
              ];
            }
            state.pending[proposalId] = 'web_page_read';
            state.pending_conversation[proposalId] = conversationId;
            state.pending_skill[proposalId] = skillId;
            return [
              { type: 'web_page_read', id: proposalId, url: webRequest.url },
            ];
          }
          if (op === 'readCurrentTab') {
            state.pending[proposalId] = 'extension_request';
            state.pending_conversation[proposalId] = conversationId;
            state.pending_skill[proposalId] = skillId;
            return [
              {
                type: 'extension_request',
                id: proposalId,
                request: { op: 'read_current_tab' },
              },
            ];
          }
          if (op === 'research') {
            // C3 (FIX3): research needs a query — fail closed if absent.
            if (
              typeof webRequest.query !== 'string' ||
              webRequest.query.trim() === ''
            ) {
              return [
                {
                  type: 'audit_append',
                  id: proposalId,
                  event_type: 'runtime.invalid_web_request',
                  summary: 'web_request research missing required query field',
                  risk: 'medium',
                },
              ];
            }
            state.pending[proposalId] = 'web_research';
            state.pending_conversation[proposalId] = conversationId;
            state.pending_skill[proposalId] = skillId;
            return [
              {
                type: 'web_research',
                id: proposalId,
                mode: 'query',
                query: webRequest.query,
              },
            ];
          }
          if (op === 'readPages') {
            // B1 (FIX6): strict per-slot validation — no silent cast.
            if (
              !Array.isArray(webRequest.urls) ||
              webRequest.urls.length === 0
            ) {
              return [
                {
                  type: 'audit_append',
                  id: proposalId,
                  event_type: 'runtime.invalid_web_request',
                  summary: 'web_request readPages missing required urls array',
                  risk: 'medium',
                },
              ];
            }
            const validatedUrls: string[] = [];
            for (let i = 0; i < webRequest.urls.length; i++) {
              const slot = webRequest.urls[i];
              if (typeof slot !== 'string' || slot.trim() === '') {
                return [
                  {
                    type: 'audit_append',
                    id: proposalId,
                    event_type: 'runtime.invalid_web_request',
                    summary: `web_request readPages urls[${i}] must be a non-empty string`,
                    risk: 'medium',
                  },
                ];
              }
              const safety = classifyFetchUrl(slot.trim());
              if (!safety.ok) {
                return [
                  {
                    type: 'audit_append',
                    id: proposalId,
                    event_type: 'runtime.invalid_web_request',
                    summary: `web_request readPages urls[${i}] is not a safe URL: ${safety.reason}`,
                    risk: 'medium',
                  },
                ];
              }
              validatedUrls.push(slot.trim());
            }
            // B3 (FIX7) + B1 (FIX8): validate optional maxPages in web_request
            // options and forward validated options into the emitted effect.
            const rawOptions = webRequest.options as
              | Record<string, unknown>
              | undefined;
            const rawMaxPages = rawOptions?.maxPages;
            let validatedMaxPages: number | undefined;
            if (rawMaxPages !== undefined) {
              try {
                validatedMaxPages = normalizeOptionalPositiveIntegerLimit(
                  rawMaxPages,
                  'maxPages',
                  { max: MAX_BATCH_PAGE_READS },
                );
              } catch {
                return [
                  {
                    type: 'audit_append',
                    id: proposalId,
                    event_type: 'runtime.invalid_web_request',
                    summary: `web_request readPages options.maxPages is invalid: ${String(rawMaxPages)}`,
                    risk: 'medium',
                  },
                ];
              }
            }
            const forwardedOptions =
              validatedMaxPages !== undefined
                ? { maxPages: validatedMaxPages }
                : undefined;
            state.pending[proposalId] = 'web_research';
            state.pending_conversation[proposalId] = conversationId;
            state.pending_skill[proposalId] = skillId;
            return [
              {
                type: 'web_research',
                id: proposalId,
                mode: 'urls',
                urls: validatedUrls,
                ...(forwardedOptions ? { options: forwardedOptions } : {}),
              },
            ];
          }
          // Unknown op: protocol error. proposalId was allocated but not tracked.
          return [
            {
              type: 'audit_append',
              id: proposalId,
              event_type: 'runtime.unknown_web_request',
              summary: `Unknown web_request op: ${String(op)}`,
              risk: 'medium',
            },
          ];
        }

        // Text response: store as assistant message.
        const text = readTextStrict(command.result);
        if (text !== undefined) {
          if (text.trim() === '') {
            return [
              {
                type: 'audit_append',
                id: nextId(),
                event_type: 'runtime.invalid_empty_llm_result',
                summary: 'LLM result text was empty',
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
              value: { role: 'assistant', content: text },
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
        // Unknown shape: emit protocol error, never an empty message.
        return [
          {
            type: 'audit_append',
            id: nextId(),
            event_type: 'runtime.unknown_llm_result_shape',
            summary: 'LLM result had no recognized shape',
            risk: 'high',
          },
        ];
      }
      // Plan/sandbox/web effects resolve the same way as tool calls: store
      // result as a message and ask the model again, or store an error note.
      if (
        kind === 'script_plan_proposal' ||
        kind === 'sandbox_script_proposal' ||
        kind === 'web_search' ||
        kind === 'web_page_read' ||
        kind === 'web_research' ||
        kind === 'extension_request'
      ) {
        state.message_count += 1;
        if (isFailure(command.result)) {
          return [
            {
              type: 'storage_put',
              id: nextId(),
              conversation_id: conversationId,
              store: 'messages',
              key: `m${state.message_count}`,
              // G2 (FIX5): structured failure content replaces opaque generic string.
              value: {
                role: 'tool',
                content: toolContentFromEffectFailure(
                  (command.result as Record<string, unknown>).error ??
                    command.result,
                ),
              },
            },
            {
              type: 'audit_append',
              id: nextId(),
              event_type: 'runtime.effect_rejected',
              summary: 'Effect rejected or failed',
              risk: 'low',
            },
          ];
        }
        // B1 (FIX3): serialize structured web/plan/script/extension results.
        // readText() returns "" for { results }, { content }, { bundle }, etc.
        // Use the serializer so no empty tool message is ever stored.
        const serialized = toolContentFromEffectResult(command.result);
        if (!serialized.ok) {
          return [
            {
              type: 'audit_append',
              id: nextId(),
              event_type: 'runtime.empty_effect_result',
              summary: serialized.message,
              risk: 'high',
            },
          ];
        }
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
            value: { role: 'tool', content: serialized.content },
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
            event_type: 'runtime.effect_resolved',
            summary: 'Effect result stored',
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
              // G2 (FIX5): structured failure content replaces opaque generic string.
              value: {
                role: 'tool',
                content: toolContentFromEffectFailure(
                  (command.result as Record<string, unknown>).error ??
                    command.result,
                ),
              },
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
