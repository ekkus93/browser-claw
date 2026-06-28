//! Shared schema for the BrowserClaw deterministic runtime: the effects the
//! runtime emits, the commands the host sends in, and the serializable runtime
//! state used for snapshots. These types are the contract between the
//! Rust/WASM core and the TypeScript host.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

/// A side effect the runtime asks the host to perform. The runtime never
/// performs I/O itself — it only describes effects. Decrypted secrets never
/// appear in any effect payload.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Effect {
    LlmRequest {
        id: String,
        conversation_id: String,
        prompt: String,
    },
    StorageGet {
        id: String,
        store: String,
        key: String,
    },
    StoragePut {
        id: String,
        /// Conversation that triggered this write, so the host can persist a
        /// correctly-scoped record (e.g. a chat message row needs its
        /// conversation id). Defaults to empty for effects with no conversation
        /// context.
        #[serde(default)]
        conversation_id: String,
        store: String,
        key: String,
        value: Value,
    },
    StorageSearch {
        id: String,
        store: String,
        query: String,
    },
    ToolCallProposal {
        id: String,
        /// The skill that requested the tool, so the host can enforce that the
        /// skill actually declared this tool before running it (fail closed).
        /// Empty means "no active skill" — such a call is denied.
        #[serde(default)]
        skill_id: String,
        name: String,
        args: Value,
        risk: String,
    },
    SkillFsReadText {
        id: String,
        skill_id: String,
        path: String,
    },
    SkillStateGet {
        id: String,
        skill_id: String,
        key: String,
    },
    SkillStatePut {
        id: String,
        skill_id: String,
        key: String,
        value: Value,
    },
    AuditAppend {
        id: String,
        event_type: String,
        summary: String,
        risk: String,
    },
    RuntimeSnapshotSave {
        id: String,
        snapshot: Value,
    },
    /// The model emitted a structured plan; the host decides whether to execute it.
    ScriptPlanProposal {
        id: String,
        plan: Value,
    },
    /// The model requested sandboxed script execution; the host gates it behind approval.
    SandboxScriptProposal {
        id: String,
        request: Value,
    },
    /// The model requested a web search; the host executes it (no approval needed).
    WebSearch {
        id: String,
        query: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        options: Option<Value>,
    },
    /// The model requested reading a specific page; the host gates it behind approval.
    WebPageRead {
        id: String,
        url: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        options: Option<Value>,
    },
    /// The model requested a bulk web research bundle; the host gates it behind approval.
    WebResearch {
        id: String,
        query: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        options: Option<Value>,
    },
    /// The model requested an extension operation (e.g. read_current_tab).
    ExtensionRequest {
        id: String,
        request: Value,
    },
}

/// A command the host sends into the runtime.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Command {
    SubmitUserMessage {
        conversation_id: String,
        text: String,
        /// The skill active in this conversation, if any. Tool calls in the
        /// resulting turn are attributed to it for permission enforcement.
        #[serde(default)]
        skill_id: String,
    },
    /// Deliver the result of a previously emitted effect back to the runtime.
    ResolveEffect { id: String, result: Value },
}

/// Serializable runtime state. Deterministic — no clocks, randomness, or I/O.
/// Effect ids come from a monotonic counter so a given command sequence always
/// produces identical effects (a core acceptance property).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct RuntimeState {
    pub next_effect_id: u64,
    pub message_count: u64,
    /// Outstanding effect id -> effect kind awaiting resolution.
    pub pending: BTreeMap<String, String>,
    /// Outstanding effect id -> originating conversation id, so an effect
    /// resolved later (e.g. a stored assistant message) stays conversation
    /// scoped. Additive + defaulted: snapshots predating this field restore
    /// with it empty.
    #[serde(default)]
    pub pending_conversation: BTreeMap<String, String>,
    /// Outstanding effect id -> originating skill id, so a tool call proposed
    /// from a turn stays attributed to the skill that may run it. Additive +
    /// defaulted.
    #[serde(default)]
    pub pending_skill: BTreeMap<String, String>,
}
