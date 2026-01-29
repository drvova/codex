use crate::key_hint;
use crate::key_hint::KeyBinding;
use crossterm::event::KeyCode;
use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::Stylize;
use ratatui::text::Line;
use ratatui::text::Span;
use ratatui::widgets::Paragraph;
use ratatui::widgets::Widget;

const FOOTER_INDENT_COLS: usize = 2;

#[derive(Clone, Copy, Debug)]
pub(crate) struct FooterProps {
    pub(crate) mode: FooterMode,
    pub(crate) esc_backtrack_hint: bool,
    pub(crate) use_shift_enter_hint: bool,
    pub(crate) is_task_running: bool,
    /// Which key the user must press again to quit.
    pub(crate) quit_shortcut_key: KeyBinding,
    pub(crate) steer_enabled: bool,
    pub(crate) context_window_percent: Option<i64>,
    pub(crate) context_window_used_tokens: Option<i64>,
    pub(crate) prompt_suggestions_enabled: bool,
    pub(crate) prompt_suggestions_autorun: bool,
    pub(crate) transcript_scrolled: bool,
    pub(crate) transcript_selection_active: bool,
    pub(crate) transcript_scroll_position: Option<(usize, usize)>,
    pub(crate) transcript_copy_selection_key: KeyBinding,
    pub(crate) transcript_copy_feedback: Option<crate::transcript_copy_action::TranscriptCopyFeedback>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum FooterMode {
    ShortcutSummary,
    ContextOnly,
    ShortcutOverlay,
    EscHint,
    QuitShortcutReminder,
}

pub(crate) fn toggle_shortcut_mode(current: FooterMode, ctrl_c_hint: bool) -> FooterMode {
    if ctrl_c_hint && matches!(current, FooterMode::QuitShortcutReminder) {
        return current;
    }

    match current {
        FooterMode::ShortcutOverlay | FooterMode::QuitShortcutReminder => {
            FooterMode::ShortcutSummary
        }
        _ => FooterMode::ShortcutOverlay,
    }
}

pub(crate) fn esc_hint_mode(current: FooterMode, is_task_running: bool) -> FooterMode {
    if is_task_running {
        current
    } else {
        FooterMode::EscHint
    }
}

pub(crate) fn reset_mode_after_activity(current: FooterMode) -> FooterMode {
    match current {
        FooterMode::EscHint | FooterMode::ShortcutOverlay | FooterMode::QuitShortcutReminder => {
            FooterMode::ShortcutSummary
        }
        other => other,
    }
}

pub(crate) fn footer_height(props: FooterProps) -> u16 {
    match props.mode {
        FooterMode::ShortcutOverlay => shortcut_overlay_lines(props).len() as u16,
        _ => 1,
    }
}

pub(crate) fn render_footer(area: Rect, buf: &mut Buffer, props: FooterProps) {
    match props.mode {
        FooterMode::ShortcutOverlay => {
            render_lines(area, buf, shortcut_overlay_lines(props));
        }
        FooterMode::EscHint => {
            render_lines(area, buf, vec![esc_hint_line(props.esc_backtrack_hint)]);
        }
        FooterMode::QuitShortcutReminder => {
            render_lines(area, buf, vec![quit_shortcut_reminder_line(props.quit_shortcut_key)]);
        }
        FooterMode::ContextOnly | FooterMode::ShortcutSummary => {
            let line = shortcut_summary_line();
            render_lines(area, buf, vec![line]);
            render_context_right(area, buf, &context_window_line(props));
        }
    }
}

fn render_lines(area: Rect, buf: &mut Buffer, lines: Vec<Line<'static>>) {
    if area.is_empty() || lines.is_empty() {
        return;
    }
    let indent = " ".repeat(FOOTER_INDENT_COLS);
    let lines = lines
        .into_iter()
        .map(|line| {
            let mut out = Line::from(vec![indent.clone().into()]);
            out.extend(line.spans);
            out
        })
        .collect::<Vec<_>>();
    Paragraph::new(lines).render(area, buf);
}

fn render_context_right(area: Rect, buf: &mut Buffer, line: &Line<'static>) {
    if area.is_empty() || line.width() == 0 {
        return;
    }
    let width = line.width() as u16;
    let right_padding = FOOTER_INDENT_COLS as u16;
    if width + right_padding > area.width {
        return;
    }
    let x = area
        .x
        .saturating_add(area.width.saturating_sub(width + right_padding));
    let rect = Rect::new(x, area.y, width, 1);
    line.render(rect, buf);
}

fn shortcut_summary_line() -> Line<'static> {
    Line::from(vec![
        key_hint::plain(KeyCode::Char('?')).into(),
        " for shortcuts".into(),
    ])
}

fn quit_shortcut_reminder_line(key: KeyBinding) -> Line<'static> {
    Line::from(vec![key.into(), " again to quit".into()]).dim()
}

fn esc_hint_line(esc_backtrack_hint: bool) -> Line<'static> {
    let esc = key_hint::plain(KeyCode::Esc);
    if esc_backtrack_hint {
        Line::from(vec![esc.into(), " again to edit previous message".into()]).dim()
    } else {
        Line::from(vec![
            esc.into(),
            " ".into(),
            esc.into(),
            " to edit previous message".into(),
        ])
        .dim()
    }
}

fn context_window_line(props: FooterProps) -> Line<'static> {
    let base = if let Some(percent) = props.context_window_percent {
        let percent = percent.clamp(0, 100);
        format!("{percent}% context left")
    } else if let Some(tokens) = props.context_window_used_tokens {
        let used_fmt = format_tokens_compact(tokens);
        format!("{used_fmt} used")
    } else {
        "100% context left".to_string()
    };

    let mut spans = vec![Span::from(base).dim()];
    if props.prompt_suggestions_enabled {
        spans.push(Span::from(" | Suggestions auto: ").dim());
        let status = if props.prompt_suggestions_autorun {
            "On".green()
        } else {
            "Off".red()
        };
        spans.push(status);
    }
    Line::from(spans)
}

fn format_tokens_compact(tokens: i64) -> String {
    let tokens = tokens.abs() as f64;
    if tokens >= 1_000_000.0 {
        format!("{:.1}M", tokens / 1_000_000.0)
    } else if tokens >= 1_000.0 {
        format!("{:.1}k", tokens / 1_000.0)
    } else {
        format!("{tokens:.0}")
    }
}

#[derive(Clone, Copy, Debug)]
struct ShortcutsState {
    use_shift_enter_hint: bool,
    esc_backtrack_hint: bool,
    steer_enabled: bool,
}

fn shortcut_overlay_lines(props: FooterProps) -> Vec<Line<'static>> {
    let state = ShortcutsState {
        use_shift_enter_hint: props.use_shift_enter_hint,
        esc_backtrack_hint: props.esc_backtrack_hint,
        steer_enabled: props.steer_enabled,
    };

    let mut commands = Line::from("");
    let mut shell_commands = Line::from("");
    let mut newline = Line::from("");
    let mut queue_message_tab = Line::from("");
    let mut file_paths = Line::from("");
    let mut paste_image = Line::from("");
    let mut edit_previous = Line::from("");
    let mut quit = Line::from("");
    let mut show_transcript = Line::from("");

    for descriptor in SHORTCUTS {
        if let Some(text) = descriptor.overlay_entry(state) {
            match descriptor.id {
                ShortcutId::Commands => commands = text,
                ShortcutId::ShellCommands => shell_commands = text,
                ShortcutId::InsertNewline => newline = text,
                ShortcutId::QueueMessageTab => queue_message_tab = text,
                ShortcutId::FilePaths => file_paths = text,
                ShortcutId::PasteImage => paste_image = text,
                ShortcutId::EditPrevious => edit_previous = text,
                ShortcutId::Quit => quit = text,
                ShortcutId::ShowTranscript => show_transcript = text,
            }
        }
    }

    let mut ordered = vec![
        commands,
        shell_commands,
        newline,
        queue_message_tab,
        file_paths,
        paste_image,
        edit_previous,
        quit,
        Line::from(""),
        show_transcript,
    ];

    // Drop the queue hint when steer is disabled to reduce noise.
    if !state.steer_enabled {
        ordered[3] = Line::from("");
    }

    build_columns(ordered)
}

fn build_columns(entries: Vec<Line<'static>>) -> Vec<Line<'static>> {
    if entries.is_empty() {
        return Vec::new();
    }

    const COLUMNS: usize = 2;
    const COLUMN_PADDING: [usize; COLUMNS] = [4, 4];
    const COLUMN_GAP: usize = 4;

    let rows = entries.len().div_ceil(COLUMNS);
    let target_len = rows * COLUMNS;
    let mut entries = entries;
    if entries.len() < target_len {
        entries.extend(std::iter::repeat_n(Line::from(""), target_len - entries.len()));
    }

    let mut column_widths = [0usize; COLUMNS];

    for (idx, entry) in entries.iter().enumerate() {
        let column = idx % COLUMNS;
        column_widths[column] = column_widths[column].max(entry.width());
    }

    for (idx, width) in column_widths.iter_mut().enumerate() {
        *width += COLUMN_PADDING[idx];
    }

    entries
        .chunks(COLUMNS)
        .map(|chunk| {
            let mut line = Line::from("");
            for (col, entry) in chunk.iter().enumerate() {
                line.extend(entry.spans.clone());
                if col < COLUMNS - 1 {
                    let target_width = column_widths[col];
                    let padding = target_width.saturating_sub(entry.width()) + COLUMN_GAP;
                    line.push_span(Span::from(" ".repeat(padding)));
                }
            }
            line.dim()
        })
        .collect()
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ShortcutId {
    Commands,
    ShellCommands,
    InsertNewline,
    QueueMessageTab,
    FilePaths,
    PasteImage,
    EditPrevious,
    Quit,
    ShowTranscript,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct ShortcutBinding {
    key: KeyBinding,
    condition: DisplayCondition,
}

impl ShortcutBinding {
    fn matches(&self, state: ShortcutsState) -> bool {
        self.condition.matches(state)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum DisplayCondition {
    Always,
    WhenShiftEnterHint,
    WhenNotShiftEnterHint,
}

impl DisplayCondition {
    fn matches(self, state: ShortcutsState) -> bool {
        match self {
            DisplayCondition::Always => true,
            DisplayCondition::WhenShiftEnterHint => state.use_shift_enter_hint,
            DisplayCondition::WhenNotShiftEnterHint => !state.use_shift_enter_hint,
        }
    }
}

struct ShortcutDescriptor {
    id: ShortcutId,
    bindings: &'static [ShortcutBinding],
    prefix: &'static str,
    label: &'static str,
}

impl ShortcutDescriptor {
    fn binding_for(&self, state: ShortcutsState) -> Option<&'static ShortcutBinding> {
        self.bindings.iter().find(|binding| binding.matches(state))
    }

    fn overlay_entry(&self, state: ShortcutsState) -> Option<Line<'static>> {
        let binding = self.binding_for(state)?;
        let mut line = Line::from(vec![self.prefix.into(), binding.key.into()]);
        match self.id {
            ShortcutId::EditPrevious => {
                if state.esc_backtrack_hint {
                    line.extend(vec![" again to edit previous message".into()]);
                } else {
                    line.extend(vec![
                        " ".into(),
                        key_hint::plain(KeyCode::Esc).into(),
                        " to edit previous message".into(),
                    ]);
                }
            }
            _ => line.push_span(self.label),
        };
        Some(line)
    }
}

const SHORTCUTS: &[ShortcutDescriptor] = &[
    ShortcutDescriptor {
        id: ShortcutId::Commands,
        bindings: &[ShortcutBinding {
            key: key_hint::plain(KeyCode::Char('/')),
            condition: DisplayCondition::Always,
        }],
        prefix: "",
        label: " for commands",
    },
    ShortcutDescriptor {
        id: ShortcutId::ShellCommands,
        bindings: &[ShortcutBinding {
            key: key_hint::plain(KeyCode::Char('!')),
            condition: DisplayCondition::Always,
        }],
        prefix: "",
        label: " for shell commands",
    },
    ShortcutDescriptor {
        id: ShortcutId::InsertNewline,
        bindings: &[
            ShortcutBinding {
                key: key_hint::shift(KeyCode::Enter),
                condition: DisplayCondition::WhenShiftEnterHint,
            },
            ShortcutBinding {
                key: key_hint::ctrl(KeyCode::Char('j')),
                condition: DisplayCondition::WhenNotShiftEnterHint,
            },
        ],
        prefix: "",
        label: " for newline",
    },
    ShortcutDescriptor {
        id: ShortcutId::QueueMessageTab,
        bindings: &[ShortcutBinding {
            key: key_hint::plain(KeyCode::Tab),
            condition: DisplayCondition::Always,
        }],
        prefix: "",
        label: " to queue message",
    },
    ShortcutDescriptor {
        id: ShortcutId::FilePaths,
        bindings: &[ShortcutBinding {
            key: key_hint::plain(KeyCode::Char('@')),
            condition: DisplayCondition::Always,
        }],
        prefix: "",
        label: " for file paths",
    },
    ShortcutDescriptor {
        id: ShortcutId::PasteImage,
        bindings: &[ShortcutBinding {
            key: key_hint::ctrl_alt(KeyCode::Char('v')),
            condition: DisplayCondition::Always,
        }],
        prefix: "",
        label: " to paste images",
    },
    ShortcutDescriptor {
        id: ShortcutId::EditPrevious,
        bindings: &[ShortcutBinding {
            key: key_hint::plain(KeyCode::Esc),
            condition: DisplayCondition::Always,
        }],
        prefix: "",
        label: "",
    },
    ShortcutDescriptor {
        id: ShortcutId::Quit,
        bindings: &[ShortcutBinding {
            key: key_hint::ctrl(KeyCode::Char('c')),
            condition: DisplayCondition::Always,
        }],
        prefix: "",
        label: " to exit",
    },
    ShortcutDescriptor {
        id: ShortcutId::ShowTranscript,
        bindings: &[ShortcutBinding {
            key: key_hint::ctrl(KeyCode::Char('t')),
            condition: DisplayCondition::Always,
        }],
        prefix: "",
        label: " to view transcript",
    },
];
