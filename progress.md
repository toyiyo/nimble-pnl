# Progress: Print schedule inactive-employee fix

## Spec
- Design: docs/superpowers/specs/2026-06-28-print-inactive-employees-design.md
- Plan: docs/superpowers/plans/2026-06-28-print-inactive-employees.md

## Current Phase
Phase 4–9: Autonomous workflow (dev-build-and-ship) — in-progress

## Branch
fix/print-inactive-employees (worktree: .claude/worktrees/print-inactive-employees)

## Completed Tasks
- [x] Phase 0 Consult lessons
- [x] Phase 1 Worktree created
- [x] Phase 2 Design doc committed (bcac2d2e)
- [x] Phase 2.5 Frontend design review folded in
- [x] Phase 3 Plan committed
- [x] Phase 4 Build (TDD)
  - [x] Task 1: Create src/lib/scheduleVisibility.ts (buildActiveShiftEmployeeIds + filterEmployeesForScheduleView + selectVisibleRosterInputs), typecheck, commit (2034f289)
  - [x] Task 2: Re-point Scheduling.tsx at the lib: delete helper definitions, add import + re-export for back-compat, run schedulingHelpers.test.ts (16/16 pass), typecheck, commit (e6fafcad)
  - [x] Task 3: Add selectVisibleRosterInputs via TDD: wrote 6 tests in scheduleVisibility.test.ts, all 6 pass (function was already in lib from Task 1), typecheck pass, commit (30a75eb0)
  - [x] Task 4: Apply selectVisibleRosterInputs chokepoint in ScheduleExportDialog.tsx: imported helper, derived visibleShifts/visibleEmployees, replaced filteredShifts + allEmployeesWithShifts memos, updated previewRosterDay, updated both PDF generator calls, typecheck pass, all 74 tests in 7-file suite pass, commit (d12c8211)
  - [x] Task 5: Full local verification — all 369 test files / 4853 tests pass, typecheck PASS, lint pre-existing only (0 new errors in our files), build PASS from worktree. No fixup commit needed (nothing to commit).
- [x] Phase 5 UI review — fixed ScheduleExportDialog: icon-box header, p0/gap-0 DialogContent, semantic token on icon, text-[17px] title, px-6 py-5 body wrapper, styled primary/ghost buttons, SelectTrigger inputs, label typography (a95de782)
- [x] Phase 6 Simplify — collapsed filterEmployeesForScheduleView to chained .filter(), deduped predicate in selectVisibleRosterInputs (d9aace7a)
- [x] Phase 7 Multi-model review — Codex ran; one minor finding: active employees with all shifts cancelled are absent from the print checkbox list (by design — nothing to export), Codex rated it major but it is within intended behavior (see codex-review-output.md)
- [x] Phase 7b Fold findings — all findings were minor; fixed 3:
    1. scheduleVisibility: eliminated redundant cancelled-shift filter pass (derive liveShiftEmployeeIds from liveShifts directly)
    2. ScheduleExportDialog: corrected import order (Select shadcn UI with other UI imports; scheduleVisibility lib after types)
    3. scheduleVisibility.test: added partial-fixture comment on double-cast
    Commit: 53dac27f — all 6 tests pass, typecheck PASS
- [x] Phase 7c CodeRabbit review — 1 major finding, ruled NOT actionable:
    - Finding: "allEmployeesWithShifts still derived from filteredShifts, so active employees with area/position-filtered shifts disappear." CodeRabbit points at plan doc lines 344-355 (not implementation). This is intentional per spec — the export mirrors the on-screen grid including area/position filter. Same ruling as Phase 7's Codex finding. No fix committed. clean=true.
- [x] Phase 8 Verify — PASS
    - Unit tests: 4853/4855 pass (2 intentional skips), 369 test files
    - Typecheck: PASS (tsc --noEmit, 0 errors)
    - Lint: 0 new errors in our files; pre-existing errors unchanged
    - Build: PASS (vite build via main repo node_modules)
    - DB tests: pre-existing open_shift_coverage.test.sql failure (shift_slot_min_concurrent missing from local DB — same on main)
    - E2E tests: 146 pass, 1 flaky (scheduling-conflicts:284 fails under parallel load, passes in isolation, pre-existing), 12 skip; schedule-print-export (7/7) and scheduling-inactive-employees (3/3) all PASS
- [ ] Phase 9 Ship & CI

## CI Status
- PR: not yet created

## Blockers
- none
