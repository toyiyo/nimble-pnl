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

### Implementation contract (precise change list)

`selectVisibleRosterInputs` signature:
```ts
function selectVisibleRosterInputs(
  shifts: Shift[],
  employees: Employee[],
): { shifts: Shift[]; employees: Employee[] }
```

Inside `ScheduleExportDialog`, in order:

- **Order matters — filter visibility on the RAW props first.** Compute
  `const { shifts: visibleShifts, employees: visibleEmployees } =
  selectVisibleRosterInputs(shifts, employees)` from the **raw** `props.shifts`
  and `props.employees`, *before* the existing position/area `filteredShifts`
  memo runs. Rationale: the grid derives `buildActiveShiftEmployeeIds` from the
  full (un-position/area-filtered) shift list, then applies position/area to
  the *employee* list. Running visibility on already-position-filtered shifts
  would wrongly hide an inactive employee whose live shift is in a different
  area than the active filter. So: visibility filter → then position/area
  filter.
- Memoize it: `useMemo(() => selectVisibleRosterInputs(shifts, employees), [shifts, employees])`.
- `filteredShifts` memo: operate on `visibleShifts` (not raw `shifts`); its
  `emp` lookup uses `visibleEmployees`. Update deps to
  `[visibleShifts, visibleEmployees, positionFilter, areaFilter]`.
- `allEmployeesWithShifts` memo: join `filteredShifts` ids against
  `visibleEmployees`. Deps `[filteredShifts, visibleEmployees]`.
- `previewRosterDay` memo: call `buildRosterDay(selectedShifts, visibleEmployees, …)`
  (not raw `employees`). Update deps to use `visibleEmployees`.
- `getShiftDisplay` reads from `filteredShifts` (already visible) — no change.
- `handleExport`: pass `shifts={visibleShifts}` and `employees={visibleEmployees}`
  to **both** `generateRosterPDF` and `generateSchedulePDF` — not the raw props.
  This is the load-bearing change for the actual PDF output; updating only the
  checkbox list / preview without this leaves the bug in the exported file.
- `selectedEmployeeIds` invariant: it is initialized from
  `allEmployeesWithShifts` (now derived from `visibleEmployees`) via the
  existing `useEffect` keyed on `[open, allEmployeesWithShifts]`. That effect
  must keep depending on `allEmployeesWithShifts` (the derived list), not the
  raw `employees` prop, so stale ids for now-hidden employees are dropped on
  open. The invariant `selectedEmployeeIds ⊆ visibleEmployees.ids` then holds,
  so the generators' internal `selectedEmployeeIds` filter cannot re-admit a
  hidden employee.

**PDF generators (`scheduleExport.ts`) need no signature change.** They keep
re-deriving their own `shiftEmployeeIds` internally, but since they now receive
`visibleShifts` (cancelled stripped) + `visibleEmployees` (inactive-no-live-shift
stripped), that internal derivation becomes redundant-but-harmless: it can only
ever produce a subset of the already-visible set. No edit required inside the
generators; the fix lives entirely at the dialog boundary.

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

New unit tests (`tests/unit/scheduleVisibility.test.ts`) — import the helpers
**directly from `@/lib/scheduleVisibility`** (not via `@/pages/Scheduling`) to
avoid dragging the heavy page import graph into the test:
- `selectVisibleRosterInputs`:
  - inactive employee + only a cancelled shift → **excluded**, and the cancelled
    shift is stripped from the returned shifts.
  - inactive employee + a non-cancelled shift → **included** (parity with grid).
  - active employee → always included; their cancelled shifts are stripped.
  - cancelled shifts are removed regardless of employee.
  - empty inputs → empty outputs.
- Parity assertion: for a fixed dataset, the employee set returned by
  `selectVisibleRosterInputs(shifts, employees)` equals the grid's
  `filterEmployeesForScheduleView(employees, buildActiveShiftEmployeeIds(shifts), null, null)`
  — note the parity test feeds the **full** shift list to
  `buildActiveShiftEmployeeIds` (matching how the grid computes the id set
  before applying position/area to the employee list).

Existing suites that must stay green: `schedulingHelpers.test.ts` (import path
unchanged via re-export), `scheduleRoster*.test.ts`, `scheduleExport*.test.ts`.

Optionally a dialog-level test asserting an inactive-with-cancelled-shift
employee is absent from the rendered checkbox list.

## Out of scope

- No change to how employees are deactivated or how shifts are cancelled.
- No change to the grid's own rendering.
- No DB / RLS / edge-function changes.
