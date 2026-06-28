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
- [ ] Phase 6 Simplify
- [ ] Phase 7 Multi-model review
- [ ] Phase 8 Verify
- [ ] Phase 9 Ship & CI

## CI Status
- PR: not yet created

## Blockers
- none
