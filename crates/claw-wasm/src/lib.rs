//! wasm-bindgen bindings exposing the deterministic runtime to the TypeScript
//! host. Commands and effects cross the boundary as JSON strings so the schema
//! stays language-neutral; the host parses effects and routes them through the
//! Redux listener middleware.

use claw_core::Runtime;
use claw_schema::Command;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct ClawRuntime {
    inner: Runtime,
}

#[wasm_bindgen]
impl ClawRuntime {
    #[wasm_bindgen(constructor)]
    pub fn new() -> ClawRuntime {
        ClawRuntime {
            inner: Runtime::new(),
        }
    }

    /// Restore a runtime from a snapshot JSON string.
    #[wasm_bindgen(js_name = fromSnapshot)]
    pub fn from_snapshot(snapshot_json: &str) -> Result<ClawRuntime, JsError> {
        let value: serde_json::Value =
            serde_json::from_str(snapshot_json).map_err(|e| JsError::new(&e.to_string()))?;
        let inner = Runtime::from_snapshot(&value).map_err(|e| JsError::new(&e))?;
        Ok(ClawRuntime { inner })
    }

    /// Dispatch a command (JSON) and return the emitted effects (JSON array).
    pub fn dispatch(&mut self, command_json: &str) -> Result<String, JsError> {
        let command: Command =
            serde_json::from_str(command_json).map_err(|e| JsError::new(&e.to_string()))?;
        let effects = self.inner.dispatch(command);
        serde_json::to_string(&effects).map_err(|e| JsError::new(&e.to_string()))
    }

    /// Serialize the current runtime state for persistence.
    pub fn snapshot(&self) -> Result<String, JsError> {
        serde_json::to_string(&self.inner.snapshot()).map_err(|e| JsError::new(&e.to_string()))
    }
}

impl Default for ClawRuntime {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dispatch_returns_effects_json() {
        let mut rt = ClawRuntime::new();
        let json = rt
            .dispatch(r#"{"type":"submit_user_message","conversation_id":"c1","text":"hi"}"#)
            .expect("dispatch");
        assert!(json.contains("llm_request"));
        assert!(json.contains("audit_append"));
    }

    #[test]
    fn snapshot_roundtrips_through_json() {
        let mut rt = ClawRuntime::new();
        rt.dispatch(r#"{"type":"submit_user_message","conversation_id":"c1","text":"hi"}"#)
            .expect("dispatch");
        let snap = rt.snapshot().expect("snapshot");
        let restored = ClawRuntime::from_snapshot(&snap).expect("restore");
        assert_eq!(restored.snapshot().unwrap(), snap);
    }
}
