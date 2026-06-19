# Progress: Remove self-service breaks from employee Time Clock

## Spec
Link: docs/superpowers/specs/2026-06-18-employee-clock-remove-break-design.md
Plan: docs/superpowers/plans/2026-06-18-employee-clock-remove-break-plan.md (pending Phase 3)

## Current Phase
Preflight: COMPLETED 2026-06-18 — all hard deps present (gh, jq, node v24.11.1, coderabbit 0.5.3, codex 0.137.0). Sonar NOT configured (warning only). .env.local symlink already present. Ready for dev-build-and-ship.

Phase 4-9: dev-build-and-ship workflow RUNNING (runId wf_c944a6cb-7b7) — plan approved by user

## Completed Tasks
- [x] Phase 0: Consulted memory/lessons.md
- [x] Phase 1: Worktree .claude/worktrees/employee-clock-remove-break on fix/employee-clock-remove-break (off origin/main)
- [x] Phase 2: Brainstorm — user chose: remove BOTH Start/End Break buttons AND hide "On Break" badge
- [x] Phase 2.5: Frontend design review (no critical/major blockers; pre-existing color/a11y issues spun off as task_83598b07)
- [x] Phase 3: Plan committed (f0a8c200)
- [x] Phase 4-9: dev-build-and-ship workflow (after plan approval)
  - [x] Task 1 — RED test (EmployeeClock.test.tsx) — commit 2dd1d326
  - [x] Task 2 — RED verification: ran test, confirmed 1 failure on clocked-in case (Start Break button found; assertion .toBeNull() fails) — no commit (verification only)
  - [x] Task 3 — Narrow pendingPunchType union to 'clock_in' | 'clock_out' | null; narrow handleInitiatePunch param; simplify camera-dialog confirm label — commit a52646de (tests still 1 fail/2 pass as expected — TS errors now surface in dead break JSX call sites, to be removed in task 4)
  - [x] Task 4 — Remove dead break JSX call sites (onBreak variable, On Break badge branch, break button grid → single full-width Clock In/Clock Out); all 3 tests GREEN, typecheck clean, lint clean — commit d8949f63
  - [x] Task 5 — Remove unused onBreak variable (already completed within task 4 commit d8949f63; grep confirms zero references remain)
  - [x] Task 6 — Simplify status badge: added positive assertions in EmployeeClock.test.tsx that "Clocked Out" renders when not clocked in and "Clocked In" renders when clocked in (badge implementation was already correct from task 4; these close the spec-coverage gap) — commit 21e44de4
  - [x] Task 7 — Replace action-button grid with single full-width Clock In or Clock Out button: already fully implemented in task 4 commit d8949f63 (grid wrapper removed, `w-full` applied to each single button, no break branches remain). All 3 tests GREEN, no new commit needed.
  - [x] Task 8 — Simplify camera-dialog confirm-button label to two-branch ternary: already fully implemented in task 3 commit a52646de (`pendingPunchType === 'clock_out' ? 'Confirm & Clock Out' : 'Confirm & Clock In'`). All 3 tests GREEN, no new commit needed.
  - [x] Task 9 — GREEN verification: ran `npm run test -- tests/unit/EmployeeClock.test.tsx --reporter=verbose`; all 3 cases PASS: clocked-out (Clock In, no break affordances), clocked-in (Clock Out, no break affordances), external-break edge case (Clock In, no break affordances). No new commit (verification only).
  - [x] Task 10 — TypeScript typecheck: ran `npm run typecheck` (tsc -p tsconfig.app.json --noEmit); exit code 0, zero errors. No new commit (verification only). Only remaining break_start/break_end references are in the read-only history rows (in-scope per design spec).
  - [x] Task 11 — ESLint: ran `npx eslint src/pages/EmployeeClock.tsx tests/unit/EmployeeClock.test.tsx`; exit code 0, zero errors/warnings. No unused-vars (onBreak removed in task 4), no unused-import errors (Coffee and PlayCircle remain used by history list and Clocked-In badge). No new commit (verification only).
  - [x] Task 12 — Commit staged changes with prescribed commit message: all implementation commits already landed (2dd1d326, a52646de, d8949f63, 21e44de4); this commit records tasks 7-12 completion in progress.md — see this commit SHA.

## Phase 5 (UI Review): COMPLETED 2026-06-18
- Reviewed src/pages/EmployeeClock.tsx diff against CLAUDE.md Apple/Notion guidelines
- Zero violations introduced by this branch
- Green badge (text-green-700/bg-green-500/10) pre-existed on main; already tracked by task_83598b07
- Branch actually reduced direct-color violations by removing the yellow "On Break" badge
- Three-state rendering correct; action buttons have visible text (no aria-label gap)
- No fixes needed; no new commit required

## Phase 6 (Simplify): COMPLETED 2026-06-18
- Extracted `stopCamera()` helper to eliminate 4× repeated `getTracks().forEach(...stop())` + `setCameraStream(null)` pattern
- Extracted `formatDistance()` helper to replace long inline ternary inside geofence warning JSX
- useEffect cleanup now returns `stopCamera` directly (idiomatic pattern)
- onOpenChange camera-dialog handler uses `stopCamera()` (was 3-line inline)
- handleConfirmPunch uses `stopCamera()` (was 3-line inline)
- All 3 unit tests GREEN; typecheck 0 errors; ESLint 0 warnings
- Commit: see below

## Phase 7a (Codex Adversarial Review): COMPLETED 2026-06-18
- Ran: `bash dev-tools/codex-adversarial-review.sh main`
- Output: dev-tools/codex-review-output.md → "No adversarial finding."
- Codex read EmployeeClock.tsx and tests in full; specifically checked the stopCamera useEffect lifecycle refactor; no bugs found
- No findings to address; no new commit needed

## CI Status
- PR: not yet created

## Key Decisions
- Scope: edit src/pages/EmployeeClock.tsx ONLY. Clock becomes Clock In / Clock Out.
- Hide "On Break" badge (user: restaurants don't "go on break" — short breaks aren't clock-outs, lunch is a real clock-out/in; the concept doesn't match reality).
- FINDING: get_employee_punch_status makes is_clocked_in and on_break mutually exclusive (on_break true => is_clocked_in false). Current UI nests "On Break" badge + "End Break" button inside the isClockedIn branch, so they are unreachable dead code. Removal deletes dead/broken paths.
- KEEP: break punch types, payroll/labor math (laborCalculations.ts, payrollCalculations.ts), Sling/CSV imports, TimePunchesManager manual entry, and the "Today's Activity" read-only history (incl. break icons).
- Accepted edge case: an externally-sourced break_start punch leaves the employee reading as "Clocked Out"; manager reconciles. Same as today's behavior.
- Test: behavioral render test tests/unit/EmployeeClock.test.tsx (mirrors EmployeePin.test.tsx mocking pattern).
