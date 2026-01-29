#[derive(Clone, Copy, Debug, Default)]
pub struct PromptSuggestionGate {
    pub suggestions_enabled: bool,
    pub autorun_enabled: bool,
    pub intent: bool,
    pub is_review_mode: bool,
    pub task_running: bool,
    pub composer_empty: bool,
    pub no_modal_or_popup_active: bool,
    pub queued_user_messages_empty: bool,
}

impl PromptSuggestionGate {
    pub fn can_autorun(self) -> bool {
        self.autorun_enabled
            && self.suggestions_enabled
            && self.intent
            && !self.is_review_mode
            && !self.task_running
            && self.composer_empty
            && self.no_modal_or_popup_active
            && self.queued_user_messages_empty
    }

    pub fn can_open_view(self) -> bool {
        self.suggestions_enabled
            && !self.is_review_mode
            && !self.task_running
            && self.composer_empty
            && self.no_modal_or_popup_active
    }
}
