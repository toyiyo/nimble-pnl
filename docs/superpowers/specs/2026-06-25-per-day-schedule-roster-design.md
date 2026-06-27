# Per-Day Schedule Roster (Print/PDF) — Design

**Date:** 2026-06-25
**Status:** Approved — proceeding to implementation plan
**Area:** Scheduling → Print/Export

## Problem

On the weekly scheduling view (`/scheduling?week=...`), managers print the schedule to
see, for a given day, **who is coming in the morning and who is coming in the afternoon**.
The current printed artifact is a weekly grid — employee rows (A–Z) × 7 day columns — where
each employee is a single row shared across all days. That structure **cannot** order a single
day by start time: sorting "Thursday's column" would necessarily reorder every other day too,
because the rows are shared.

This restaurant also runs **two stores under one restaurant**, separated by the employee
`area` field. A recent change (#551) threaded `areaFilter` and `groupBy` through the print/PDF
pipeline. The new roster must preserve that area separation.

## Goal

Add a **per-day roster** print layout. For each day, list the people working that day as a
sorted timeline ("who's coming in when"), with the two stores (`area`) as sub-sections within
each day. Sortable per day by **start time** (default), **name**, or **hours scheduled**.

## Non-Goals (Out of Scope)

- Reordering the **on-screen** schedule grid. This feature is print/PDF only.
- The ShiftPlanner *template* export path (`src/utils/plannerExport.ts`,
  `PlannerExportDialog.tsx`) — that is a separate, template-oriented artifact.
- Any database, RPC, RLS, or edge-function changes. This is entirely client-side.
- Persisting the chosen layout/sort across sessions. The dialog resets to defaults each open.

## The Artifact

A new PDF layout, selectable in the existing Print dialog. The week is broken into **day
sections** (default: all 7 days, stacked). Each day section contains, per area, a sorted list
of shift rows:

```
THURSDAY · Jun 25                                  12 staff · 84.5 hrs
  ── Front Store ───────────────────────────────────────────────────
    6A-2P    Alice Chen        Server       8.0
    7A-3P    Bob Diaz          Cook         7.5
    4P-CL    Eve Wong          Server       5.0
  ── Back Store ────────────────────────────────────────────────────
    8A-4P    Frank Lee         Prep         8.0
    ...
FRIDAY · Jun 26                                     10 staff · 71.0 hrs
  ...
```

- **Day-first, area-second** nesting. Reads naturally as "who's coming Thursday, by store."
- **Time column** reuses `formatKitchenTime` (`6A-2P`, `4P-CL`) for consistency with the grid.
- **Position** column shown when "Include position labels" is on (existing option).
- **Hours** column shown when "Include hours summary" is on (existing option); in the roster it
  is **per-shift** net hours (`calculateShiftHours`).
- **Day header** shows the distinct staff count and total net hours for that day.

## Decisions (confirmed with user)

1. **Row = one shift.** A split shift (6A-2P *and* 5P-9P for the same person) renders as **two
   rows**, so the person appears in both the morning and the evening of the timeline.
2. **Scope = whole week by default** (7 stacked day sections). A **Day picker** narrows output
   to a single day (e.g. Thursday only).
3. **Keep the existing weekly grid.** Add a **Layout** toggle (Weekly grid / Per-day roster).
   Default = Per-day roster. The grid path is unchanged.
4. **Hours sort = most hours first** (descending).

## Sorting Rules

A new **Sort by** control (roster only). Sorting is applied **within each area sub-section**,
never across sections (sections keep their own order — see Grouping).

| Sort by             | Order                          | Tie-break        |
| ------------------- | ------------------------------ | ---------------- |
| **Start time** (def)| ascending start-of-day time    | name A–Z         |
| **Name**            | name A–Z (`localeCompare`)     | start time asc   |
| **Hours scheduled** | descending net hours           | name A–Z         |

Start-time ascending = openers (6A) first, closers (4P) last → morning crew on top.

## Grouping (Area / Two Stores)

Reuses the page's existing `groupBy: 'none' | 'area' | 'position'` and `areaFilter`, already
passed into `ScheduleExportDialog`.

- `groupBy === 'area'` → one sub-section per area within each day. Area sub-sections are ordered
  **alphabetically, with "Unassigned" last** — same convention as `scheduleGrouping.ts`
  (reuse the exported `UNASSIGNED_LABEL` constant).
- `groupBy === 'position'` → sub-section per position (parity; same ordering rule).
- `groupBy === 'none'` → a single un-headed list per day.
- `areaFilter` set to one store → only that store's shifts print (existing AND-filter semantics).
- `positionFilter` and the employee multi-select continue to filter which shifts/people appear.

## Data Flow & Files

All shift/employee filtering (area, position, selected employees) happens **before** the pure
roster builder, reusing the dialog's existing `filteredShifts` logic. The builder only
groups + sorts + aggregates, keeping it pure and unit-testable.

### New: `src/lib/scheduleRoster.ts` (pure, unit-tested)

```ts
export type RosterSortBy = 'startTime' | 'name' | 'hours';

export interface RosterRow {
  shift: Shift;
  employee: Employee;
  hours: number;          // calculateShiftHours(shift)
}

export interface RosterSection {
  label: string;          // area/position label, '' when groupBy === 'none'
  rows: RosterRow[];      // sorted per RosterSortBy
}

export interface RosterDay {
  day: Date;
  sections: RosterSection[];
  totalStaff: number;     // distinct employees that day (split shift counts once)
  totalHours: number;     // sum of net hours
}

// Filters `shifts` to `day`, joins employees, groups by `groupBy`,
// sorts each section by `sortBy`. Employees already pre-filtered by caller.
export function buildRosterDay(
  shifts: Shift[],
  employees: Employee[],
  day: Date,
  sortBy: RosterSortBy,
  groupBy: GroupByMode,
): RosterDay;

// Convenience: map buildRosterDay over an array of days.
export function buildRoster(
  shifts: Shift[],
  employees: Employee[],
  days: Date[],
  sortBy: RosterSortBy,
  groupBy: GroupByMode,
): RosterDay[];
```

### Changed: `src/utils/scheduleExport.ts`

- New `generateRosterPDF(options: RosterExportOptions)` — **portrait** PDF (the roster is a
  narrow, tall list, unlike the landscape grid, so portrait fits more rows per page). Iterates
  `RosterDay[]`; for each day draws a day heading + summary, then renders rows grouped by area
  sub-header (full-width colSpan rows, matching the grid's group-header style). Columns:
  **Time · Employee · [Position] · [Hours]**. Reuses `formatKitchenTime`, `calculateShiftHours`,
  the `active()` filter helper, and chains `autoTable` via `lastAutoTable.finalY` for natural
  pagination.
- New `RosterExportOptions` interface (own type, not bolted onto `ScheduleExportOptions`):
  `{ shifts, employees, days, sortBy, groupBy, areaFilter, positionFilter, selectedEmployeeIds,
  includePositions, includeHoursSummary, restaurantName, weekStart, weekEnd }`. The existing
  `generateSchedulePDF` (grid) and `ScheduleExportOptions` are **untouched** — the two layouts
  stay isolated.

### Changed: `src/components/scheduling/ScheduleExportDialog.tsx`

- **Layout** toggle (Weekly grid / Per-day roster), default roster.
- **Sort by** select (Start time / Name / Hours scheduled), roster only.
- **Day** select (Whole week / each day of the viewed week), roster only.
- Preview switches to a representative roster (selected day, or first day of the week when
  "Whole week"), reflecting the chosen sort + grouping, capped to a few rows. Grid layout keeps
  the existing grid preview.
- Roster-only controls are hidden when Weekly grid is selected.
- On Download, the dialog dispatches at the call site: `layout === 'roster'` →
  `generateRosterPDF(...)`, otherwise the existing `generateSchedulePDF(...)`.

## Edge Cases

- **Day with no shifts** (whole-week scope): render the day header with an "No one scheduled"
  note so the gap is explicit rather than a missing day.
- **Employee with no `area`** under `groupBy='area'` → "Unassigned" sub-section, ordered last.
- **Split shifts** → two rows; `totalStaff` still counts the employee once.
- **Close time** (end at/after midnight) → `formatKitchenTime` already renders `CL`.
- **Timezone**: shift `start_time`/`end_time` are ISO strings; rendering uses `parseISO` +
  local `getHours()`, identical to the existing grid path. No new tz handling.
- **Empty selection / all filtered out**: Download button disabled (existing behavior).

## Testing

Per repo rules, the pure helper is unit-tested (`tests/unit/scheduleRoster.test.ts`, Vitest):

- groups by area; "Unassigned" ordered last
- `startTime` sort: morning shift before afternoon shift within a section
- `name` sort A–Z; `hours` sort most→least
- tie-breaks (equal start times fall back to name)
- split shift → two rows; `totalStaff` counts the employee once
- `totalHours` sums net hours (break excluded)
- empty day → no sections, zero totals
- `groupBy: 'none'` → single section with `label === ''`
- `groupBy: 'position'` → section per position

PDF rendering (`generateRosterPDF`) and the dialog are exercised manually / via existing E2E
patterns; the jsPDF output itself is not asserted (matches the current grid export's test
posture).

## Risks / Notes

- `generateRosterPDF` shares helpers with `generateSchedulePDF`; keep both lean and avoid
  regressing the grid path. The dispatcher keeps them isolated.
- Whole-week roster can be long (up to 7 sections); rely on `autoTable` auto-pagination. A
  page-break-per-day refinement can follow if managers find day sections split awkwardly.
