# Progress: Area filter in schedule print/PDF

## Spec
- Design: docs/superpowers/specs/2026-06-23-schedule-print-area-filter-design.md (committed 157c6ad0)
- Plan: docs/superpowers/plans/2026-06-23-schedule-print-area-filter-plan.md (committed 121a5e3a)

## Current Phase
Phase 4 (Build, strict TDD) — ALL TASKS COMPLETE

## Completed Tasks
- [x] Phase 0: Consult lessons
- [x] Phase 1: Isolate (worktree feature/schedule-print-area-filter @ origin/main cc99cbc8)
- [x] Phase 2: Brainstorm + design doc committed (157c6ad0)
- [x] Phase 3: Plan committed (121a5e3a)
- [x] Phase 2.5: Frontend review folded (0c755ec9) — no critical; dialog restyle deferred
- [x] Preflight: environment verified (gh, jq, node, coderabbit all present; codex present; .env.local symlink OK; SONAR_TOKEN set, SONAR_PROJECT_KEY missing)
- [x] Phase 4, Task 1: scheduleExport.ts — areaFilter in PDF generation (08f854c0)
  - Added `areaFilter?: string` to `ScheduleExportOptions`
  - AND semantics: shift kept only when employee matches BOTH positionFilter AND areaFilter
  - Combined "Filtered: <area> · <position>" subtitle (area first)
  - 9 new unit tests (all green); 13 total passing
- [x] Phase 4, Task 2: ScheduleExportDialog.tsx — accept + apply areaFilter (d8ae21b6)
  - Added `areaFilter?: string` to ScheduleExportDialogProps and destructured it
  - Renamed `positionFilteredShifts` → `filteredShifts`; applied AND semantics (area + position)
  - Updated both consumers: `allEmployeesWithShifts` memo and `getShiftDisplay`
  - Preview header: combined "Filtered: <area> · <position>" label (area first)
  - Passed `areaFilter` into `generateSchedulePDF` in handleExport
  - Typecheck clean; 4612 unit tests passing
- [x] Phase 4, Task 3: Scheduling.tsx — forward areaFilter to dialog (e9e2aaf5)
  - Added `areaFilter={areaFilter}` to `<ScheduleExportDialog>` (~line 2110)
  - Typecheck clean (no output); all 31 unit tests green
  - One-line change; completes the prop pipeline from grid state to PDF generator
- [x] Phase 4, Task 4: E2E — area filter narrows print dialog (b08c3920)
  - Added `area filter narrows the employee list in print dialog` test to schedule-print-export.spec.ts
  - Seeds 4 employees across 2 areas (Front of House + Back of House) with shifts
  - Sets #area-filter to "Back of House", opens Print, asserts only BOH employees in dialog
  - Asserts "2 of 2" count and Front of House employees are absent
  - Typecheck clean; 31 unit tests still passing

## CI Status
- PR: not yet created

## Key Decisions
- User chose "just respect grid filters" (no new dialog controls); wants this FAST.
- Apply areaFilter exactly like positionFilter: single-select, 'all' = no filter, AND semantics.
- Coverage: scheduleExport.ts (utils) Sonar-measured → unit tests; dialog + page Sonar-excluded → E2E.
- supabase-design-reviewer SKIPPED (no DB/RLS/edge/SQL surface — pure client filtering).

## Environment gotcha
- Bash cwd is the MAIN repo, not the worktree. Use `git -C <worktree>` and worktree-absolute
  paths for all file ops. Worktree: .claude/worktrees/feature+schedule-print-area-filter
