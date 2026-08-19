# Payroll clock audit: session sets and the in-row design

Date: 2026-08-18
Branch: `feature/payroll-clock-audit` (extends PR #760, not merged)
Status: Draft for review

## 1. Problem

Production data for one restaurant showed three defects in the audit that
PR #760 added. The user confirmed each one on screen.

1. **A split work session creates two false rows.** Oscar's shift ran
   5:30–11:00 PM. He clocked in at 5:29 PM, clocked out at 7:32 PM, and
   clocked in again at 8:03 PM. `buildWorkSessions` correctly makes two
   sessions, because a second `clock_in` closes the first session
   ([scheduleClockAudit.ts:126-134](src/utils/scheduleClockAudit.ts:126)).
   But `assignSessionsToShifts` binds **one** session per shift: the loop
   skips a pair when the shift already holds a session
   ([scheduleClockAudit.ts:258-262](src/utils/scheduleClockAudit.ts:258)).
   The first session binds the shift and shows a false `time_mismatch`
   (out-delta ≈ −208 min). The second session becomes a false
   `unscheduled_clock` ([scheduleClockAudit.ts:307-332](src/utils/scheduleClockAudit.ts:307)).
   Split sessions are common: employees clock out for unpaid meal breaks.

2. **An open session alarms during the shift.** A session without a
   `clock_out` returns `open_clock` at once
   ([scheduleClockAudit.ts:287-289](src/utils/scheduleClockAudit.ts:287)).
   An employee who is at work right now shows as an issue. The no-session
   path already holds its alarm until the shift end passes
   ([scheduleClockAudit.ts:276-283](src/utils/scheduleClockAudit.ts:276)).
   The open-session path must apply the same rule.

3. **Two overlapping warnings, and the panel pushes the table down.** The
   page shows the old "Incomplete Time Punches Detected" alert
   ([Payroll.tsx:688-719](src/pages/Payroll.tsx:688)) and the audit panel
   ([Payroll.tsx:722-728](src/pages/Payroll.tsx:722)) above the payroll
   table. Both report the same open sessions. The expanded panel pushes
   the pay data below the fold. The user approved a replacement design:
   a thin summary bar plus in-row detail, so a manager can focus on one
   employee at a time.

## 2. Goals

- Assign every overlapping punch session to its shift. Compute one audit
  row per shift from the full session set.
- Hold every verdict on a shift that did not end yet. Show it as neutral
  progress information.
- Delete the old punch-only alert from `Payroll.tsx`.
- Move the audit display into the payroll table: a thin summary bar with
  count chips that filter, a status chip per employee row, and an
  expandable per-employee detail row with "Enter clock data" actions.

## 3. Non-goals

- The orphan-punch tooltip in the employee name cell stays
  ([Payroll.tsx:276-295](src/pages/Payroll.tsx:276)). It covers orphan
  `clock_out` and break punches, which the audit drops by design
  ([scheduleClockAudit.ts:108-111](src/utils/scheduleClockAudit.ts:108)).
  Only the audit covers scheduled-but-never-clocked shifts. The two
  signals do not overlap after this change.
- No database change. The audit stays a pure client-side comparison.
- No change to `usePayroll` pay math, sorting, grouping, or export.

## 4. Design

### 4.1 Session-set assignment (logic)

Change `assignSessionsToShifts`
([scheduleClockAudit.ts:237-264](src/utils/scheduleClockAudit.ts:237)):

- Keep the global pair build and the sort by absolute clock-in delta.
  This preserves the PR #760 boundary rule: at a back-to-back boundary,
  the session goes to the shift with the closest start.
- Change the assignment target from `Map<string, WorkSession>` to
  `Map<string, WorkSession[]>`. Drop the "shift already has a session"
  skip. Keep the "session already assigned" skip. Each session lands on
  exactly one shift — the shift with the smallest clock-in delta among
  its overlapping shifts. A shift can hold many sessions.

Change `buildShiftRow`
([scheduleClockAudit.ts:266-305](src/utils/scheduleClockAudit.ts:266))
to accept the session array, sorted by `clockIn`:

- No sessions: unchanged. Return `null` while the shift runs
  ([scheduleClockAudit.ts:281](src/utils/scheduleClockAudit.ts:281));
  return `missing_clock` after the end.
- Sessions present and the shift end is still in the future: return the
  new status `in_progress`. This is neutral information, never an issue
  count. This covers both an open last session and an employee who
  clocked out mid-shift and may return.
- Sessions present, shift ended, last session open: `open_clock`.
- All sessions closed and the shift ended: compute
  - `inDeltaMinutes` = first `clockIn` minus shift start,
  - `outDeltaMinutes` = last `clockOut` minus shift end,
  - `workedMinutes` = sum over sessions of (duration − `breakMinutes`),
  - `gapMinutes` = sum of gaps between consecutive sessions (unpaid
    break time),
  - status `time_mismatch` when either delta exceeds the tolerance,
    else `matched`.

Type changes in the same file:

- `AuditRow.session?: WorkSession` becomes `sessions?: WorkSession[]`
  ([scheduleClockAudit.ts:59](src/utils/scheduleClockAudit.ts:59)).
  An unscheduled row carries a one-element array.
- Add `AuditRow.gapMinutes?: number`.
- Add `'in_progress'` to `AuditRowStatus`
  ([scheduleClockAudit.ts:47-52](src/utils/scheduleClockAudit.ts:47)).
- Add `inProgress: number` to `AuditSummary`
  ([scheduleClockAudit.ts:70-76](src/utils/scheduleClockAudit.ts:70)).

Add a pure grouping helper in the same module:

```ts
groupAuditRowsByEmployee(rows: AuditRow[]): Map<string, EmployeeAuditGroup>
// EmployeeAuditGroup = { rows; toFix; open; info; missingMinutes }
// toFix   = missing_clock + time_mismatch count
// open    = open_clock count
// info    = unscheduled_clock + in_progress count
// missingMinutes = sum of scheduledMinutes over missing_clock rows
```

`RecordShiftClockDialog` reads the open session from `row.session`
([RecordShiftClockDialog.tsx:89-93](src/components/payroll/RecordShiftClockDialog.tsx:89),
[RecordShiftClockDialog.tsx:215-219](src/components/payroll/RecordShiftClockDialog.tsx:215)).
Change it to read the last element of `row.sessions`.

With the split-session fix, Oscar's period shows one `in_progress` row
during the shift, and zero unscheduled rows.

### 4.2 Delete the old alert

Delete the "Incomplete Time Punches Detected" block
([Payroll.tsx:688-719](src/pages/Payroll.tsx:688)). The audit covers
missing and open punches with per-shift precision and a repair action.
The name-cell tooltip stays for orphan punches (section 3).

### 4.3 In-row display

Delete the panel components `ScheduleClockAudit` and
`ScheduleClockAuditView`
([ScheduleClockAudit.tsx:98-425](src/components/payroll/ScheduleClockAudit.tsx:98))
and their test `tests/unit/ScheduleClockAudit.test.tsx`. Replace them
with table-integrated pieces. `Payroll.tsx` calls
`useScheduleClockAudit` directly; the hook contract does not change
([useScheduleClockAudit.ts:120-125](src/hooks/useScheduleClockAudit.ts:120)).
The tolerance state moves to the page.

**New component `ClockAuditBar`** (`src/components/payroll/ClockAuditBar.tsx`).
A thin bar inside the "Employee Payroll Details" card header area, above
the table ([Payroll.tsx:731-757](src/pages/Payroll.tsx:731)):

- Label "Clock check" with a small icon.
- Count chips, each a toggle button with `aria-pressed`:
  - amber `N to fix` (`missingClock + timeMismatch`),
  - blue `N no clock-out` (`openClock`),
  - gray `N info` (`unscheduledClock + inProgress`),
  - plain `N matched`.
  A chip with count 0 renders disabled. An active chip filters the
  payroll table to employees whose group contains that class. A second
  click clears the filter.
- The tolerance select (5/10/15/30 min) moves here, same options as the
  panel ([ScheduleClockAudit.tsx:394-407](src/components/payroll/ScheduleClockAudit.tsx:394)).
- Loading: one thin skeleton line. Error: one destructive text line with
  `role="alert"`. The payroll table renders in both cases — an audit
  failure must not hide the pay data.

**Row chip.** In the employee name cell
([Payroll.tsx:272-317](src/pages/Payroll.tsx:272)), after the
compensation badge: one chip per employee, by precedence
amber `N to fix` → blue `No clock-out` → gray `N info`. A clean employee
gets no chip. Chips use the semantic token classes already proven in the
panel (`bg-warning/10 text-warning`, `bg-info/10 text-info`;
[ScheduleClockAudit.tsx:66-72](src/components/payroll/ScheduleClockAudit.tsx:66)).
The chip is a `span`, not a shadcn `Badge`: `Badge` renders a `div` and
the name cell content must stay flow-safe (lesson from PR #747).

**Chevron and detail row.** When an employee has audit rows, the name
cell starts with a chevron toggle (`aria-expanded`,
`aria-label="Show clock detail for {name}"`). Expansion state is a
`Set<employeeId>` on the page. The detail renders as an extra
`<TableRow>` with one `<TableCell colSpan={PAYROLL_COLUMN_COUNT}>`
(precedent: the group header row,
[Payroll.tsx:790-809](src/pages/Payroll.tsx:790);
`PAYROLL_COLUMN_COUNT` at [Payroll.tsx:65](src/pages/Payroll.tsx:65)).

**New component `EmployeeAuditDetail`**
(`src/components/payroll/EmployeeAuditDetail.tsx`) renders inside that
cell: one line per audit row, ordered by time —

- status dot (token colors as in
  [ScheduleClockAudit.tsx:58-64](src/components/payroll/ScheduleClockAudit.tsx:58)),
- day (`EEE, MMM d` via `formatInstant`),
- `Scheduled 5:30 – 11:00 PM · 5.5 h`,
- `Clocked 5:29 – 7:32 PM, 8:03 PM – open` with worked hours and
  `gap 31 min` when present,
- status label and, for `time_mismatch`, the in/out deltas
  (`formatDeltaMinutes`),
- action: `Enter clock data` for `missing_clock`, `Enter clock-out` for
  `open_clock`. `in_progress`, `unscheduled_clock` and `matched` lines
  carry no button.

One `RecordShiftClockDialog` instance at page level serves every line
(single-dialog rule). The dialog props do not change
([RecordShiftClockDialog.tsx:25-31](src/components/payroll/RecordShiftClockDialog.tsx:25)).

**Regular Hrs gap subtext.** When `missingMinutes > 0`, the Regular Hrs
cell ([Payroll.tsx:330-332](src/pages/Payroll.tsx:330)) shows an amber
second line: `5.5 h scheduled, not clocked` (`text-warning`,
`text-[11px]`).

**Filter semantics.** A chip filter reduces the visible employee rows
inside each group. While a filter is active, the subtotal and grand
total rows hide, and a note above the table reads
`Clock filter active: N of M employees`. Totals over a filtered subset
would read as wrong pay totals. Clearing the chip restores the full
table.

**Edge case.** An audit row can belong to an employee that the payroll
period excludes (deactivated long before;
[payrollCalculations.ts:672-692](src/utils/payrollCalculations.ts:672)).
Every included employee gets a table row even with zero punches
([payrollCalculations.ts:715-722](src/utils/payrollCalculations.ts:715)),
so almost every audit row has a host row. The bar counts come from the
audit summary, the truth. A count that exceeds the visible chips is
acceptable and rare; the detail stays reachable through the schedule
page.

## 5. Test plan

Unit (`tests/unit/scheduleClockAudit.test.ts`, extend the 24 tests):

- Oscar case: two sessions, one shift, shift ended → one `matched` or
  `time_mismatch` row from first-in/last-out, zero unscheduled rows.
- Gap math: two closed sessions → `gapMinutes` equals the gap,
  `workedMinutes` excludes it.
- Open last session, shift end in the future → `in_progress`.
- Open last session, shift end in the past → `open_clock`.
- Closed sessions, shift end in the future → `in_progress`.
- Back-to-back boundary regression (PR #760 lesson) still passes with
  the multi-assign change.
- `groupAuditRowsByEmployee`: counts, precedence inputs,
  `missingMinutes`.

Unit (new `tests/unit/ClockAuditBar.test.tsx`,
`tests/unit/EmployeeAuditDetail.test.tsx`): chip counts, `aria-pressed`
toggling, disabled zero chips, detail line content and action buttons.
Delete `tests/unit/ScheduleClockAudit.test.tsx` with the panel.

Hook (`tests/unit/useScheduleClockAudit.test.ts`): unchanged contract;
adjust fixtures for the summary field.

E2E (`tests/e2e/schedule-clock-audit.spec.ts`, rework): seed a shift
without punches in a past period; the bar shows `1 to fix`; the row chip
appears; expand the detail row; open the dialog with "Enter clock data";
save; the chip clears and the hours appear. Add a chip-filter assertion:
activate the amber chip, the table shows only the flagged employee.

## 6. Rollout

All changes ship in PR #760 on `feature/payroll-clock-audit`. The PR is
open and unmerged; this rework replaces the panel the same PR
introduced, so one PR keeps the history coherent.
