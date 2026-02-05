use async_trait::async_trait;

use crate::function_tool::FunctionCallError;
use crate::tools::context::ToolInvocation;
use crate::tools::context::ToolOutput;
use crate::tools::context::ToolPayload;
use crate::tools::handlers::parse_arguments;
use crate::tools::registry::ToolHandler;
use crate::tools::registry::ToolKind;
use codex_protocol::config_types::ModeKind;
use codex_protocol::request_user_input::RequestUserInputArgs;

#[cfg(test)]
fn request_user_input_is_available_in_mode(_mode: ModeKind) -> bool {
    true
}

pub(crate) fn request_user_input_unavailable_message(_mode: ModeKind) -> Option<String> {
    None
}

pub(crate) fn request_user_input_tool_description() -> String {
    format!(
        "Request user input for one to three short questions and wait for the response. This tool is available in all collaboration modes."
    )
}

pub struct RequestUserInputHandler;

#[async_trait]
impl ToolHandler for RequestUserInputHandler {
    fn kind(&self) -> ToolKind {
        ToolKind::Function
    }

    async fn handle(&self, invocation: ToolInvocation) -> Result<ToolOutput, FunctionCallError> {
        let ToolInvocation {
            session,
            turn,
            call_id,
            payload,
            ..
        } = invocation;

        let arguments = match payload {
            ToolPayload::Function { arguments } => arguments,
            _ => {
                return Err(FunctionCallError::RespondToModel(
                    "request_user_input handler received unsupported payload".to_string(),
                ));
            }
        };

        let mode = session.collaboration_mode().await.mode;
        if let Some(message) = request_user_input_unavailable_message(mode) {
            return Err(FunctionCallError::RespondToModel(message));
        }

        let mut args: RequestUserInputArgs = parse_arguments(&arguments)?;
        let missing_options = args
            .questions
            .iter()
            .any(|question| question.options.as_ref().is_none_or(Vec::is_empty));
        if missing_options {
            return Err(FunctionCallError::RespondToModel(
                "request_user_input requires non-empty options for every question".to_string(),
            ));
        }
        for question in &mut args.questions {
            question.is_other = true;
        }
        let response = session
            .request_user_input(turn.as_ref(), call_id, args)
            .await
            .ok_or_else(|| {
                FunctionCallError::RespondToModel(
                    "request_user_input was cancelled before receiving a response".to_string(),
                )
            })?;

        let content = serde_json::to_string(&response).map_err(|err| {
            FunctionCallError::Fatal(format!(
                "failed to serialize request_user_input response: {err}"
            ))
        })?;

        Ok(ToolOutput::Function {
            content,
            content_items: None,
            success: Some(true),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use pretty_assertions::assert_eq;

    #[test]
    fn request_user_input_mode_availability_is_all_modes() {
        assert_eq!(
            request_user_input_is_available_in_mode(ModeKind::Plan),
            true
        );
        assert_eq!(
            request_user_input_is_available_in_mode(ModeKind::Default),
            true
        );
        assert_eq!(
            request_user_input_is_available_in_mode(ModeKind::Execute),
            true
        );
        assert_eq!(
            request_user_input_is_available_in_mode(ModeKind::PairProgramming),
            true
        );
    }

    #[test]
    fn request_user_input_unavailable_messages_are_none() {
        assert_eq!(request_user_input_unavailable_message(ModeKind::Plan), None);
        assert_eq!(
            request_user_input_unavailable_message(ModeKind::Default),
            None
        );
        assert_eq!(
            request_user_input_unavailable_message(ModeKind::Execute),
            None
        );
        assert_eq!(
            request_user_input_unavailable_message(ModeKind::PairProgramming),
            None
        );
    }

    #[test]
    fn request_user_input_tool_description_mentions_all_modes() {
        assert_eq!(
            request_user_input_tool_description(),
            "Request user input for one to three short questions and wait for the response. This tool is available in all collaboration modes.".to_string()
        );
    }
}
