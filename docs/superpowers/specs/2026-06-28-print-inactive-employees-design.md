# Design: Print schedule should mirror the grid's visibility

**Date:** 2026-06-28
**Branch:** `fix/print-inactive-employees`
**Type:** Bugfix (scheduling / print-export)

## Problem

When printing/exporting a schedule, employees who are currently **inactive**
(and therefore no longer rendered in the on-screen schedule grid) still appear
on the printed roster and PDF. Reported examples for next week: **Matt
Slaymaker** and **Reba**.

## Root cause

The schedule grid and the print/export path use two different
employee-visibility rules.

- **Grid view** (`src/pages/Scheduling.tsx`) renders
  `filterEmployeesForScheduleView(allEmployees, shiftEmployeeIds, …)`, where
  `shiftEmployeeIds = buildActiveShiftEmployeeIds(shifts)`. Net effect:
  - An employee is shown if `is_active` **or** they have at least one
    **non-cancelled** shift that week.
  - Cancelled shifts are treated as not-real (excluded from the
    "has a shift" set).

- **Print/export** (`ScheduleExportDialog`) is handed the raw
  `employees={allEmployees}` (fetched with `status: 'all'`, i.e. including
  inactive) and the raw `shifts`. Internally it derives
  `allEmployeesWithShifts` as "any employee who has **any** shift" — with **no
  `is_active` check and no cancelled-shift exclusion**. The two PDF generators
  (`generateRosterPDF`, `generateSchedulePDF`) likewise join purely on
  `shift.employee_id` against the full employee list.

So an inactive employee whose shift is cancelled (or otherwise not grid-visible)
is hidden in the grid but still printed.

## Decision

**Mirror the grid exactly.** The printed schedule must show exactly who the
on-screen grid shows: active employees, plus inactive employees who still have a
non-cancelled shift that week. Cancelled shifts are also excluded from the
printed roster. (Chosen over "hide all inactive employees", which would diverge
from the grid, and over "only filter cancelled shifts", which is insufficient.)

## Approach: one shared chokepoint, reuse the grid's rule

1. **Extract the visibility rule into a lib.** Move the two existing pure
   helpers `buildActiveShiftEmployeeIds` and `filterEmployeesForScheduleView`
   from `src/pages/Scheduling.tsx` into a new `src/lib/scheduleVisibility.ts`.
   Re-export both from `Scheduling.tsx` so the existing test import path
   (`@/pages/Scheduling`) and any other consumers keep working unchanged. This
   avoids a page→lib import dependency from the export code.

2. **Add `selectVisibleRosterInputs(shifts, employees)`** to
   `scheduleVisibility.ts`. It returns `{ shifts, employees }` where:
   - `shifts` excludes cancelled shifts (`status !== 'cancelled'`).
   - `employees` keeps an employee iff `is_active` **or** they have a remaining
     (non-cancelled) shift — the same predicate the grid applies, minus
     position/area filtering (which the export dialog already applies on top).

   To guarantee parity and avoid drift, the helper is built on the same
   `buildActiveShiftEmployeeIds` set logic the grid uses.

3. **Apply it once inside `ScheduleExportDialog`,** at the prop boundary:
   derive `visibleShifts` / `visibleEmployees` from the incoming props and use
   those as the single source for everything downstream — the checkbox list,
   the live preview, and both `generateRosterPDF` / `generateSchedulePDF`
   calls. The raw props are left untouched; the dialog sanitizes at its edge.

### Why this over alternatives

- **Filtering at the call site** (passing a pre-filtered list from
  `Scheduling.tsx`) fixes the symptom but scatters the visibility rule and
  couples the fix to one caller.
- **Filtering inside each PDF generator** duplicates the rule across two
  functions and the dialog preview — three places to drift.
- **A single dialog-level chokepoint** backed by a shared, unit-tested helper
  guarantees `print == grid` and centralizes the rule for future changes.

## Components & data flow

```
Scheduling.tsx
  allEmployees (status:'all')  ─┐
  shifts (current week)         ├─► <ScheduleExportDialog>
                                │       selectVisibleRosterInputs(props.shifts, props.employees)
                                │            │  drop cancelled shifts
                                │            │  drop inactive-with-no-live-shift employees
                                │            ▼
                                │       { visibleShifts, visibleEmployees }
                                │            ├─► checkbox list (allEmployeesWithShifts)
                                │            ├─► preview (buildRosterDay / grid)
                                │            └─► handleExport → generateRosterPDF / generateSchedulePDF
```

`scheduleVisibility.ts` (new)
  - `buildActiveShiftEmployeeIds(shifts)`        (moved from Scheduling.tsx)
  - `filterEmployeesForScheduleView(...)`        (moved from Scheduling.tsx)
  - `selectVisibleRosterInputs(shifts, employees)` (new)

`Scheduling.tsx`
  - re-exports the two moved helpers (backward compat for tests/consumers)

## Error / edge handling

- Empty shifts or empty employees → helper returns empty arrays; dialog already
  renders the "No one scheduled" / "No employees selected" states.
- An active employee whose only shift that day is cancelled → still listed as an
  employee (active), but that day reads "OFF" / no row, because the cancelled
  shift is stripped. Correct.
- `selectedEmployeeIds` initialization in the dialog already keys off the
  derived employee list, so it naturally re-initializes from the filtered set.

## Testing

New unit tests (`tests/unit/scheduleVisibility.test.ts`):
- `selectVisibleRosterInputs`:
  - inactive employee + only a cancelled shift → **excluded**, and the cancelled
    shift is stripped from the returned shifts.
  - inactive employee + a non-cancelled shift → **included** (parity with grid).
  - active employee → always included; their cancelled shifts are stripped.
  - cancelled shifts are removed regardless of employee.
  - empty inputs → empty outputs.
- Parity assertion: for a fixed dataset, the employee set returned by
  `selectVisibleRosterInputs` equals the grid's
  `filterEmployeesForScheduleView(...)` with no position/area filter.

Existing suites that must stay green: `schedulingHelpers.test.ts` (import path
unchanged via re-export), `scheduleRoster*.test.ts`, `scheduleExport*.test.ts`.

Optionally a dialog-level test asserting an inactive-with-cancelled-shift
employee is absent from the rendered checkbox list.

## Out of scope

- No change to how employees are deactivated or how shifts are cancelled.
- No change to the grid's own rendering.
- No DB / RLS / edge-function changes.
