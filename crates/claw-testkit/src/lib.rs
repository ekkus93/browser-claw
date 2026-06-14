//! Test helpers for driving the runtime through command scripts and asserting
//! on the effects produced.

use claw_core::Runtime;
use claw_schema::{Command, Effect};

/// Run a sequence of commands against a fresh runtime, returning the runtime
/// and the flattened effects it emitted.
pub fn run_script(commands: impl IntoIterator<Item = Command>) -> (Runtime, Vec<Effect>) {
    let mut runtime = Runtime::new();
    let mut effects = Vec::new();
    for command in commands {
        effects.extend(runtime.dispatch(command));
    }
    (runtime, effects)
}

/// Convenience constructor for a user-message command.
pub fn user_message(conversation_id: &str, text: &str) -> Command {
    Command::SubmitUserMessage {
        conversation_id: conversation_id.to_string(),
        text: text.to_string(),
        skill_id: String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn run_script_collects_effects_in_order() {
        let (_runtime, effects) = run_script([user_message("c1", "hi")]);
        assert_eq!(effects.len(), 2);
        assert!(matches!(effects[0], Effect::AuditAppend { .. }));
        assert!(matches!(effects[1], Effect::LlmRequest { .. }));
    }
}
