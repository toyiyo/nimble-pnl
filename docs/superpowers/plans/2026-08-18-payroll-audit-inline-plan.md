# Plan: session-set audit and the in-row payroll display

Date: 2026-08-18
Design: docs/superpowers/specs/2026-08-18-payroll-audit-inline-design.md
Branch: `feature/payroll-clock-audit` (extends PR #760)
Worktree: `.claude/worktrees/payroll-clock-audit`

## Context

PR #760 is open, green, and unmerged. This plan reworks its audit in
place: the session-set fix, the `in_progress` hold, the alert deletion,
and the in-row display. Follow the design doc for every rule. Use TDD:
write the failing test first in every logic task.

## Tasks

### Task 1 — session-set assignment and the in_progress hold (TDD)

Files:
- `tests/unit/scheduleClockAudit.test.ts`
- `src/utils/scheduleClockAudit.ts`

Steps:
1. Add failing tests, in this order:
   - Oscar case: one ended shift, two closed sessions (5:29–7:32 PM and
     8:03–11:02 PM against a 5:30–11:00 PM shift). Expect one row from
     first-in/last-out, zero `unscheduled_clock` rows.
   - Gap math: `gapMinutes` equals the gap between the sessions.
     `workedMinutes` excludes the gap and the break punches.
   - Open last session, shift end in the future → `in_progress`.
   - Open last session, shift end in the past → `open_clock`.
   - Closed sessions, shift end in the future → `in_progress`.
   - The back-to-back boundary test from PR #760 still passes.
   - `rollupAuditRowsByEmployee`: `toFix`, `open`, `info`,
     `missingMinutes`.
2. Change the code per design section 4.1:
   - `AuditRow.sessions?: WorkSession[]`, `AuditRow.gapMinutes?`,
     status `in_progress`, `AuditSummary.inProgress`, the `SUMMARY_KEY`
     entry.
   - `assignSessionsToShifts`: target `Map<string, WorkSession[]>`,
     delete the one-session-per-shift skip.
   - `buildShiftRow`: accept the sorted session array, apply the status
     rules from the design.
   - Add `rollupAuditRowsByEmployee` and the `EmployeeAuditRollup`
     type.
3. Fix the compile fallout in `tests/unit/useScheduleClockAudit.test.ts`
   and `tests/unit/ScheduleClockAudit.test.tsx` (field rename only; the
   panel dies in Task 4).
4. Run the three unit files. All pass.
5. Commit: `feat(payroll): assign the full session set to a shift`.

### Task 2 — the dialog reads the session array

Files:
- `src/components/payroll/RecordShiftClockDialog.tsx`

Steps:
1. Change `row.session` to the last element of `row.sessions`
   (RecordShiftClockDialog.tsx:89-93 and :215-219).
2. Run `npm run typecheck` and the unit suite.
3. Commit: `refactor(payroll): read the open session from the array`.

### Task 3 — ClockAuditBar and EmployeeAuditDetail (TDD)

Files:
- `tests/unit/ClockAuditBar.test.tsx` (new)
- `tests/unit/EmployeeAuditDetail.test.tsx` (new)
- `src/components/payroll/ClockAuditBar.tsx` (new)
- `src/components/payroll/EmployeeAuditDetail.tsx` (new)

Steps:
1. Write failing tests: chip counts and labels, `aria-pressed` toggle,
   disabled zero-count chips, the tolerance select, the loading line,
   the error line with `role="alert"`; detail line content per status,
   the action buttons, no button for `in_progress` / `unscheduled_clock`
   / `matched`.
2. Build both components per design section 4.3. Semantic tokens only.
3. Run the new unit files. All pass.
4. Commit: `feat(payroll): add the clock audit bar and the detail row`.

### Task 4 — Payroll page integration

Files:
- `src/pages/Payroll.tsx`
- `src/components/payroll/ScheduleClockAudit.tsx` (delete)
- `tests/unit/ScheduleClockAudit.test.tsx` (delete)

Steps:
1. Delete the "Incomplete Time Punches Detected" alert
   (Payroll.tsx:688-719). Keep the orphan-punch tooltip
   (Payroll.tsx:276-295).
2. Delete the `ScheduleClockAudit` render (Payroll.tsx:722-728), the
   component file, and its test file.
3. Call `useScheduleClockAudit` from the page. Hold the tolerance, the
   chip filter, and the expansion set as page state.
4. Render `ClockAuditBar` inside the payroll table card header.
5. Change `renderEmployeeRow`: the fixed-width chevron slot, the row
   chip by precedence, the Regular Hrs gap subtext, and the
   `React.Fragment` pair with the detail row.
6. Apply the filter rules from the design: hide the totals rows, show
   the `aria-live` note, force the groups open, show `N of M` in the
   group header, hide an empty group.
7. Host one `RecordShiftClockDialog` at page level.
8. Run `npm run typecheck`, `npm run lint`, and the unit suite.
9. Commit: `feat(payroll): show the clock audit inside the payroll table`.

### Task 5 — E2E rework

Files:
- `tests/e2e/schedule-clock-audit.spec.ts`

Steps:
1. Rework the spec for the new UI: seed one past shift without punches;
   the bar shows `1 to fix`; the row chip appears; expand the detail
   row; open the dialog; save the punches; the chip clears and the
   hours appear.
2. Add the filter assertion: activate the amber chip; the table shows
   only the flagged employee; the totals rows hide.
3. Run the spec with the local stack.
4. Commit: `test(payroll): cover the in-row clock audit flow`.

### Task 6 — verify

Steps:
1. Run `npm run typecheck`, `npm run lint`, `npm run test`.
2. Run the payroll E2E specs.
3. Push and update the PR #760 body: state the rework in one section.
