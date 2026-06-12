/**
 * TypeScript mirror of the claw-schema effect/command contract (see
 * crates/claw-schema). Effects cross the WASM boundary as JSON and are routed
 * to the host's side-effect handlers; commands are sent into the runtime.
 */

export type Effect =
  | { type: 'llm_request'; id: string; conversation_id: string; prompt: string }
  | { type: 'storage_get'; id: string; store: string; key: string }
  | {
      type: 'storage_put';
      id: string;
      store: string;
      key: string;
      value: unknown;
    }
  | { type: 'storage_search'; id: string; store: string; query: string }
  | {
      type: 'tool_call_proposal';
      id: string;
      name: string;
      args: unknown;
      risk: string;
    }
  | { type: 'skill_fs_read_text'; id: string; skill_id: string; path: string }
  | { type: 'skill_state_get'; id: string; skill_id: string; key: string }
  | {
      type: 'skill_state_put';
      id: string;
      skill_id: string;
      key: string;
      value: unknown;
    }
  | {
      type: 'audit_append';
      id: string;
      event_type: string;
      summary: string;
      risk: string;
    }
  | { type: 'runtime_snapshot_save'; id: string; snapshot: unknown };

export type Command =
  | { type: 'submit_user_message'; conversation_id: string; text: string }
  | { type: 'resolve_effect'; id: string; result: unknown };
