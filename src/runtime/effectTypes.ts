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
      /** Conversation that triggered the write, so the host can persist a
       * correctly-scoped record. Empty for writes with no conversation context. */
      conversation_id: string;
      store: string;
      key: string;
      value: unknown;
    }
  | { type: 'storage_search'; id: string; store: string; query: string }
  | {
      type: 'tool_call_proposal';
      id: string;
      /** Skill that requested the tool; the host enforces its declared tools. */
      skill_id: string;
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
  | {
      // A structured Plan DSL proposal the runtime hands to the host to validate,
      // gate behind approval, and execute (Part C5). The host resolves the effect
      // with the plan's result.
      type: 'script_plan_proposal';
      id: string;
      plan: unknown;
    }
  // Host-side proposal effects for the workspace/script/web/extension subsystems
  // (Part F2). Each is routed to an injected port that validates, gates behind
  // approval where required, runs the effect, and resolves it with a result.
  // A missing port FAILS CLOSED (audited + visible error + throw).
  | { type: 'workspace_file_op'; id: string; op: unknown }
  | { type: 'workspace_search'; id: string; query: unknown }
  | { type: 'sandbox_script_proposal'; id: string; request: unknown }
  | { type: 'web_search'; id: string; query: string; options?: unknown }
  | { type: 'web_page_read'; id: string; url: string; options?: unknown }
  | { type: 'web_research'; id: string; query: string; options?: unknown }
  | { type: 'extension_request'; id: string; request: unknown }
  | { type: 'runtime_snapshot_save'; id: string; snapshot: unknown };

export type Command =
  | {
      type: 'submit_user_message';
      conversation_id: string;
      text: string;
      /** Skill active in this conversation, if any (tool-call attribution). */
      skill_id?: string;
    }
  | { type: 'resolve_effect'; id: string; result: unknown };
