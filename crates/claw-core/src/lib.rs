//! The deterministic BrowserClaw runtime state machine.
//!
//! `Runtime` accepts [`Command`]s and returns [`Effect`]s for the host to
//! execute, threading results back via `Command::ResolveEffect`. It performs no
//! I/O and uses no clocks or randomness, so a given command sequence always
//! yields identical effects — which makes snapshot/restore exact and testing
//! straightforward.

use claw_schema::{Command, Effect, RuntimeState};
use serde_json::{json, Value};

#[derive(Debug, Clone, Default)]
pub struct Runtime {
    state: RuntimeState,
}

impl Runtime {
    pub fn new() -> Self {
        Self::default()
    }

    /// Restore a runtime from a previously saved snapshot.
    pub fn from_snapshot(snapshot: &Value) -> Result<Self, String> {
        let state: RuntimeState =
            serde_json::from_value(snapshot.clone()).map_err(|e| e.to_string())?;
        Ok(Self { state })
    }

    /// Serialize the runtime state for persistence.
    pub fn snapshot(&self) -> Value {
        serde_json::to_value(&self.state).expect("RuntimeState is always serializable")
    }

    pub fn state(&self) -> &RuntimeState {
        &self.state
    }

    fn next_id(&mut self) -> String {
        self.state.next_effect_id += 1;
        format!("eff-{}", self.state.next_effect_id)
    }

    fn effects_for_web_request(
        &mut self,
        conversation_id: String,
        skill_id: String,
        web_request: &Value,
    ) -> Vec<Effect> {
        let op = web_request
            .get("op")
            .and_then(Value::as_str)
            .unwrap_or("");
        match op {
            "search" => {
                let query = web_request
                    .get("query")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                let options = web_request.get("options").cloned();
                let effect_id = self.next_id();
                self.state
                    .pending
                    .insert(effect_id.clone(), "web_search".to_string());
                self.state
                    .pending_conversation
                    .insert(effect_id.clone(), conversation_id);
                self.state
                    .pending_skill
                    .insert(effect_id.clone(), skill_id);
                vec![Effect::WebSearch {
                    id: effect_id,
                    query,
                    options,
                }]
            }
            "readPage" => {
                let url = web_request
                    .get("url")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                let options = web_request.get("options").cloned();
                let effect_id = self.next_id();
                self.state
                    .pending
                    .insert(effect_id.clone(), "web_page_read".to_string());
                self.state
                    .pending_conversation
                    .insert(effect_id.clone(), conversation_id);
                self.state
                    .pending_skill
                    .insert(effect_id.clone(), skill_id);
                vec![Effect::WebPageRead {
                    id: effect_id,
                    url,
                    options,
                }]
            }
            "readCurrentTab" => {
                let options = web_request.get("options").cloned();
                let request = json!({ "op": "read_current_tab", "options": options });
                let effect_id = self.next_id();
                self.state
                    .pending
                    .insert(effect_id.clone(), "extension_request".to_string());
                self.state
                    .pending_conversation
                    .insert(effect_id.clone(), conversation_id);
                self.state
                    .pending_skill
                    .insert(effect_id.clone(), skill_id);
                vec![Effect::ExtensionRequest {
                    id: effect_id,
                    request,
                }]
            }
            "readPages" | "research" => {
                let query = web_request
                    .get("query")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                let options = web_request.get("options").cloned();
                let effect_id = self.next_id();
                self.state
                    .pending
                    .insert(effect_id.clone(), "web_research".to_string());
                self.state
                    .pending_conversation
                    .insert(effect_id.clone(), conversation_id);
                self.state
                    .pending_skill
                    .insert(effect_id.clone(), skill_id);
                vec![Effect::WebResearch {
                    id: effect_id,
                    query,
                    options,
                }]
            }
            _ => {
                let audit_id = self.next_id();
                vec![Effect::AuditAppend {
                    id: audit_id,
                    event_type: "runtime.unknown_web_request".to_string(),
                    summary: format!("Unknown web_request op: {op}"),
                    risk: "medium".to_string(),
                }]
            }
        }
    }

    /// Advance the state machine, returning the effects the host must perform.
    pub fn dispatch(&mut self, command: Command) -> Vec<Effect> {
        match command {
            Command::SubmitUserMessage {
                conversation_id,
                text,
                skill_id,
            } => {
                self.state.message_count += 1;
                let audit_id = self.next_id();
                let llm_id = self.next_id();
                self.state
                    .pending
                    .insert(llm_id.clone(), "llm_request".to_string());
                // Remember which conversation this request belongs to so the
                // assistant message stored when it resolves is scoped correctly.
                self.state
                    .pending_conversation
                    .insert(llm_id.clone(), conversation_id.clone());
                // Remember the active skill so any tool call this turn produces
                // is attributed to it for permission enforcement.
                self.state
                    .pending_skill
                    .insert(llm_id.clone(), skill_id);
                vec![
                    Effect::AuditAppend {
                        id: audit_id,
                        event_type: "llm_request_sent".to_string(),
                        summary: "User message submitted".to_string(),
                        risk: "info".to_string(),
                    },
                    Effect::LlmRequest {
                        id: llm_id,
                        conversation_id,
                        prompt: text,
                    },
                ]
            }
            Command::ResolveEffect { id, result } => {
                // The conversation this effect belongs to (recorded when it was
                // emitted); cleaned up here regardless of success/failure.
                let conversation_id = self
                    .state
                    .pending_conversation
                    .remove(&id)
                    .unwrap_or_default();
                let skill_id =
                    self.state.pending_skill.remove(&id).unwrap_or_default();
                match self.state.pending.remove(&id).as_deref() {
                    Some("llm_request") => {
                        // A failed provider call (host marks `ok: false` or
                        // `error`) stores no assistant message — it is audited
                        // as a failure so the runtime never claims a reply it
                        // didn't get.
                        if result.get("ok") == Some(&Value::Bool(false))
                            || result.get("error").is_some()
                        {
                            let audit_id = self.next_id();
                            return vec![Effect::AuditAppend {
                                id: audit_id,
                                event_type: "llm_request_failed".to_string(),
                                summary: "Provider request failed".to_string(),
                                risk: "medium".to_string(),
                            }];
                        }
                        // The model asked to run a tool: propose it (attributed
                        // to the active skill) instead of storing a reply. The
                        // host enforces the skill's tool permissions and gates
                        // it behind approval before running it.
                        if let Some(tool_call) =
                            result.get("tool_call").and_then(Value::as_object)
                        {
                            let name = tool_call
                                .get("name")
                                .and_then(Value::as_str)
                                .unwrap_or_default()
                                .to_string();
                            let args = tool_call
                                .get("args")
                                .cloned()
                                .unwrap_or(Value::Null);
                            let proposal_id = self.next_id();
                            self.state.pending.insert(
                                proposal_id.clone(),
                                "tool_call".to_string(),
                            );
                            self.state
                                .pending_conversation
                                .insert(proposal_id.clone(), conversation_id);
                            self.state
                                .pending_skill
                                .insert(proposal_id.clone(), skill_id.clone());
                            return vec![Effect::ToolCallProposal {
                                id: proposal_id,
                                skill_id,
                                name,
                                args,
                                risk: "medium".to_string(),
                            }];
                        }
                        // Plan proposal: model produced a structured plan.
                        if let Some(plan) = result.get("plan") {
                            let proposal_id = self.next_id();
                            self.state.pending.insert(
                                proposal_id.clone(),
                                "plan_proposal".to_string(),
                            );
                            self.state
                                .pending_conversation
                                .insert(proposal_id.clone(), conversation_id);
                            self.state
                                .pending_skill
                                .insert(proposal_id.clone(), skill_id);
                            return vec![Effect::ScriptPlanProposal {
                                id: proposal_id,
                                plan: plan.clone(),
                            }];
                        }
                        // Sandbox script request: model asked to run sandboxed JS.
                        if let Some(script_request) = result.get("script_request") {
                            let proposal_id = self.next_id();
                            self.state.pending.insert(
                                proposal_id.clone(),
                                "sandbox_script_proposal".to_string(),
                            );
                            self.state
                                .pending_conversation
                                .insert(proposal_id.clone(), conversation_id);
                            self.state
                                .pending_skill
                                .insert(proposal_id.clone(), skill_id);
                            return vec![Effect::SandboxScriptProposal {
                                id: proposal_id,
                                request: script_request.clone(),
                            }];
                        }
                        // Web request: model wants to search or read pages.
                        if let Some(web_request) = result.get("web_request") {
                            return self.effects_for_web_request(
                                conversation_id,
                                skill_id,
                                web_request,
                            );
                        }
                        // Text response: store as assistant message.
                        if let Some(text) =
                            result.get("text").and_then(Value::as_str)
                        {
                            if text.trim().is_empty() {
                                let audit_id = self.next_id();
                                return vec![Effect::AuditAppend {
                                    id: audit_id,
                                    event_type: "runtime.invalid_empty_llm_result"
                                        .to_string(),
                                    summary: "LLM result text was empty".to_string(),
                                    risk: "medium".to_string(),
                                }];
                            }
                            let content = text.to_string();
                            self.state.message_count += 1;
                            let put_id = self.next_id();
                            let audit_id = self.next_id();
                            return vec![
                                Effect::StoragePut {
                                    id: put_id,
                                    conversation_id,
                                    store: "messages".to_string(),
                                    key: format!("m{}", self.state.message_count),
                                    value: json!({
                                        "role": "assistant",
                                        "content": content
                                    }),
                                },
                                Effect::AuditAppend {
                                    id: audit_id,
                                    event_type: "llm_response_received".to_string(),
                                    summary: "Assistant message stored".to_string(),
                                    risk: "info".to_string(),
                                },
                            ];
                        }
                        // Unknown shape: emit protocol error, never an empty message.
                        let audit_id = self.next_id();
                        vec![Effect::AuditAppend {
                            id: audit_id,
                            event_type: "runtime.unknown_llm_result_shape".to_string(),
                            summary: "LLM result had no recognized shape".to_string(),
                            risk: "high".to_string(),
                        }]
                    }
                    // Plan/sandbox/web effects resolve the same way as tool calls:
                    // store result as a message and ask the model again, or store
                    // an error note on failure.
                    Some(
                        "plan_proposal"
                        | "sandbox_script_proposal"
                        | "web_search"
                        | "web_page_read"
                        | "web_research"
                        | "extension_request",
                    ) => {
                        if result.get("ok") == Some(&Value::Bool(false))
                            || result.get("error").is_some()
                        {
                            self.state.message_count += 1;
                            let put_id = self.next_id();
                            let audit_id = self.next_id();
                            return vec![
                                Effect::StoragePut {
                                    id: put_id,
                                    conversation_id,
                                    store: "messages".to_string(),
                                    key: format!(
                                        "m{}",
                                        self.state.message_count
                                    ),
                                    value: json!({
                                        "role": "tool",
                                        "content": "Operation was not completed."
                                    }),
                                },
                                Effect::AuditAppend {
                                    id: audit_id,
                                    event_type: "runtime.effect_rejected"
                                        .to_string(),
                                    summary: "Effect rejected or failed"
                                        .to_string(),
                                    risk: "low".to_string(),
                                },
                            ];
                        }
                        let content = result
                            .get("text")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .to_string();
                        self.state.message_count += 1;
                        let put_id = self.next_id();
                        let llm_id = self.next_id();
                        let audit_id = self.next_id();
                        self.state
                            .pending
                            .insert(llm_id.clone(), "llm_request".to_string());
                        self.state
                            .pending_conversation
                            .insert(llm_id.clone(), conversation_id.clone());
                        self.state
                            .pending_skill
                            .insert(llm_id.clone(), skill_id);
                        vec![
                            Effect::StoragePut {
                                id: put_id,
                                conversation_id: conversation_id.clone(),
                                store: "messages".to_string(),
                                key: format!("m{}", self.state.message_count),
                                value: json!({ "role": "tool", "content": content }),
                            },
                            Effect::LlmRequest {
                                id: llm_id,
                                conversation_id,
                                prompt: String::new(),
                            },
                            Effect::AuditAppend {
                                id: audit_id,
                                event_type: "runtime.effect_resolved".to_string(),
                                summary: "Effect result stored".to_string(),
                                risk: "info".to_string(),
                            },
                        ]
                    }
                    Some("tool_call") => {
                        // A rejected/failed tool stores a note and ends the turn
                        // (no second provider call).
                        if result.get("ok") == Some(&Value::Bool(false))
                            || result.get("error").is_some()
                        {
                            self.state.message_count += 1;
                            let put_id = self.next_id();
                            let audit_id = self.next_id();
                            return vec![
                                Effect::StoragePut {
                                    id: put_id,
                                    conversation_id,
                                    store: "messages".to_string(),
                                    key: format!(
                                        "m{}",
                                        self.state.message_count
                                    ),
                                    value: json!({
                                        "role": "tool",
                                        "content": "Tool call was not completed."
                                    }),
                                },
                                Effect::AuditAppend {
                                    id: audit_id,
                                    event_type: "tool_call_rejected".to_string(),
                                    summary: "Tool call rejected".to_string(),
                                    risk: "low".to_string(),
                                },
                            ];
                        }
                        // Approved: store the tool's result as a tool message,
                        // then ask the model again with that result in context.
                        let content = result
                            .get("text")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .to_string();
                        self.state.message_count += 1;
                        let put_id = self.next_id();
                        let llm_id = self.next_id();
                        let audit_id = self.next_id();
                        self.state
                            .pending
                            .insert(llm_id.clone(), "llm_request".to_string());
                        self.state
                            .pending_conversation
                            .insert(llm_id.clone(), conversation_id.clone());
                        self.state
                            .pending_skill
                            .insert(llm_id.clone(), skill_id);
                        vec![
                            Effect::StoragePut {
                                id: put_id,
                                conversation_id: conversation_id.clone(),
                                store: "messages".to_string(),
                                key: format!("m{}", self.state.message_count),
                                value: json!({ "role": "tool", "content": content }),
                            },
                            Effect::LlmRequest {
                                id: llm_id,
                                conversation_id,
                                prompt: String::new(),
                            },
                            Effect::AuditAppend {
                                id: audit_id,
                                event_type: "tool_result_stored".to_string(),
                                summary: "Tool result stored".to_string(),
                                risk: "info".to_string(),
                            },
                        ]
                    }
                    // Unknown or non-pending effect id (hardening A2.2): never
                    // silently return nothing — audit it so a stray/duplicate
                    // resolve is visible. Recoverable: no state change.
                    _ => {
                        let audit_id = self.next_id();
                        vec![Effect::AuditAppend {
                            id: audit_id,
                            event_type: "runtime.resolve_unknown_effect"
                                .to_string(),
                            summary: format!(
                                "Resolve for unknown or non-pending effect {id}"
                            ),
                            risk: "medium".to_string(),
                        }]
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn submit(text: &str) -> Command {
        Command::SubmitUserMessage {
            conversation_id: "c1".to_string(),
            text: text.to_string(),
            skill_id: String::new(),
        }
    }

    fn submit_with_skill(text: &str, skill_id: &str) -> Command {
        Command::SubmitUserMessage {
            conversation_id: "c1".to_string(),
            text: text.to_string(),
            skill_id: skill_id.to_string(),
        }
    }

    #[test]
    fn resolving_an_unknown_effect_id_audits_instead_of_silently_ignoring() {
        // Hardening A2.2: a resolve for an id the runtime never emitted (or
        // already resolved) must not silently return nothing.
        let mut rt = Runtime::new();
        let effects = rt.dispatch(Command::ResolveEffect {
            id: "does-not-exist".to_string(),
            result: json!({ "text": "stray" }),
        });
        assert_eq!(effects.len(), 1);
        match &effects[0] {
            Effect::AuditAppend {
                event_type, risk, ..
            } => {
                assert_eq!(event_type, "runtime.resolve_unknown_effect");
                assert_eq!(risk, "medium");
            }
            other => panic!("expected AuditAppend, got {other:?}"),
        }
    }

    #[test]
    fn resolving_an_llm_request_with_a_tool_call_proposes_it_for_the_skill() {
        let mut rt = Runtime::new();
        rt.dispatch(submit_with_skill("search the web", "web-search"));
        let effects = rt.dispatch(Command::ResolveEffect {
            id: "eff-2".to_string(),
            result: json!({
                "tool_call": {
                    "name": "Page Reader",
                    "args": { "url": "https://example.com" }
                }
            }),
        });
        assert_eq!(effects.len(), 1);
        match &effects[0] {
            Effect::ToolCallProposal {
                skill_id,
                name,
                args,
                ..
            } => {
                // The proposal is attributed to the active skill so the host
                // can enforce that skill's declared tools.
                assert_eq!(skill_id, "web-search");
                assert_eq!(name, "Page Reader");
                assert_eq!(args["url"], "https://example.com");
            }
            other => panic!("expected ToolCallProposal, got {other:?}"),
        }
    }

    #[test]
    fn resolving_an_approved_tool_call_stores_the_result_and_asks_again() {
        let mut rt = Runtime::new();
        rt.dispatch(submit_with_skill("search", "web-search"));
        // llm_request resolves with a tool call -> proposal eff-3.
        rt.dispatch(Command::ResolveEffect {
            id: "eff-2".to_string(),
            result: json!({ "tool_call": { "name": "Page Reader", "args": {} } }),
        });
        // The host ran the tool and resolves the proposal with its output.
        let effects = rt.dispatch(Command::ResolveEffect {
            id: "eff-3".to_string(),
            result: json!({ "text": "page contents" }),
        });
        // Tool result stored as a 'tool' message + a follow-up llm_request.
        let stored = effects.iter().find_map(|e| match e {
            Effect::StoragePut { value, .. } => Some(value),
            _ => None,
        });
        assert_eq!(stored.expect("storage_put")["role"], "tool");
        assert_eq!(stored.expect("storage_put")["content"], "page contents");
        assert!(effects
            .iter()
            .any(|e| matches!(e, Effect::LlmRequest { .. })));
    }

    #[test]
    fn submit_emits_audit_then_llm_request() {
        let mut rt = Runtime::new();
        let effects = rt.dispatch(submit("hello"));
        assert_eq!(effects.len(), 2);
        assert!(matches!(effects[0], Effect::AuditAppend { .. }));
        match &effects[1] {
            Effect::LlmRequest { id, prompt, .. } => {
                assert_eq!(id, "eff-2");
                assert_eq!(prompt, "hello");
            }
            other => panic!("expected LlmRequest, got {other:?}"),
        }
    }

    #[test]
    fn resolving_an_llm_request_stores_the_assistant_message() {
        let mut rt = Runtime::new();
        rt.dispatch(submit("hi"));
        let effects = rt.dispatch(Command::ResolveEffect {
            id: "eff-2".to_string(),
            result: json!({ "text": "hello there" }),
        });
        match &effects[0] {
            Effect::StoragePut {
                store,
                value,
                conversation_id,
                ..
            } => {
                assert_eq!(store, "messages");
                assert_eq!(value["content"], "hello there");
                // The stored message stays scoped to its conversation.
                assert_eq!(conversation_id, "c1");
            }
            other => panic!("expected StoragePut, got {other:?}"),
        }
    }

    #[test]
    fn resolving_a_failed_llm_request_stores_no_message() {
        let mut rt = Runtime::new();
        rt.dispatch(submit("hi"));
        let effects = rt.dispatch(Command::ResolveEffect {
            id: "eff-2".to_string(),
            result: json!({ "ok": false, "error": { "kind": "auth" } }),
        });
        // No assistant message stored; only a failure audit.
        assert_eq!(effects.len(), 1);
        match &effects[0] {
            Effect::AuditAppend {
                event_type, risk, ..
            } => {
                assert_eq!(event_type, "llm_request_failed");
                assert_eq!(risk, "medium");
            }
            other => panic!("expected AuditAppend, got {other:?}"),
        }
        assert!(!effects
            .iter()
            .any(|e| matches!(e, Effect::StoragePut { .. })));
    }

    #[test]
    fn resolving_an_unknown_effect_audits_a_failure_and_changes_no_state() {
        // Hardening A2.2: previously a no-op; now it emits a single audit effect
        // and still makes no state change (recoverable).
        let mut rt = Runtime::new();
        let effects = rt.dispatch(Command::ResolveEffect {
            id: "missing".to_string(),
            result: json!({}),
        });
        assert_eq!(effects.len(), 1);
        assert!(matches!(
            &effects[0],
            Effect::AuditAppend { event_type, .. }
                if event_type == "runtime.resolve_unknown_effect"
        ));
    }

    // --- A1 tests: plan/script/web result shape detection ---

    #[test]
    fn plan_result_emits_script_plan_proposal() {
        let mut rt = Runtime::new();
        rt.dispatch(submit("make a plan"));
        let effects = rt.dispatch(Command::ResolveEffect {
            id: "eff-2".to_string(),
            result: json!({
                "plan": {
                    "steps": [{ "op": "fs.readText", "path": "/workspace/data.txt" }]
                }
            }),
        });
        assert_eq!(effects.len(), 1);
        match &effects[0] {
            Effect::ScriptPlanProposal { id, plan } => {
                assert_eq!(id, "eff-3");
                assert!(plan.get("steps").is_some());
            }
            other => panic!("expected ScriptPlanProposal, got {other:?}"),
        }
    }

    #[test]
    fn script_request_result_emits_sandbox_script_proposal() {
        let mut rt = Runtime::new();
        rt.dispatch(submit("run a script"));
        let effects = rt.dispatch(Command::ResolveEffect {
            id: "eff-2".to_string(),
            result: json!({
                "script_request": {
                    "type": "browserclaw_script_request",
                    "version": 1,
                    "runtime": "sandboxed_script",
                    "title": "Compute something",
                    "reason": "Need arithmetic",
                    "code": "return 1 + 1;",
                    "capabilities": { "secrets": "deny", "network": "deny" },
                    "limits": { "timeoutMs": 5000, "maxOutputBytes": 1024,
                                "maxFileReads": 0, "maxFileWrites": 0 }
                }
            }),
        });
        assert_eq!(effects.len(), 1);
        match &effects[0] {
            Effect::SandboxScriptProposal { id, request } => {
                assert_eq!(id, "eff-3");
                assert_eq!(request["title"], "Compute something");
            }
            other => panic!("expected SandboxScriptProposal, got {other:?}"),
        }
    }

    #[test]
    fn web_request_search_emits_web_search() {
        let mut rt = Runtime::new();
        rt.dispatch(submit("search the web"));
        let effects = rt.dispatch(Command::ResolveEffect {
            id: "eff-2".to_string(),
            result: json!({
                "web_request": { "op": "search", "query": "rust async" }
            }),
        });
        assert_eq!(effects.len(), 1);
        match &effects[0] {
            Effect::WebSearch { id, query, .. } => {
                assert_eq!(id, "eff-3");
                assert_eq!(query, "rust async");
            }
            other => panic!("expected WebSearch, got {other:?}"),
        }
    }

    #[test]
    fn web_request_read_page_emits_web_page_read() {
        let mut rt = Runtime::new();
        rt.dispatch(submit("read a page"));
        let effects = rt.dispatch(Command::ResolveEffect {
            id: "eff-2".to_string(),
            result: json!({
                "web_request": { "op": "readPage", "url": "https://example.com" }
            }),
        });
        assert_eq!(effects.len(), 1);
        match &effects[0] {
            Effect::WebPageRead { id, url, .. } => {
                assert_eq!(id, "eff-3");
                assert_eq!(url, "https://example.com");
            }
            other => panic!("expected WebPageRead, got {other:?}"),
        }
    }

    #[test]
    fn web_request_read_current_tab_emits_extension_request() {
        let mut rt = Runtime::new();
        rt.dispatch(submit("read current tab"));
        let effects = rt.dispatch(Command::ResolveEffect {
            id: "eff-2".to_string(),
            result: json!({
                "web_request": { "op": "readCurrentTab" }
            }),
        });
        assert_eq!(effects.len(), 1);
        match &effects[0] {
            Effect::ExtensionRequest { id, request } => {
                assert_eq!(id, "eff-3");
                assert_eq!(request["op"], "read_current_tab");
            }
            other => panic!("expected ExtensionRequest, got {other:?}"),
        }
    }

    #[test]
    fn unknown_llm_result_shape_emits_protocol_error() {
        let mut rt = Runtime::new();
        rt.dispatch(submit("hello"));
        let effects = rt.dispatch(Command::ResolveEffect {
            id: "eff-2".to_string(),
            result: json!({ "unexpected_field": "something" }),
        });
        assert_eq!(effects.len(), 1);
        match &effects[0] {
            Effect::AuditAppend { event_type, risk, .. } => {
                assert_eq!(event_type, "runtime.unknown_llm_result_shape");
                assert_eq!(risk, "high");
            }
            other => panic!("expected AuditAppend protocol error, got {other:?}"),
        }
        // No assistant message stored (no StoragePut emitted).
        assert!(!effects
            .iter()
            .any(|e| matches!(e, Effect::StoragePut { .. })));
    }

    #[test]
    fn normal_text_result_still_stores_assistant_message() {
        let mut rt = Runtime::new();
        rt.dispatch(submit("hi"));
        let effects = rt.dispatch(Command::ResolveEffect {
            id: "eff-2".to_string(),
            result: json!({ "text": "hello there" }),
        });
        let stored = effects.iter().find_map(|e| match e {
            Effect::StoragePut { value, .. } => Some(value),
            _ => None,
        });
        assert_eq!(stored.expect("storage_put")["role"], "assistant");
        assert_eq!(stored.expect("storage_put")["content"], "hello there");
    }

    #[test]
    fn snapshot_restore_roundtrips_and_is_deterministic() {
        let mut a = Runtime::new();
        a.dispatch(submit("one"));
        let snapshot = a.snapshot();

        let mut b = Runtime::from_snapshot(&snapshot).expect("restore");
        assert_eq!(a.state(), b.state());

        // Both runtimes continue identically from the same state.
        let ea = a.dispatch(submit("two"));
        let eb = b.dispatch(submit("two"));
        assert_eq!(ea, eb);
    }
}
