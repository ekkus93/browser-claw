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
                        let content = result
                            .get("text")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .to_string();
                        self.state.message_count += 1;
                        let put_id = self.next_id();
                        let audit_id = self.next_id();
                        vec![
                            Effect::StoragePut {
                                id: put_id,
                                conversation_id,
                                store: "messages".to_string(),
                                key: format!("m{}", self.state.message_count),
                                value: json!({ "role": "assistant", "content": content }),
                            },
                            Effect::AuditAppend {
                                id: audit_id,
                                event_type: "llm_response_received".to_string(),
                                summary: "Assistant message stored".to_string(),
                                risk: "info".to_string(),
                            },
                        ]
                    }
                    _ => Vec::new(),
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
    fn resolving_an_unknown_effect_is_a_no_op() {
        let mut rt = Runtime::new();
        let effects = rt.dispatch(Command::ResolveEffect {
            id: "missing".to_string(),
            result: json!({}),
        });
        assert!(effects.is_empty());
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
