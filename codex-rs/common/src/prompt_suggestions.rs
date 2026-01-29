use codex_core::features::Feature;

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

#[derive(Clone, Copy, Debug, Default)]
pub struct PromptSuggestionsSettings {
    pub enabled: bool,
    pub autorun_enabled: bool,
}

impl PromptSuggestionsSettings {
    pub fn toggle_enabled(mut self) -> (Self, Vec<(Feature, bool)>) {
        self.enabled = !self.enabled;
        let mut updates = vec![(Feature::PromptSuggestions, self.enabled)];
        if !self.enabled && self.autorun_enabled {
            self.autorun_enabled = false;
            updates.push((Feature::PromptSuggestionsAutorun, false));
        }
        (self, updates)
    }

    pub fn toggle_autorun(mut self) -> (Self, Vec<(Feature, bool)>) {
        let mut updates = Vec::new();
        if !self.enabled {
            self.enabled = true;
            updates.push((Feature::PromptSuggestions, true));
        }
        self.autorun_enabled = !self.autorun_enabled;
        updates.push((Feature::PromptSuggestionsAutorun, self.autorun_enabled));
        (self, updates)
    }
}
