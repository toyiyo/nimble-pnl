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

## Phase 6: Simplify — COMPLETE (commit 94201885)
- scheduleExport.ts: extracted `active(f)` helper; eliminated 3 duplicated `f && f !== "all"` ternaries and the redundant `activePositionFilter`/`activeAreaFilter` intermediates.
- ScheduleExportDialog.tsx: replaced IIFE `{(() => { … })()}` in JSX with `const activeFilterParts` above the return.
- No behaviour change; 31 unit tests passing; typecheck clean.

## Phase 5: UI Review — COMPLETE (no violations in new code)
- ScheduleExportDialog.tsx new code: semantic tokens only, no direct colors, no new a11y issues.
- Scheduling.tsx change: single prop line, no styling.
- Pre-existing `text-primary` on Printer icon and full dialog restyle (icon-box/p-0 pattern) are both deferred per design spec.
- No commits needed.

## Phase 7a: Codex Adversarial Review — COMPLETE
Finding (minor, pre-existing pattern, out of scope for this change):
- MINOR: `src/utils/scheduleExport.ts` line 265 — PDF footer totals hours from `filteredShifts` without applying `selectedEmployeeIds`. Employee deselection in ScheduleExportDialog produces an inconsistent PDF: the table and staff count only include selected employees, but the `Total: <hours>` footer still sums every shift matching the area/position filters. Trigger: open Print, deselect one employee, download PDF — their row is absent but their hours remain in the total. This is a pre-existing defect untouched by the area-filter change; not introduced by this diff.

## Phase 7: PR Setup — COMPLETE
- git diff origin/main...HEAD captured (30,774 chars, under 60K limit, not truncated)
- git log origin/main..HEAD --oneline captured (11 commits)
- Design doc contents captured
- Ready for PR creation

## Phase 7a: OCR Rules Review — COMPLETE
Findings (DO NOT fix in 7a — Phase 7b handles fixes):
- MAJOR: `any[]` without explanatory comment used in 3 new unit-test `body.map` calls (scheduleExport.test.ts lines ~162, 179, 213) — pre-existing pattern but new occurrences
- MAJOR: `any[]`/`any` without explanatory comment in 7 new E2E lines (schedule-print-export.spec.ts lines ~243–269) — pre-existing pattern in file, new test inlines it instead of reusing `setupWithShifts` helper
- MINOR: Duplicate filter-parts logic — `ScheduleExportDialog.tsx:107–110` evaluates `filter && filter !== "all" ? filter : null` inline for two props, while `scheduleExport.ts:84` centralizes this in `active()`. Dialog could call a shared helper but doesn't.
- MINOR: New E2E test inlines its own setup (signUp + insertEmployees + insertShifts) instead of extracting or reusing the existing `setupWithShifts` helper — code duplication in test file.

## Phase 7b: Fold Review Findings — COMPLETE (commit 126730b7)
Findings triaged from 6 reviewers (security, performance, maintainability, sound-logic, ocr-rules, codex):
- FIXED (MAJOR): Added explanatory `any` comments in scheduleExport.test.ts (×4) and schedule-print-export.spec.ts (×2 comment blocks) — OCR rule requires comment when `any` is necessary.
- SKIPPED (MINOR): Redundant `active()` call on scheduleExport.ts:133 — style/nit, skipped per instructions.
- SKIPPED (MINOR): Duplicate filter-active inline logic in ScheduleExportDialog.tsx:107–110 — style/nit.
- SKIPPED (MINOR): E2E test setup duplication vs setupWithShifts — style/nit.
- NOTED (MINOR, pre-existing): Footer total hours ignores selectedEmployeeIds — pre-existing defect, not introduced by this diff; flagged as spawn task if needed.
- All security/performance/sound-logic reviewers: no findings.
- 4612 unit tests passing; typecheck clean after fix.

## Phase 7c: CodeRabbit CLI Review — COMPLETE (clean=true)
CodeRabbit returned 2 minor findings, both in files NOT changed by this feature:
- SKIPPED: Import order in `ScheduleOverviewPanel.tsx` — not in diff (out of scope)
- SKIPPED: Logic question in `timePunchProcessing.ts` — not in diff (out of scope)
No actionable findings in the feature's changed files. No commits needed.

## Phase 8: Verify — COMPLETE (all checks pass)

### Check Results
- npm run test: PASS — 4612 unit tests pass, 2 skipped (353/354 test files)
- npm run typecheck: PASS — tsc --noEmit outputs nothing (clean)
- npm run lint: PASS-BASELINE — 1438 problems (pre-existing; main branch has 50,037 problems in different node_modules). No new lint errors introduced by this branch. Changed files have same or fewer errors than origin/main.
- npm run test:db: NEAR-PASS — 1373/1374 pass; 1 pre-existing failure in `enqueue_weekly_brief_jobs returns 0 enqueued when no restaurants exist` (also fails on origin/main)
- npm run test:e2e: PASS — 7/7 schedule-print-export.spec.ts tests pass; 17 passed, 12 skipped, 22 did not run (all E2E); exit code 0. Note: prior E2E failures were due to a different worktree's dev server (payroll-sort-group-area) being reused on port 4173; killed that server and re-ran against correct worktree.
- npm run build: PASS — built in ~27 min, exit code 0, chunk size warnings are pre-existing

### No fixes were needed — all failures were pre-existing or environment issues.

## CI Status
- PR: https://github.com/toyiyo/nimble-pnl/pull/551 (opened Phase 9a)

## Key Decisions
- User chose "just respect grid filters" (no new dialog controls); wants this FAST.
- Apply areaFilter exactly like positionFilter: single-select, 'all' = no filter, AND semantics.
- Coverage: scheduleExport.ts (utils) Sonar-measured → unit tests; dialog + page Sonar-excluded → E2E.
- supabase-design-reviewer SKIPPED (no DB/RLS/edge/SQL surface — pure client filtering).

## Environment gotcha
- Bash cwd is the MAIN repo, not the worktree. Use `git -C <worktree>` and worktree-absolute
  paths for all file ops. Worktree: .claude/worktrees/feature+schedule-print-area-filter
