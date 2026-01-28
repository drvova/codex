# Mode Shift — Feature Integration Plan

## Objective
- Improve and stabilize automatic Plan/Code mode switching in the Codex TUI so that auto-switch behavior is predictable, gated, and consistent across TUI surfaces.

## Scope
- In scope:
  - Identify current auto mode switching logic and its triggers.
  - Define a single source of truth for auto-switch conditions.
  - Align Plan/Code auto-switch behavior with queued-message handling, replay, and UI state.
  - Update TUI (and TUI2 if applicable) to use the same gating rules.
  - Add/adjust tests for auto-switching behavior and regressions.
- Out of scope:
  - Changing collaboration mode presets or model lists.
  - Changing core collaboration mode protocol semantics.
  - Adding new collaboration modes beyond Plan/Code.

## Assumptions
- “Automatic Plan/Code mode switching” refers to the TUI behavior that switches from Code back to Plan after a turn completes if the mode was selected via cycle and no queued user messages remain.
- Stability issues likely involve edge cases (replay, queued messages, modal/popup state, review mode, or task-running state) that can cause unexpected switches.
- TUI is the primary surface with auto-switch logic; TUI2 may not yet implement the same behavior and may need parity or explicit non-goal documentation.
- No protocol changes are required; logic lives in TUI state management.

## Findings
- Target codebase:
  - Auto-switch logic exists in `codex-rs/tui/src/chatwidget.rs` and is invoked at turn completion:
    - `on_task_complete` calls `maybe_auto_switch_cycle_collaboration_mode` after `maybe_send_next_queued_input` (evidence: `codex-rs/tui/src/chatwidget.rs:920-938`).
  - Current auto-switch gating is centralized in `can_auto_switch_cycle_collaboration_mode` and already checks most of the desired UI state:
    - Gates: not replay, no queued messages, collaboration modes enabled, came from cycle, active mode is Code, not in review mode, not task running, composer empty, and no modal/popup active (evidence: `codex-rs/tui/src/chatwidget.rs:5586-5626`).
    - The auto-switch flips to Plan via `mask_for_kind(..., ModeKind::Plan)` when allowed (evidence: `codex-rs/tui/src/chatwidget.rs:5628-5644`).
  - Auto-switch only occurs if the active mask came from cycling (`collaboration_mask_from_cycle`), so manual selection does not auto-switch (evidence: `codex-rs/tui/src/chatwidget.rs:5570-5584`, `codex-rs/tui/src/chatwidget.rs:5586-5626`).
  - Mode cycling and Plan/Code mask selection are implemented in `codex-rs/tui/src/collaboration_modes.rs` (evidence: `codex-rs/tui/src/collaboration_modes.rs:1-60`).
  - TUI2 parity is unclear; no matching auto-switch functions were located under `codex-rs/tui2` with the `maybe_auto_switch_cycle_collaboration_mode` naming (evidence: `rg -n "maybe_auto_switch_cycle_collaboration_mode" codex-rs/tui2 -S` returned no matches).
  - Plan/Code prompts in core are defined in `codex-rs/core/templates/collaboration_mode/plan.md` and `codex-rs/core/templates/collaboration_mode/code.md` (evidence: files present in `codex-rs/core/templates/collaboration_mode/`).
- Reference project (if provided):
  - Not provided.

## Proposed Integration
### Architecture Fit
- Consolidate auto-switch gating in a single TUI helper so the rules are explicit and reused (on task completion, on replay handling, and any future triggers).

### Data & State
- Track whether the active collaboration mask came from cycling (`collaboration_mask_from_cycle`) as today.
- Add explicit gating based on UI state (e.g., modal/popup presence, review mode, task running state) if missing.

### APIs & Contracts
- No protocol changes; keep `Op::UserTurn { collaboration_mode: Some(...) }` semantics intact.

### UI/UX (If Applicable)
- Ensure the collaboration mode indicator reflects any auto-switch; avoid unexpected silent changes when user has typed or modal is active.

### Background Jobs & Async
- None.

### Config & Feature Flags
- No new flags unless auto-switch needs to be optionally disabled.

### Observability & Error Handling
- Add debug logging around auto-switch decisions to aid diagnosis.

## Files To Touch
- `codex-rs/tui/src/chatwidget.rs`
- `codex-rs/tui/src/collaboration_modes.rs`
- `codex-rs/tui/src/chatwidget/tests.rs`
- `codex-rs/tui2/src/chatwidget.rs` (if parity is required)
- `docs/tui-chat-composer.md` (if behavior is user-facing)

## Work Plan
1. Audit auto-switch path in `tui` to enumerate current gates and identify missing ones (replay, queued messages, modal/popup, review mode, task-running).
2. Introduce a single helper that determines “may auto-switch now,” and use it in `on_task_complete` (and any other trigger points).
3. Decide on TUI2 parity: either implement the same auto-switching behavior or document that TUI2 does not auto-switch.
4. Add/adjust tests to cover auto-switch gating and regression cases.
5. Update docs if auto-switch behavior is user-visible or configurable.

## Risks & Mitigations
- Risk: Auto-switch triggers while a modal/popup or review is active.
  Mitigation: Gate on `no_modal_or_popup_active`, `!is_review_mode`, and `!agent_turn_running` where relevant.
- Risk: Auto-switch triggers while user has queued messages or is composing.
  Mitigation: Preserve queued-message gate; consider composer non-empty gate if needed.
- Risk: TUI and TUI2 diverge in behavior.
  Mitigation: Implement parity or document the intentional difference.

## Open Questions
- Should auto-switch be disabled when the composer has content, or only when queued messages exist?
- Should TUI2 gain auto-switch behavior or explicitly remain manual?

## Test & Validation Plan
- Unit tests:
  - Add/extend tests in `codex-rs/tui/src/chatwidget/tests.rs` for auto-switch gating.
- Integration tests:
  - None expected.
- Manual verification:
  - Cycle to Code, complete a turn, verify auto-switch to Plan.
  - Verify no auto-switch when queued messages exist, in review mode, or when a modal is open.

## Rollout
- No flag; ship as default behavior with improved gating and tests.

## Approval
- Status: Pending
- Notes: Assumptions noted on auto-switch semantics and TUI2 parity.
