# Planner Conflict Indicators — Plan

Date: 2026-09-09
Design: docs/superpowers/specs/2026-09-09-planner-conflict-indicators-design.md
Branch: `claude/planner-conflict-indicators-w4m1n5`

Each task follows RED → GREEN → REFACTOR → COMMIT. Fixtures use explicit
UTC instants. Run new unit tests once under `TZ=UTC` before the commit.

## Task 1 — `buildShiftConflictIndex` + `usePlannerShiftConflicts`

New file: `src/hooks/usePlannerShiftConflicts.ts`.
New test: `tests/unit/usePlannerShiftConflicts.test.ts`.

Exports:

```ts
export function buildShiftConflictIndex(
  shifts: readonly Shift[],
  availabilityByEmployee: Map<string, Map<number, EffectiveAvailability>>,
  timeOffRequests: readonly TimeOffRequest[],
  timezone: string,
): Map<string, string[]>;   // shiftId -> formatted conflict lines

export function usePlannerShiftConflicts(...same args): {
  conflictsByShiftId: Map<string, string[]>;
  conflictedShiftCount: number; // shifts with >= 1 line
}
```

Rules (from the design, §1):

- Skip a shift when `status` is `cancelled` or `completed`, or when
  `employee_id` is empty.
- Local dates via `formatLocalDateInTz`; a local-midnight end
  (`formatLocalTimeInTz` gives `00:00:00`) with `end > start` moves the end
  date back one day.
- Time-off: index requests by `employee_id` once; match `status` in
  `('approved','pending')` and `start_date <= shiftEndDate` and
  `end_date >= shiftStartDate`. Message:
  `Employee has ${status} time-off from ${start_date} to ${end_date}`.
- Availability: skip when `availabilityByEmployee` has no entry for the
  employee. Read `today`/`prevDay`/`nextDay` by day-of-week; call
  `shiftOutsideAvailability(today, prev, start, end, tz, localDate, next)`.
  `conflict_type` from `today.type`; a `'not-set'` day maps to
  `'recurring'` with no window fields. Message contains the ISO local date.
  Window fields come from the first available slot of `today`.
- Format every `ConflictCheck` with `formatConflictLine(conflict, tz)`.
- A shift with zero conflicts gets no map entry.

Test cases: approved overlap, pending overlap, non-overlap, `cancelled`
skip, `completed` skip, unassigned skip, midnight-end rule, recurring-off
day, outside-window shift, exception day, `not-set` day with no other
data (no conflict), missing employee entry (time-off still checked),
formatted line content, `conflictedShiftCount`.

## Task 2 — `ConflictBadge`

New file: `src/components/scheduling/ShiftPlanner/ConflictBadge.tsx`.
New test: `tests/unit/conflictBadge.test.tsx`.

Props: `{ lines: string[] }`. Renders an `AlertTriangle`
(`h-3 w-3 text-warning`) as a `type="button"` inside a Radix `Popover`.
`onClick` calls `e.stopPropagation()`. `aria-label` =
`Conflicts: ${lines.join('. ')}`. The popover lists each line and opens on click or tap.
Tests: render, aria-label text, stopPropagation (cell-level click handler
does not fire), popover content on click.

## Task 3 — `EmployeeChip` conflict prop

Change: `src/components/scheduling/ShiftPlanner/EmployeeChip.tsx`.
New test: `tests/unit/employeeChip.conflicts.test.tsx`.

Optional prop `conflictLines?: string[]`. Non-empty →
`border-l-2 border-l-warning` on the chip and a `ConflictBadge` before
the name. Comparator: length plus element equality on `conflictLines`.
Tests: amber class present/absent, badge present/absent, comparator
source-text invariant (matches the pattern in
`tests/unit/EmployeeChip.test.tsx`).

## Task 4 — `ShiftCell` pass-through

Change: `src/components/scheduling/ShiftPlanner/ShiftCell.tsx`.
Extend test: `tests/unit/shiftCellMemoComparator.test.tsx` (or a new
sibling file).

Optional prop `conflictsByShiftId?: Map<string, string[]>`. Pass
`conflictLines={conflictsByShiftId?.get(shift.id)}` to each chip. The
comparator adds: every shift in `next.shifts` has the same map value in
`prev` and `next` (value equality per entry, through `sameConflictLines`,
as the design section 3 requires).

## Task 5 — Lane indicators

Change: `src/components/scheduling/ShiftPlanner/OffTemplateRow.tsx` and
`src/components/scheduling/ShiftPlanner/HiddenTemplatesRow.tsx`.
New test: `tests/unit/plannerLaneConflicts.test.tsx`.

Optional prop `conflictsByShiftId?: Map<string, string[]>` on both. A
conflicted row gets `border-l-2 border-l-warning` and a `ConflictBadge`.
Tests: badge renders in each lane with lines, absent without.

## Task 6 — `TemplateGrid` pass-through

Change: `src/components/scheduling/ShiftPlanner/TemplateGrid.tsx`.

Add `conflictsByShiftId` to props; pass to `ShiftCell`, `OffTemplateRow`,
`HiddenTemplatesRow`. Covered by the Task 8 wiring test — no own test
file.

## Task 7 — `PlannerHeader` rollup

Change: `src/components/scheduling/ShiftPlanner/PlannerHeader.tsx`.
New test: `tests/unit/plannerHeaderConflicts.test.tsx`.

Optional props `conflictedShiftCount?: number` and `conflictsUnavailable?:
boolean`. Count above zero → amber pill (`text-[11px] px-1.5 py-0.5
rounded-md bg-warning/10 text-amber-700 dark:text-amber-400`,
`AlertTriangle`, label `1 conflict` / `N conflicts`).
`conflictsUnavailable` → muted `Conflicts unavailable` note
(`text-[13px] text-muted-foreground`) instead of the pill.
Tests: singular label, plural label, zero renders nothing, unavailable
note wins over the pill.

## Task 8 — `ShiftPlannerTab` wiring

Change: `src/components/scheduling/ShiftPlanner/ShiftPlannerTab.tsx`.
New test: `tests/unit/shiftPlannerTab.conflictWiring.test.tsx` (model:
`tests/unit/shiftPlannerTab.availabilityWiring.test.tsx`).

- Call `useTimeOffRequests(restaurantId)`.
- Call `usePlannerShiftConflicts` after the `availabilityByEmployee` memo.
- Load state: while any conflict source query loads, pass an empty map
  and no count. Error state: when any source errors, pass
  `conflictsUnavailable` to the header and an empty map to the grid.
- Pass `conflictsByShiftId` to `TemplateGrid`; `conflictedShiftCount` /
  `conflictsUnavailable` to `PlannerHeader`.
- Mount test: mock every export of every mocked hook module (including
  `useTimeOffRequests`), wrap in `QueryClientProvider` +
  `TooltipProvider`; seed one approved time-off over one shift; check the
  chip triangle and the header pill; check the error state shows the note.

## Task 9 — E2E

Extend: `tests/e2e/scheduling-conflicts.spec.ts` (shared setup seeds
employees; `shift-protection.spec.ts:107` shows the time-off seed
pattern).

New test: seed an approved time-off for the week, create a planner shift
for that employee on a covered day, check the chip triangle
(`getByRole('button', { name: /conflicts:/i })`) and the header pill
(`/1 conflict/`) appear without any dialog open. Local run is not
possible in this container (no `supabase` CLI) — CI runs it.

## Order

1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9. Tasks 3-7 depend on 1-2 only through
props; each commits separately.
