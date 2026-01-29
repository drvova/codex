# Gated Parity — Feature Integration Plan

## Objective
- Improve plan-mode auto-switch gating to avoid unsafe or surprising mode flips, and bring TUI2 behavior/tests into parity with TUI for the updated gating rules.

## Scope
- In scope:
  - Refine auto-switch gating logic for cycle-selected Code -> Plan transitions.
  - Apply identical gating behavior in TUI and TUI2.
  - Add/adjust tests in TUI and TUI2 to lock in the gating rules.
- Out of scope:
  - Changes to collaboration mode presets or core protocol semantics.
  - New feature flags or config knobs unless required by gating correctness.
  - Any non-collaboration-mode UI refactors.

## Assumptions
- “Improve gating” means adding explicit checks for UI states that should block auto-switch (e.g., pending rate-limit prompt or other pending modal workflows) rather than changing core collaboration mode semantics.
- TUI2 is expected to mirror TUI behavior for auto-switch gating; any deliberate divergence should be documented, but the default is parity.
- No legacy compatibility or migration paths are required; changes should be direct and single-path.
- Tests should cover the new gating conditions and keep existing behavior unchanged for already-covered cases.

## Findings
- Target codebase:
  - Auto-switch gating is centralized in `codex-rs/tui/src/chatwidget.rs` via `can_auto_switch_cycle_collaboration_mode` and invoked after `on_task_complete` (`maybe_auto_switch_cycle_collaboration_mode`).
  - TUI exposes a plan-implementation prompt (`maybe_prompt_plan_implementation`) and suppresses it when a rate-limit prompt is pending (`codex-rs/tui/src/chatwidget.rs`).
  - TUI2 has parallel auto-switch gating and tests (`codex-rs/tui2/src/chatwidget.rs`, `codex-rs/tui2/src/chatwidget/tests.rs`).
  - TUI/TUI2 both maintain `RateLimitSwitchPromptState`, but auto-switch gating does not currently consult pending prompt state (`codex-rs/tui/src/chatwidget.rs`, `codex-rs/tui2/src/chatwidget.rs`).
  - Existing auto-switch tests cover composer text, modal/popup, queued messages, and explicit selection in both TUI and TUI2 (`codex-rs/tui/src/chatwidget/tests.rs`, `codex-rs/tui2/src/chatwidget/tests.rs`).
  - Previous planning artifacts already target this area, e.g. `docs/plans/plan-mode-shift.md` and `docs/plans/plan-cycle-compass.md` (keep alignment with their intent, but update with current code reality).
- Reference project (if provided):
  - None.

## Proposed Integration
### Architecture Fit
- Keep auto-switch gating as a TUI-only state transition; update the gating predicate to include any additional blocking UI states, and mirror the predicate in TUI2 for parity.

### Data & State
- Extend the gating predicate to consider pending rate-limit prompts (and any other pending modal workflow states) so auto-switch does not occur before user-facing prompts.
- Ensure any new gating checks are derived from existing state fields (no new persistent config).

### APIs & Contracts
- No protocol or API changes; continue using `Op::UserTurn { collaboration_mode: Some(...) }` as-is.

### UI/UX (If Applicable)
- Auto-switch should only occur when the UI is idle and no prompts are pending; user-visible behavior should remain predictable and non-surprising.

### Background Jobs & Async
- None.

### Config & Feature Flags
- No new flags; rely on existing `features.collaboration_modes` and current prompt state tracking.

### Observability & Error Handling
- Preserve or extend existing debug logging around auto-switch decisions for diagnosis.

## Files To Touch
- `codex-rs/tui/src/chatwidget.rs`
- `codex-rs/tui2/src/chatwidget.rs`
- `codex-rs/tui/src/chatwidget/tests.rs`
- `codex-rs/tui2/src/chatwidget/tests.rs`
- (Optional, only if behavior is user-visible) `docs/` collaboration-mode or TUI documentation.

## Work Plan
1. Re-audit auto-switch gating in TUI and identify missing UI-state blockers (rate-limit prompt pending and any other pending prompt states).
2. Update TUI gating predicate to include the new blockers and keep debug logging aligned.
3. Mirror the gating changes in TUI2 to maintain parity.
4. Add targeted tests for the new gating conditions in both TUI and TUI2.
5. Verify no behavioral regressions in existing auto-switch tests; update docs only if behavior changes are user-visible.

## Risks & Mitigations
- Risk: Overly strict gating prevents expected auto-switch.
  Mitigation: Keep gating scoped to concrete pending prompt states; add tests to cover the “idle” happy path.
- Risk: TUI/TUI2 drift reappears.
  Mitigation: Add mirrored tests and keep predicate logic structurally identical across surfaces.

## Open Questions
- Are there any additional pending prompts beyond rate-limit and modal/popup state that should block auto-switch in both TUI and TUI2?

## Test & Validation Plan
- Unit tests:
  - Add/extend auto-switch tests for pending rate-limit prompt in `codex-rs/tui/src/chatwidget/tests.rs`.
  - Add matching tests in `codex-rs/tui2/src/chatwidget/tests.rs`.
- Integration tests:
  - None required (UI behavior is covered by unit tests).
- E2E tests:
  - None required for this change.
- Manual verification:
  - Cycle to Code (Shift+Tab), complete a task, verify auto-switch to Plan when idle and no prompts are pending.
  - Trigger a rate-limit prompt pending state and confirm auto-switch does not fire until prompt is resolved.

## Rollout
- No rollout or migration steps; behavior is immediate and gated by existing feature flag.

## Approval
- Status: Pending
- Notes: Proceeding with implementation is implicitly approved per request; this plan records assumptions for traceability.
