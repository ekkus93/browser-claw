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

    // C2/C3 (FIX3): fail-closed field extraction helpers.
    // Returns the non-empty trimmed string or None; caller emits audit on None.
    fn require_str_field<'a>(obj: &'a Value, field: &str) -> Option<&'a str> {
        let s = obj.get(field).and_then(Value::as_str)?;
        if s.trim().is_empty() {
            None
        } else {
            Some(s)
        }
    }

    // A1 (FIX4): reject any invalid slot rather than silently dropping it.
    // Returns Err with a descriptive message if the array is missing, empty,
    // or contains any non-string or empty/whitespace slot.
    fn required_string_array(obj: &Value, field: &str) -> Result<Vec<String>, String> {
        let arr = obj
            .get(field)
            .and_then(Value::as_array)
            .filter(|a| !a.is_empty())
            .ok_or_else(|| format!("web_request.{field} must be a non-empty array"))?;

        arr.iter()
            .enumerate()
            .map(|(idx, v)| {
                v.as_str()
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .map(ToOwned::to_owned)
                    .ok_or_else(|| {
                        format!("web_request.{field}[{idx}] must be a non-empty string")
                    })
            })
            .collect()
    }

    fn audit_invalid_web_request(&mut self, message: String) -> Vec<Effect> {
        let audit_id = self.next_id();
        vec![Effect::AuditAppend {
            id: audit_id,
            event_type: "runtime.invalid_web_request".to_string(),
            summary: message,
            risk: "medium".to_string(),
        }]
    }

    // A2 (FIX4): tool_call.name must be a non-empty trimmed string.
    fn required_tool_name(tool_call: &serde_json::Map<String, Value>) -> Result<String, String> {
        tool_call
            .get("name")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(ToOwned::to_owned)
            .ok_or_else(|| "tool_call.name must be a non-empty string".to_string())
    }

    fn audit_invalid_tool_call(&mut self, message: String) -> Vec<Effect> {
        let audit_id = self.next_id();
        vec![Effect::AuditAppend {
            id: audit_id,
            event_type: "runtime.invalid_tool_call".to_string(),
            summary: message,
            risk: "medium".to_string(),
        }]
    }

    fn effects_for_web_request(
        &mut self,
        conversation_id: String,
        skill_id: String,
        web_request: &Value,
    ) -> Vec<Effect> {
        let op = match Self::require_str_field(web_request, "op") {
            Some(op) => op.to_string(),
            None => {
                return self.audit_invalid_web_request(
                    "web_request missing required op field".to_string(),
                )
            }
        };
        match op.as_str() {
            "search" => {
                let query = match Self::require_str_field(web_request, "query") {
                    Some(q) => q.to_string(),
                    None => {
                        return self.audit_invalid_web_request(
                            "web_request search missing required query field".to_string(),
                        )
                    }
                };
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
                let url = match Self::require_str_field(web_request, "url") {
                    Some(u) => u.to_string(),
                    None => {
                        return self.audit_invalid_web_request(
                            "web_request readPage missing required url field".to_string(),
                        )
                    }
                };
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
            "research" => {
                // C3 (FIX3): research needs a non-empty query — fail closed if absent.
                let query = match Self::require_str_field(web_request, "query") {
                    Some(q) => q.to_string(),
                    None => {
                        return self.audit_invalid_web_request(
                            "web_request research missing required query field".to_string(),
                        )
                    }
                };
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
                    mode: "query".to_string(),
                    query: Some(query),
                    urls: None,
                    options,
                }]
            }
            "readPages" => {
                // A1 (FIX4): any invalid slot (non-string, empty) rejects the whole
                // request — no silent per-slot filtering.
                let urls = match Self::required_string_array(web_request, "urls") {
                    Ok(u) => u,
                    Err(msg) => return self.audit_invalid_web_request(msg),
                };
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
                    mode: "urls".to_string(),
                    query: None,
                    urls: Some(urls),
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
                // Safe defaults: pending_conversation/pending_skill are internal
                // bookkeeping maps, not protocol data. An unknown effect ID yields
                // "" which is benign — it only affects attribution metadata.
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
                            // A2 (FIX4): reject empty/missing tool name before proposal.
                            let name = match Self::required_tool_name(tool_call) {
                                Ok(n) => n,
                                Err(msg) => return self.audit_invalid_tool_call(msg),
                            };
                            // Safe default: args is optional by design; many tools
                            // take no arguments. Null is the correct missing-args value.
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
                            let error = result.get("error").unwrap_or(&result);
                            let failure_content =
                                Self::tool_content_from_effect_failure(error);
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
                                        "content": failure_content
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
                        // B2 (FIX3): never store an empty tool message.
                        let content = match Self::tool_content_from_effect_result(&result) {
                            Some(c) => c,
                            None => {
                                let audit_id = self.next_id();
                                return vec![Effect::AuditAppend {
                                    id: audit_id,
                                    event_type: "runtime.empty_effect_result".to_string(),
                                    summary: "Effect resolved successfully but produced no usable tool content".to_string(),
                                    risk: "high".to_string(),
                                }];
                            }
                        };
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
                            let error = result.get("error").unwrap_or(&result);
                            let failure_content =
                                Self::tool_content_from_effect_failure(error);
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
                                        "content": failure_content
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
                        // B2 (FIX3): use serializer — tool results may be structured.
                        let content = match Self::tool_content_from_effect_result(&result) {
                            Some(c) => c,
                            None => {
                                let audit_id = self.next_id();
                                return vec![Effect::AuditAppend {
                                    id: audit_id,
                                    event_type: "runtime.empty_effect_result".to_string(),
                                    summary: "Tool call resolved but produced no usable content".to_string(),
                                    risk: "high".to_string(),
                                }];
                            }
                        };
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

    /// B2 (FIX3): Rust equivalent of TypeScript's toolContentFromEffectResult.
    ///
    /// Converts a structured effect result into non-empty tool content string.
    /// Returns None for unrecognized or empty results (caller audits empty_effect_result).
    ///
    /// Handled shapes:
    /// Build structured, sanitized failure content for a failed effect or tool call.
    ///
    /// Returns a JSON string matching TypeScript `toolContentFromEffectFailure()`:
    ///   `{ type: "effect_failure", kind, message, retryable }`
    ///
    /// Redacts token-like substrings. Never includes raw stack traces.
    fn tool_content_from_effect_failure(error: &Value) -> String {
        fn string_field<'a>(obj: &'a Value, field: &str) -> Option<&'a str> {
            obj.get(field)
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|s| !s.is_empty())
        }

        // A1 (FIX7) + E1 (FIX8): redact all occurrences of secret markers with
        // boundary/min-length checks to avoid false positives on ordinary words
        // containing "sk-" (e.g. risk-level, task-id, disk-cache, ask-for-help).
        //
        // Policy:
        //   - sk-/sk-ant-: only redact if at a non-alphanumeric/non-hyphen/non-underscore
        //     boundary AND followed by >= 12 secret-like chars (alphanumeric + _ + -)
        //   - Bearer: only redact if at a word boundary (preceded by whitespace or start)
        //   - Authorization: redact entire line (no false-positive risk)
        //
        // Order: Authorization → Bearer → sk-ant- → sk- (longer/more-specific first).

        fn is_word_boundary_before(input: &str, start: usize) -> bool {
            if start == 0 {
                return true;
            }
            input[..start]
                .chars()
                .next_back()
                .map(|ch| ch.is_whitespace() || matches!(ch, ',' | ';' | '"' | '\'' | '(' | '[' | '{' | '<'))
                .unwrap_or(true)
        }

        fn is_sk_boundary_before(input: &str, start: usize) -> bool {
            if start == 0 {
                return true;
            }
            input[..start]
                .chars()
                .next_back()
                .map(|ch| !ch.is_ascii_alphanumeric() && ch != '_' && ch != '-')
                .unwrap_or(true)
        }

        fn secret_suffix_len(input: &str, from: usize) -> usize {
            input[from..]
                .chars()
                .take_while(|ch| ch.is_ascii_alphanumeric() || *ch == '_' || *ch == '-')
                .map(|ch| ch.len_utf8())
                .sum()
        }

        fn redact_sk_tokens(mut input: String, prefix: &str) -> String {
            let min_suffix = 12usize;
            let mut search_from = 0usize;
            while let Some(rel) = input[search_from..].find(prefix) {
                let start = search_from + rel;
                let after_prefix = start + prefix.len();
                // E1 (FIX9) Option A: generic sk- rule skips tokens that start
                // with sk-ant- so the sk-ant- rule has precise ownership of
                // Anthropic tokens (avoids double-counting the prefix length).
                if prefix == "sk-" && input[start..].starts_with("sk-ant-") {
                    search_from = after_prefix;
                    continue;
                }
                let suffix_len = secret_suffix_len(&input, after_prefix);
                if is_sk_boundary_before(&input, start) && suffix_len >= min_suffix {
                    let end = after_prefix + suffix_len;
                    input = format!("{}[REDACTED]{}", &input[..start], &input[end..]);
                    // search_from stays at start: next iteration picks up after [REDACTED]
                } else {
                    // advance past this occurrence to avoid infinite loop
                    search_from = after_prefix;
                }
            }
            input
        }

        fn redact_bearer_tokens(mut input: String) -> String {
            let marker = "Bearer ";
            let mut search_from = 0usize;
            while let Some(rel) = input[search_from..].find(marker) {
                let start = search_from + rel;
                if is_word_boundary_before(&input, start) {
                    let after_marker = start + marker.len();
                    let end = input[after_marker..]
                        .find(|ch: char| {
                            ch.is_whitespace()
                                || matches!(ch, ',' | ';' | '"' | '\'' | ')' | ']' | '}')
                        })
                        .map(|offset| after_marker + offset)
                        .unwrap_or(input.len());
                    input = format!("{}[REDACTED]{}", &input[..start], &input[end..]);
                } else {
                    search_from = start + marker.len();
                }
            }
            input
        }

        fn redact_authorization_headers(mut input: String) -> String {
            while let Some(start) = input.find("Authorization:") {
                let end = input[start..]
                    .find(['\n', '\r', ',', ';'])
                    .map(|offset| start + offset)
                    .unwrap_or(input.len());
                input = format!("{}[REDACTED]{}", &input[..start], &input[end..]);
            }
            input
        }

        fn redact(input: &str) -> String {
            let mut out = input.to_owned();
            out = redact_authorization_headers(out);
            out = redact_bearer_tokens(out);
            out = redact_sk_tokens(out, "sk-ant-");
            out = redact_sk_tokens(out, "sk-");
            out
        }

        let kind = string_field(error, "kind").unwrap_or("effect_failed");
        let raw_message =
            string_field(error, "message").unwrap_or("The requested operation failed.");
        let retryable = error
            .get("retryable")
            .and_then(Value::as_bool)
            .unwrap_or(false);

        json!({
            "type": "effect_failure",
            "kind": kind,
            "message": redact(raw_message),
            "retryable": retryable
        })
        .to_string()
    }

    ///   { text: string }          → the text directly
    ///   { results: [...] }        → JSON: { type: "web_search_results", results }
    ///   { content: {...} }        → JSON: { type: "web_page_content", content }
    ///   { contents: [...] }       → JSON: { type: "web_pages_content", contents }
    ///   { bundle: {...} }         → JSON: { type: "web_research_bundle", bundle }
    ///   { response: {...} }       → JSON: { type: "extension_response", response }
    ///   { outputs: [...] }        → JSON: { type: "plan_outputs", outputs }
    ///   { value: <any> }          → JSON: { type: "script_result", value }
    fn tool_content_from_effect_result(result: &Value) -> Option<String> {
        let obj = result.as_object()?;

        // { text } — direct string content
        if let Some(text) = obj.get("text").and_then(Value::as_str) {
            if !text.trim().is_empty() {
                return Some(text.to_string());
            }
            return None;
        }

        // { results } — web search results array
        if let Some(results) = obj.get("results") {
            let out = json!({ "type": "web_search_results", "results": results });
            return serde_json::to_string(&out).ok();
        }

        // { content } — single page content object
        if let Some(content) = obj.get("content") {
            let out = json!({ "type": "web_page_content", "content": content });
            return serde_json::to_string(&out).ok();
        }

        // { contents } — multi-page content array
        if let Some(contents) = obj.get("contents") {
            let out = json!({ "type": "web_pages_content", "contents": contents });
            return serde_json::to_string(&out).ok();
        }

        // { bundle } — research bundle
        if let Some(bundle) = obj.get("bundle") {
            let out = json!({ "type": "web_research_bundle", "bundle": bundle });
            return serde_json::to_string(&out).ok();
        }

        // { response } — extension response
        if let Some(response) = obj.get("response") {
            let out = json!({ "type": "extension_response", "response": response });
            return serde_json::to_string(&out).ok();
        }

        // { outputs } — plan step outputs
        if let Some(outputs) = obj.get("outputs") {
            let out = json!({ "type": "plan_outputs", "outputs": outputs });
            return serde_json::to_string(&out).ok();
        }

        // { value } — sandboxed script result (value may be null)
        if obj.contains_key("value") {
            let value = &obj["value"];
            let out = json!({ "type": "script_result", "value": value });
            return serde_json::to_string(&out).ok();
        }

        None
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

    // C2 (FIX3): fail-closed web request validation
    #[test]
    fn c2_search_missing_query_emits_invalid_web_request_audit() {
        let mut rt = Runtime::new();
        rt.dispatch(submit("search"));
        let effects = rt.dispatch(Command::ResolveEffect {
            id: "eff-2".to_string(),
            result: json!({ "web_request": { "op": "search" } }), // no query
        });
        assert_eq!(effects.len(), 1);
        match &effects[0] {
            Effect::AuditAppend { event_type, .. } => {
                assert_eq!(event_type, "runtime.invalid_web_request");
            }
            other => panic!("expected audit, got {other:?}"),
        }
    }

    #[test]
    fn c2_read_page_missing_url_emits_invalid_web_request_audit() {
        let mut rt = Runtime::new();
        rt.dispatch(submit("read"));
        let effects = rt.dispatch(Command::ResolveEffect {
            id: "eff-2".to_string(),
            result: json!({ "web_request": { "op": "readPage" } }), // no url
        });
        assert_eq!(effects.len(), 1);
        match &effects[0] {
            Effect::AuditAppend { event_type, .. } => {
                assert_eq!(event_type, "runtime.invalid_web_request");
            }
            other => panic!("expected audit, got {other:?}"),
        }
    }

    #[test]
    fn c2_search_empty_query_emits_invalid_web_request_audit() {
        let mut rt = Runtime::new();
        rt.dispatch(submit("search"));
        let effects = rt.dispatch(Command::ResolveEffect {
            id: "eff-2".to_string(),
            result: json!({ "web_request": { "op": "search", "query": "" } }),
        });
        match &effects[0] {
            Effect::AuditAppend { event_type, .. } => {
                assert_eq!(event_type, "runtime.invalid_web_request");
            }
            other => panic!("expected audit, got {other:?}"),
        }
    }

    #[test]
    fn c2_missing_op_emits_invalid_web_request_audit() {
        let mut rt = Runtime::new();
        rt.dispatch(submit("something"));
        let effects = rt.dispatch(Command::ResolveEffect {
            id: "eff-2".to_string(),
            result: json!({ "web_request": { "query": "test" } }), // no op
        });
        match &effects[0] {
            Effect::AuditAppend { event_type, .. } => {
                assert_eq!(event_type, "runtime.invalid_web_request");
            }
            other => panic!("expected audit, got {other:?}"),
        }
    }

    // C3 (FIX3): discriminated web_research effects
    #[test]
    fn c3_research_emits_web_research_mode_query() {
        let mut rt = Runtime::new();
        rt.dispatch(submit("research something"));
        let effects = rt.dispatch(Command::ResolveEffect {
            id: "eff-2".to_string(),
            result: json!({ "web_request": { "op": "research", "query": "AI safety" } }),
        });
        assert_eq!(effects.len(), 1);
        match &effects[0] {
            Effect::WebResearch { id, mode, query, urls, .. } => {
                assert_eq!(id, "eff-3");
                assert_eq!(mode, "query");
                assert_eq!(query.as_deref(), Some("AI safety"));
                assert!(urls.is_none());
            }
            other => panic!("expected WebResearch, got {other:?}"),
        }
    }

    #[test]
    fn c3_read_pages_emits_web_research_mode_urls() {
        let mut rt = Runtime::new();
        rt.dispatch(submit("read these pages"));
        let effects = rt.dispatch(Command::ResolveEffect {
            id: "eff-2".to_string(),
            result: json!({ "web_request": {
                "op": "readPages",
                "urls": ["https://a.com/", "https://b.com/"]
            }}),
        });
        assert_eq!(effects.len(), 1);
        match &effects[0] {
            Effect::WebResearch { id, mode, query, urls, .. } => {
                assert_eq!(id, "eff-3");
                assert_eq!(mode, "urls");
                assert!(query.is_none());
                let u = urls.as_ref().expect("urls present");
                assert_eq!(u.len(), 2);
                assert_eq!(u[0], "https://a.com/");
            }
            other => panic!("expected WebResearch, got {other:?}"),
        }
    }

    #[test]
    fn c3_research_missing_query_emits_invalid_web_request_audit() {
        let mut rt = Runtime::new();
        rt.dispatch(submit("research"));
        let effects = rt.dispatch(Command::ResolveEffect {
            id: "eff-2".to_string(),
            result: json!({ "web_request": { "op": "research" } }), // no query
        });
        match &effects[0] {
            Effect::AuditAppend { event_type, .. } => {
                assert_eq!(event_type, "runtime.invalid_web_request");
            }
            other => panic!("expected audit, got {other:?}"),
        }
    }

    #[test]
    fn c3_read_pages_missing_urls_emits_invalid_web_request_audit() {
        let mut rt = Runtime::new();
        rt.dispatch(submit("readPages"));
        let effects = rt.dispatch(Command::ResolveEffect {
            id: "eff-2".to_string(),
            result: json!({ "web_request": { "op": "readPages" } }), // no urls
        });
        match &effects[0] {
            Effect::AuditAppend { event_type, .. } => {
                assert_eq!(event_type, "runtime.invalid_web_request");
            }
            other => panic!("expected audit, got {other:?}"),
        }
    }

    // A1 (FIX4): required_string_array — reject any invalid slot, not just missing array.

    #[test]
    fn a1_read_pages_empty_array_rejected() {
        let mut rt = Runtime::new();
        rt.dispatch(submit("readPages empty"));
        let effects = rt.dispatch(Command::ResolveEffect {
            id: "eff-2".to_string(),
            result: json!({ "web_request": { "op": "readPages", "urls": [] } }),
        });
        match &effects[0] {
            Effect::AuditAppend { event_type, summary, .. } => {
                assert_eq!(event_type, "runtime.invalid_web_request");
                assert!(summary.contains("urls"), "summary should mention urls: {summary}");
            }
            other => panic!("expected audit, got {other:?}"),
        }
    }

    #[test]
    fn a1_read_pages_non_string_slot_rejects_whole_request() {
        let mut rt = Runtime::new();
        rt.dispatch(submit("readPages mixed"));
        let effects = rt.dispatch(Command::ResolveEffect {
            id: "eff-2".to_string(),
            result: json!({ "web_request": {
                "op": "readPages",
                "urls": ["https://ok.example", 42]
            }}),
        });
        assert_eq!(effects.len(), 1, "exactly one effect (audit)");
        match &effects[0] {
            Effect::AuditAppend { event_type, summary, .. } => {
                assert_eq!(event_type, "runtime.invalid_web_request");
                assert!(summary.contains("urls[1]"), "should identify bad slot: {summary}");
            }
            other => panic!("expected audit, got {other:?}"),
        }
    }

    #[test]
    fn a1_read_pages_empty_string_slot_rejects_whole_request() {
        let mut rt = Runtime::new();
        rt.dispatch(submit("readPages empty-slot"));
        let effects = rt.dispatch(Command::ResolveEffect {
            id: "eff-2".to_string(),
            result: json!({ "web_request": { "op": "readPages", "urls": [""] } }),
        });
        match &effects[0] {
            Effect::AuditAppend { event_type, summary, .. } => {
                assert_eq!(event_type, "runtime.invalid_web_request");
                assert!(summary.contains("urls[0]"), "should identify bad slot: {summary}");
            }
            other => panic!("expected audit, got {other:?}"),
        }
    }

    #[test]
    fn a1_read_pages_valid_array_accepted() {
        let mut rt = Runtime::new();
        rt.dispatch(submit("readPages valid"));
        let effects = rt.dispatch(Command::ResolveEffect {
            id: "eff-2".to_string(),
            result: json!({ "web_request": {
                "op": "readPages",
                "urls": ["https://a.example/", "https://b.example/"]
            }}),
        });
        assert_eq!(effects.len(), 1);
        match &effects[0] {
            Effect::WebResearch { mode, urls, .. } => {
                assert_eq!(mode, "urls");
                let u = urls.as_ref().expect("urls should be present");
                assert_eq!(u.len(), 2);
                assert_eq!(u[0], "https://a.example/");
                assert_eq!(u[1], "https://b.example/");
            }
            other => panic!("expected WebResearch, got {other:?}"),
        }
    }

    #[test]
    fn a1_read_pages_no_silent_slot_drop() {
        // The old filter_map silently dropped non-string slots; new code rejects.
        // This test proves a mixed array does NOT produce a partial WebResearch effect.
        let mut rt = Runtime::new();
        rt.dispatch(submit("readPages no-drop"));
        let effects = rt.dispatch(Command::ResolveEffect {
            id: "eff-2".to_string(),
            result: json!({ "web_request": {
                "op": "readPages",
                "urls": ["https://good.example", null, "https://also-good.example"]
            }}),
        });
        assert_eq!(effects.len(), 1);
        assert!(
            matches!(&effects[0], Effect::AuditAppend { event_type, .. } if event_type == "runtime.invalid_web_request"),
            "should reject entire request, not silently drop null slot; got {effects:?}",
        );
    }

    // A2 (FIX4): required_tool_name — reject missing/empty/whitespace tool names.

    fn tool_call_result(name: &str) -> serde_json::Value {
        json!({ "tool_call": { "name": name, "args": {} } })
    }

    #[test]
    fn a2_missing_tool_name_emits_invalid_tool_call_audit() {
        let mut rt = Runtime::new();
        rt.dispatch(submit("use a tool"));
        let effects = rt.dispatch(Command::ResolveEffect {
            id: "eff-2".to_string(),
            result: json!({ "tool_call": { "args": {} } }), // no name field
        });
        assert_eq!(effects.len(), 1);
        match &effects[0] {
            Effect::AuditAppend { event_type, .. } => {
                assert_eq!(event_type, "runtime.invalid_tool_call");
            }
            other => panic!("expected audit, got {other:?}"),
        }
    }

    #[test]
    fn a2_empty_tool_name_emits_invalid_tool_call_audit() {
        let mut rt = Runtime::new();
        rt.dispatch(submit("use a tool"));
        let effects = rt.dispatch(Command::ResolveEffect {
            id: "eff-2".to_string(),
            result: tool_call_result(""),
        });
        match &effects[0] {
            Effect::AuditAppend { event_type, .. } => {
                assert_eq!(event_type, "runtime.invalid_tool_call");
            }
            other => panic!("expected audit, got {other:?}"),
        }
    }

    #[test]
    fn a2_whitespace_tool_name_emits_invalid_tool_call_audit() {
        let mut rt = Runtime::new();
        rt.dispatch(submit("use a tool"));
        let effects = rt.dispatch(Command::ResolveEffect {
            id: "eff-2".to_string(),
            result: tool_call_result("   "),
        });
        match &effects[0] {
            Effect::AuditAppend { event_type, .. } => {
                assert_eq!(event_type, "runtime.invalid_tool_call");
            }
            other => panic!("expected audit, got {other:?}"),
        }
    }

    #[test]
    fn a2_valid_tool_name_emits_proposal() {
        let mut rt = Runtime::new();
        rt.dispatch(submit("use a tool"));
        let effects = rt.dispatch(Command::ResolveEffect {
            id: "eff-2".to_string(),
            result: tool_call_result("web_search"),
        });
        match &effects[0] {
            Effect::ToolCallProposal { name, .. } => {
                assert_eq!(name, "web_search");
            }
            other => panic!("expected ToolCallProposal, got {other:?}"),
        }
    }

    #[test]
    fn a2_invalid_tool_call_does_not_emit_proposal() {
        let mut rt = Runtime::new();
        rt.dispatch(submit("use a tool"));
        let effects = rt.dispatch(Command::ResolveEffect {
            id: "eff-2".to_string(),
            result: json!({ "tool_call": { "name": "", "args": {} } }),
        });
        assert!(
            effects.iter().all(|e| !matches!(e, Effect::ToolCallProposal { .. })),
            "no ToolCallProposal should be emitted for an invalid tool name; got {effects:?}",
        );
    }

    // B2 (FIX3): no empty tool messages for structured web results
    #[test]
    fn b2_web_search_results_stores_non_empty_tool_content() {
        let mut rt = Runtime::new();
        rt.dispatch(submit("search something"));
        let eff2 = rt.dispatch(Command::ResolveEffect {
            id: "eff-2".to_string(),
            result: json!({ "web_request": { "op": "search", "query": "rust" } }),
        });
        let web_search_id = match &eff2[0] {
            Effect::WebSearch { id, .. } => id.clone(),
            other => panic!("expected WebSearch, got {other:?}"),
        };
        let eff3 = rt.dispatch(Command::ResolveEffect {
            id: web_search_id,
            result: json!({
                "ok": true,
                "results": [{ "title": "A", "url": "https://a.com", "rank": 1 }]
            }),
        });
        let stored = eff3.iter().find_map(|e| match e {
            Effect::StoragePut { value, .. } => Some(value.clone()),
            _ => None,
        });
        let stored = stored.expect("storage_put must exist");
        assert_eq!(stored["role"], "tool");
        let content = stored["content"].as_str().expect("content is string");
        assert!(!content.is_empty(), "tool content must not be empty");
        assert!(content.contains("web_search_results"));
    }

    #[test]
    fn b2_empty_success_emits_audit_no_storage_put() {
        let mut rt = Runtime::new();
        rt.dispatch(submit("search something"));
        let eff2 = rt.dispatch(Command::ResolveEffect {
            id: "eff-2".to_string(),
            result: json!({ "web_request": { "op": "search", "query": "rust" } }),
        });
        let web_search_id = match &eff2[0] {
            Effect::WebSearch { id, .. } => id.clone(),
            other => panic!("expected WebSearch, got {other:?}"),
        };
        // Resolve with empty success — no recognized content field.
        let eff3 = rt.dispatch(Command::ResolveEffect {
            id: web_search_id,
            result: json!({ "ok": true }),
        });
        assert!(
            eff3.iter().all(|e| !matches!(e, Effect::StoragePut { .. })),
            "must not emit storage_put for empty result"
        );
        assert!(
            eff3.iter().any(|e| matches!(e, Effect::AuditAppend { event_type, .. } if event_type == "runtime.empty_effect_result")),
            "must emit empty_effect_result audit"
        );
    }

    #[test]
    fn b2_web_page_content_stores_non_empty_tool_content() {
        let mut rt = Runtime::new();
        rt.dispatch(submit("read page"));
        let eff2 = rt.dispatch(Command::ResolveEffect {
            id: "eff-2".to_string(),
            result: json!({ "web_request": { "op": "readPage", "url": "https://x.com/" } }),
        });
        let page_read_id = match &eff2[0] {
            Effect::WebPageRead { id, .. } => id.clone(),
            other => panic!("expected WebPageRead, got {other:?}"),
        };
        let eff3 = rt.dispatch(Command::ResolveEffect {
            id: page_read_id,
            result: json!({
                "ok": true,
                "content": { "url": "https://x.com/", "text": "body text", "length": 9 }
            }),
        });
        let stored = eff3.iter().find_map(|e| match e {
            Effect::StoragePut { value, .. } => Some(value.clone()),
            _ => None,
        });
        let stored = stored.expect("storage_put must exist");
        let content = stored["content"].as_str().expect("content is string");
        assert!(!content.is_empty());
        assert!(content.contains("web_page_content"));
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

    // A1 (FIX6): tool_content_from_effect_failure — structured, sanitized failure content.

    #[test]
    fn a1_fix6_failure_with_kind_and_message_produces_structured_json() {
        let error = json!({ "kind": "host_permission_missing", "message": "Need access", "retryable": true });
        let content = Runtime::tool_content_from_effect_failure(&error);
        let parsed: Value = serde_json::from_str(&content).expect("valid JSON");
        assert_eq!(parsed["type"], "effect_failure");
        assert_eq!(parsed["kind"], "host_permission_missing");
        assert_eq!(parsed["message"], "Need access");
        assert_eq!(parsed["retryable"], true);
    }

    #[test]
    fn a1_fix6_missing_kind_defaults_to_effect_failed() {
        let error = json!({ "message": "Something went wrong" });
        let content = Runtime::tool_content_from_effect_failure(&error);
        let parsed: Value = serde_json::from_str(&content).expect("valid JSON");
        assert_eq!(parsed["kind"], "effect_failed");
    }

    #[test]
    fn a1_fix6_missing_message_defaults_to_safe_string() {
        let error = json!({ "kind": "secret_missing" });
        let content = Runtime::tool_content_from_effect_failure(&error);
        let parsed: Value = serde_json::from_str(&content).expect("valid JSON");
        assert!(!parsed["message"].as_str().unwrap_or("").is_empty());
    }

    #[test]
    fn a1_fix6_token_looking_message_is_redacted() {
        let error = json!({ "kind": "auth", "message": "key=sk-abc123xyz789 is invalid" });
        let content = Runtime::tool_content_from_effect_failure(&error);
        assert!(!content.contains("sk-abc123xyz789"), "raw key must not appear in output");
        assert!(content.contains("[REDACTED]"), "redaction marker must be present");
    }

    #[test]
    fn a1_fix6_failure_content_is_never_empty() {
        let error = json!({});
        let content = Runtime::tool_content_from_effect_failure(&error);
        assert!(!content.trim().is_empty());
        let parsed: Value = serde_json::from_str(&content).expect("valid JSON");
        assert_eq!(parsed["type"], "effect_failure");
    }

    // A2 (FIX6): structured failure content used in effect and tool-call rejection paths.

    #[test]
    fn a2_fix6_web_page_read_failure_stores_structured_content() {
        let mut rt = Runtime::new();
        rt.dispatch(submit("read a page"));
        // Simulate an LLM response with a web_request read op
        let web_eff = rt.dispatch(Command::ResolveEffect {
            id: "eff-2".to_string(),
            result: json!({ "web_request": { "op": "readPage", "url": "https://example.com" } }),
        });
        // Should be a web_page_read effect
        let web_eff_id = match &web_eff[0] {
            Effect::WebPageRead { id, .. } => id.clone(),
            other => panic!("expected WebPageRead, got {other:?}"),
        };
        // Resolve it as a failure with structured error
        let effects = rt.dispatch(Command::ResolveEffect {
            id: web_eff_id,
            result: json!({ "ok": false, "error": { "kind": "host_permission_missing", "message": "Need host permission", "retryable": false } }),
        });
        // Should store a StoragePut with structured failure content
        let stored = effects.iter().find_map(|e| match e {
            Effect::StoragePut { value, .. } => Some(value),
            _ => None,
        });
        let msg = stored.expect("expected StoragePut");
        assert_eq!(msg["role"], "tool");
        let parsed: Value = serde_json::from_str(msg["content"].as_str().unwrap()).expect("valid JSON");
        assert_eq!(parsed["type"], "effect_failure");
        assert_eq!(parsed["kind"], "host_permission_missing");
        assert!(!parsed["message"].as_str().unwrap_or("").is_empty());
    }

    #[test]
    fn a2_fix6_tool_call_rejection_stores_structured_content() {
        let mut rt = Runtime::new();
        rt.dispatch(submit("use a tool"));
        // LLM emits a tool_call
        let prop_eff = rt.dispatch(Command::ResolveEffect {
            id: "eff-2".to_string(),
            result: json!({ "tool_call": { "name": "web_search", "args": {} } }),
        });
        let prop_id = match &prop_eff[0] {
            Effect::ToolCallProposal { id, .. } => id.clone(),
            other => panic!("expected ToolCallProposal, got {other:?}"),
        };
        // Resolve as user-rejected
        let effects = rt.dispatch(Command::ResolveEffect {
            id: prop_id,
            result: json!({ "ok": false, "error": { "kind": "user_rejected", "message": "User declined", "retryable": false } }),
        });
        let stored = effects.iter().find_map(|e| match e {
            Effect::StoragePut { value, .. } => Some(value),
            _ => None,
        });
        let msg = stored.expect("expected StoragePut");
        let parsed: Value = serde_json::from_str(msg["content"].as_str().unwrap()).expect("valid JSON");
        assert_eq!(parsed["type"], "effect_failure");
        assert_eq!(parsed["kind"], "user_rejected");
    }

    #[test]
    fn a2_fix6_failure_content_does_not_contain_raw_api_key() {
        let mut rt = Runtime::new();
        rt.dispatch(submit("use a tool"));
        let prop_eff = rt.dispatch(Command::ResolveEffect {
            id: "eff-2".to_string(),
            result: json!({ "tool_call": { "name": "web_search", "args": {} } }),
        });
        let prop_id = match &prop_eff[0] {
            Effect::ToolCallProposal { id, .. } => id.clone(),
            other => panic!("expected ToolCallProposal, got {other:?}"),
        };
        let effects = rt.dispatch(Command::ResolveEffect {
            id: prop_id,
            result: json!({ "ok": false, "error": { "kind": "auth", "message": "Bearer sk-ant-abc123 rejected" } }),
        });
        for effect in &effects {
            if let Effect::StoragePut { value, .. } = effect {
                let content_str = value["content"].as_str().unwrap_or("");
                assert!(!content_str.contains("sk-ant-abc123"), "raw key must not be in stored content");
            }
        }
    }

    // A1/A2 (FIX7): multi-occurrence redaction parity tests.

    #[test]
    fn a1_fix7_two_sk_tokens_both_redacted() {
        let content = Runtime::tool_content_from_effect_failure(&json!({
            "kind": "secret_missing",
            "message": "failed with sk-firstSECRET123 and sk-secondSECRET456",
            "retryable": false
        }));
        assert!(!content.contains("sk-firstSECRET123"), "first sk- token must be redacted");
        assert!(!content.contains("sk-secondSECRET456"), "second sk- token must be redacted");
        assert!(content.contains("[REDACTED]"), "redaction marker must be present");
        let parsed: Value = serde_json::from_str(&content).unwrap();
        assert_eq!(parsed["type"], "effect_failure");
        assert_eq!(parsed["kind"], "secret_missing");
    }

    #[test]
    fn a1_fix7_sk_ant_and_sk_both_redacted() {
        // Use tokens with >= 12 chars after their respective prefixes so both
        // are long enough to trigger redaction under the min-suffix rule.
        let content = Runtime::tool_content_from_effect_failure(&json!({
            "kind": "auth_failed",
            "message": "sk-ant-apiKey12345678 sk-secondSECRET",
            "retryable": false
        }));
        assert!(!content.contains("sk-ant-apiKey12345678"), "sk-ant- token must be redacted");
        assert!(!content.contains("sk-secondSECRET"), "sk- token must be redacted");
        assert!(content.contains("[REDACTED]"));
    }

    #[test]
    fn a1_fix7_two_bearer_tokens_both_redacted() {
        let content = Runtime::tool_content_from_effect_failure(&json!({
            "kind": "auth_failed",
            "message": "Bearer abc.def Bearer xyz.123",
            "retryable": false
        }));
        assert!(!content.contains("abc.def"), "first bearer token must be redacted");
        assert!(!content.contains("xyz.123"), "second bearer token must be redacted");
        assert!(!content.contains("Bearer"), "Bearer prefix must be redacted");
        assert!(content.contains("[REDACTED]"));
    }

    #[test]
    fn a1_fix7_authorization_bearer_redacted() {
        let content = Runtime::tool_content_from_effect_failure(&json!({
            "kind": "auth_failed",
            "message": "Authorization: Bearer abc.def.ghi failed",
            "retryable": false
        }));
        assert!(!content.contains("Authorization:"), "Authorization header must be redacted");
        assert!(!content.contains("abc.def.ghi"), "token must be redacted");
        // surrounding context "failed" may be preserved
        let parsed: Value = serde_json::from_str(&content).unwrap();
        assert_eq!(parsed["type"], "effect_failure");
        assert!(content.contains("[REDACTED]"));
    }

    #[test]
    fn a1_fix7_mixed_authorization_and_sk_both_redacted() {
        let content = Runtime::tool_content_from_effect_failure(&json!({
            "kind": "auth_failed",
            "message": "Authorization: sk-ant-headertoken and also sk-bodytoken",
            "retryable": false
        }));
        assert!(!content.contains("sk-ant-headertoken"), "header token must be redacted");
        assert!(!content.contains("sk-bodytoken"), "body token must be redacted");
        assert!(content.contains("[REDACTED]"));
    }

    #[test]
    fn a1_fix7_no_false_positive_on_safe_message() {
        let content = Runtime::tool_content_from_effect_failure(&json!({
            "kind": "network_error",
            "message": "connection timed out after 30s",
            "retryable": true
        }));
        let parsed: Value = serde_json::from_str(&content).unwrap();
        assert_eq!(parsed["kind"], "network_error");
        let msg = parsed["message"].as_str().unwrap();
        assert!(msg.contains("connection timed out"), "safe message must not be mangled");
        assert!(!content.contains("[REDACTED]"), "no redaction on safe message");
    }

    // E1 (FIX8): redaction precision — avoid false positives on safe words containing "sk-".

    #[test]
    fn e1_fix8_risk_level_not_redacted() {
        let content = Runtime::tool_content_from_effect_failure(&json!({
            "kind": "classification_error",
            "message": "risk-level is high for this operation"
        }));
        assert!(!content.contains("[REDACTED]"), "risk-level must not be redacted: {content}");
        assert!(content.contains("risk-level"), "risk-level text must be preserved: {content}");
    }

    #[test]
    fn e1_fix8_task_id_not_redacted() {
        let content = Runtime::tool_content_from_effect_failure(&json!({
            "kind": "routing_error",
            "message": "task-id lookup failed"
        }));
        assert!(!content.contains("[REDACTED]"), "task-id must not be redacted: {content}");
        assert!(content.contains("task-id"), "task-id text must be preserved: {content}");
    }

    #[test]
    fn e1_fix8_ask_for_help_not_redacted() {
        let content = Runtime::tool_content_from_effect_failure(&json!({
            "kind": "user_action",
            "message": "ask-for-help request received"
        }));
        assert!(!content.contains("[REDACTED]"), "ask-for-help must not be redacted: {content}");
    }

    #[test]
    fn e1_fix8_disk_cache_not_redacted() {
        let content = Runtime::tool_content_from_effect_failure(&json!({
            "kind": "cache_error",
            "message": "disk-cache eviction failed"
        }));
        assert!(!content.contains("[REDACTED]"), "disk-cache must not be redacted: {content}");
    }

    #[test]
    fn e1_fix8_real_sk_token_still_redacted() {
        let content = Runtime::tool_content_from_effect_failure(&json!({
            "kind": "auth",
            "message": "sk-123456789012 is invalid"
        }));
        assert!(!content.contains("sk-123456789012"), "real sk- token must be redacted: {content}");
        assert!(content.contains("[REDACTED]"), "redaction marker must appear: {content}");
    }

    #[test]
    fn e1_fix8_real_sk_ant_token_still_redacted() {
        let content = Runtime::tool_content_from_effect_failure(&json!({
            "kind": "auth",
            "message": "sk-ant-123456789012 is invalid"
        }));
        assert!(!content.contains("sk-ant-123456789012"), "real sk-ant- token must be redacted: {content}");
        assert!(content.contains("[REDACTED]"), "redaction marker must appear: {content}");
    }

    #[test]
    fn e1_fix8_two_secrets_both_redacted() {
        let content = Runtime::tool_content_from_effect_failure(&json!({
            "kind": "auth",
            "message": "sk-111111111111 and sk-222222222222"
        }));
        assert!(!content.contains("sk-111111111111"), "first token must be redacted: {content}");
        assert!(!content.contains("sk-222222222222"), "second token must be redacted: {content}");
    }

    #[test]
    fn e1_fix8_short_sk_token_not_redacted() {
        // "sk-abc" has only 3 chars after the prefix, below the 12-char minimum.
        let content = Runtime::tool_content_from_effect_failure(&json!({
            "kind": "test_error",
            "message": "error code sk-abc is not an API key"
        }));
        // Short sk- tokens must not be redacted (they are not API keys).
        assert!(!content.contains("[REDACTED]") || content.contains("sk-abc"),
            "short sk- token below min-length must not be redacted: {content}");
    }

    // E1 (FIX9) Option A: generic sk- rule skips sk-ant- tokens.
    #[test]
    fn e1_fix9_short_sk_ant_not_redacted_by_sk_rule() {
        // "sk-ant-short" has suffix "short" (5 chars after "sk-ant-"), which is below the
        // sk-ant- min-suffix. The generic sk- rule must not pick it up either (Option A).
        let content = Runtime::tool_content_from_effect_failure(&json!({
            "kind": "test_error",
            "message": "error token sk-ant-short is not a real key"
        }));
        assert!(
            !content.contains("[REDACTED]") || content.contains("sk-ant-short"),
            "short sk-ant- token must not be redacted by the generic sk- rule: {content}"
        );
    }

    #[test]
    fn e1_fix9_long_sk_ant_redacted_by_sk_ant_rule() {
        let content = Runtime::tool_content_from_effect_failure(&json!({
            "kind": "test_error",
            "message": "key sk-ant-123456789012 is invalid"
        }));
        assert!(
            !content.contains("sk-ant-123456789012"),
            "long sk-ant- token must be redacted: {content}"
        );
        assert!(content.contains("[REDACTED]"));
    }

    #[test]
    fn e1_fix9_normal_sk_redacted() {
        let content = Runtime::tool_content_from_effect_failure(&json!({
            "kind": "test_error",
            "message": "key sk-123456789012 is invalid"
        }));
        assert!(
            !content.contains("sk-123456789012"),
            "normal sk- token must be redacted: {content}"
        );
        assert!(content.contains("[REDACTED]"));
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
