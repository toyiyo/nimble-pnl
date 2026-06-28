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
- [ ] Phase 4 Build (TDD)
  - [x] Task 1: Create src/lib/scheduleVisibility.ts (buildActiveShiftEmployeeIds + filterEmployeesForScheduleView + selectVisibleRosterInputs), typecheck, commit (2034f289)
  - [x] Task 2: Re-point Scheduling.tsx at the lib: delete helper definitions, add import + re-export for back-compat, run schedulingHelpers.test.ts (16/16 pass), typecheck, commit (e6fafcad)
- [ ] Phase 5 UI review
- [ ] Phase 6 Simplify
- [ ] Phase 7 Multi-model review
- [ ] Phase 8 Verify
- [ ] Phase 9 Ship & CI

## CI Status
- PR: not yet created

## Blockers
- none
