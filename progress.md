# Progress: Area filter in schedule print/PDF

## Spec
- Design: docs/superpowers/specs/2026-06-23-schedule-print-area-filter-design.md (committed 157c6ad0)
- Plan: docs/superpowers/plans/2026-06-23-schedule-print-area-filter-plan.md (committed 121a5e3a)

## Current Phase
Phase 4 (Build, strict TDD) — task 1/4 COMPLETED; task 2/4 next

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
- [ ] Phase 4, Task 2: ScheduleExportDialog.tsx — accept + apply areaFilter (queued)
- [ ] Phase 4, Task 3: Scheduling.tsx — forward areaFilter to dialog (queued)
- [ ] Phase 4, Task 4: E2E — area filter narrows print dialog (queued)

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
