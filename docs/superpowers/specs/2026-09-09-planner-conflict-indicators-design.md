# Planner Conflict Indicators — Design

Date: 2026-09-09
Branch: `claude/planner-conflict-indicators-w4m1n5`
Status: Approved direction from the user; details below.

## Problem

The schedule view shows a conflict on each shift card. The planner view does
not. A manager sets the schedule in the planner. Later, an employee gets
approved time-off, or a shift sits outside the employee's availability. The
planner shows no warning. The manager sees the problem at service time.

## Current behavior (premises, with citations)

- The schedule view runs two RPCs per shift card through `useCheckConflicts`
  (`src/pages/SchedulingShiftCard.tsx:82`). The RPCs are
  `check_timeoff_conflict` and `check_availability_conflict`
  (`src/hooks/useConflictDetection.tsx:37-49`).
- A conflicted card gets an amber border and a pulsing `AlertTriangle`
  (`src/pages/SchedulingShiftCard.tsx:19-21` and `:158-160`). A hover tooltip
  lists each conflict message (`src/pages/SchedulingShiftCard.tsx:187-199`).
- The card skips the RPCs for `cancelled` and `completed` shifts
  (`src/pages/SchedulingShiftCard.tsx:69-80`).
- The planner shows a conflict only at two transient moments. During a drag,
  `computeAllocationStatus` marks a cell `conflict` — this detects only a
  shift overlap, not time-off or availability
  (`src/lib/shiftAllocation.ts:55-85`; badge at
  `src/components/scheduling/ShiftPlanner/ShiftCell.tsx:139-143`). At assign
  time, `AvailabilityConflictDialog` warns once
  (`src/components/scheduling/ShiftPlanner/AvailabilityConflictDialog.tsx:22`).
- After the assignment, `EmployeeChip` shows no conflict state
  (`src/components/scheduling/ShiftPlanner/EmployeeChip.tsx:22-81`). Its only
  consumer is `ShiftCell`
  (`src/components/scheduling/ShiftPlanner/ShiftCell.tsx:145`).
- The planner already loads availability and exceptions
  (`src/components/scheduling/ShiftPlanner/ShiftPlannerTab.tsx:200-201`) and
  builds `availabilityByEmployee` with `computeEffectiveAvailability`
  (`ShiftPlannerTab.tsx:206-215`).
- The planner loads no time-off data. A grep for `timeOff` in
  `src/components/scheduling/ShiftPlanner/` returns no import of any
  time-off hook.
- `shiftOutsideAvailability` is the tested client mirror of the availability
  RPC (`src/lib/effectiveAvailability.ts:269-331`). `TimelineBar` calls it
  for its live amber marker
  (`src/components/scheduling/ShiftTimeline/TimelineBar.tsx:157`) with the
  treatment `border-l-2 border-l-amber-500` (`TimelineBar.tsx:187`).
- `formatConflictLine` formats a `ConflictCheck` for display
  (`src/lib/conflictFormatUtils.ts:70-105`). It passes a time-off message
  through unchanged (`conflictFormatUtils.ts:75-77`) and renders the
  availability window from `available_start`/`available_end`
  (`conflictFormatUtils.ts:79-97`).
- `useTimeOffRequests` fetches all requests for a restaurant with the
  employee join (`src/hooks/useTimeOffRequests.tsx:14-43`). Create and
  review mutations invalidate its key `['time-off-requests', restaurantId]`
  (`useTimeOffRequests.tsx:62` and `:137`).
- The latest `check_timeoff_conflict` counts `status IN ('approved',
  'pending')`
  (`supabase/migrations/20260723180000_timeoff_conflict_local_tz.sql:97`).
  It compares restaurant-local calendar dates, and a shift that ends at
  local midnight belongs to its start day
  (`20260723180000_timeoff_conflict_local_tz.sql:80-84`).
- `formatLocalDateInTz` converts an instant to a `YYYY-MM-DD` date in an
  explicit IANA timezone (`src/lib/shiftInterval.ts:207-209`).
  `formatLocalTimeInTz` gives the wall-clock `HH:MM:SS`
  (`src/lib/shiftInterval.ts:220-224`).
- The app root wraps the tree in `TooltipProvider` (`src/App.tsx:349`).
- `PlannerHeader` has a right-side summary section
  (`src/components/scheduling/ShiftPlanner/PlannerHeader.tsx:81-99`).
- `OffTemplateRow` renders unmatched shifts as display-only rows with a
  remove action
  (`src/components/scheduling/ShiftPlanner/OffTemplateRow.tsx:37-60`, remove
  button at `:50-57`).
- `HiddenTemplatesRow` renders hidden-template shifts dimmed, with a remove
  action, when `showHidden` is off
  (`src/components/scheduling/ShiftPlanner/HiddenTemplatesRow.tsx:22-25`,
  dimmed chip at `:67`, remove button at `:74-80`).
- `ShiftCell` and `EmployeeChip` use custom memo comparators
  (`ShiftCell.tsx:223-249`, `EmployeeChip.tsx:73-81`).

## Decision

Add a persistent, read-time conflict layer to the planner. Detect conflicts
client-side in one batch. Do not add per-chip RPC calls — the planner renders
one chip per shift for the whole week, and two RPCs per chip creates too
many requests. The write-time gate (`AvailabilityConflictDialog`) stays unchanged.
The SQL RPCs stay authoritative at write time; this layer is a read-time
preview, the same split the unit-conversion system uses.

## Design

### 1. Detection — new hook `usePlannerShiftConflicts`

New file `src/hooks/usePlannerShiftConflicts.ts`. It exports:

- A pure function `buildShiftConflictIndex(shifts, availabilityByEmployee,
  timeOffRequests, timezone)` that returns `Map<shiftId, string[]>`. Each
  value holds display-ready conflict lines.
- A hook `usePlannerShiftConflicts(...)` that wraps the function in one
  `useMemo`.

Per shift, the function:

1. Skips the shift when `status` is `cancelled` or `completed`, or when
   `employee_id` is empty. This mirrors the schedule card's skip.
2. Computes the shift's restaurant-local start and end dates with
   `formatLocalDateInTz`. When the end falls on local midnight
   (`formatLocalTimeInTz` gives `00:00:00`) and the end date is after the
   start date, the end date moves back one day. This mirrors the RPC.
3. **Time-off:** finds requests for the employee with `status` in
   `('approved', 'pending')` where `start_date <= shiftEndDate` and
   `end_date >= shiftStartDate`. Each match makes a `ConflictCheck` with
   `conflict_type: 'time-off'` and the message
   `Employee has <status> time-off from <start_date> to <end_date>` —
   the exact format the schedule view shows
   (`src/hooks/useConflictDetection.tsx:60`).
4. **Availability:** reads `today`, `prevDay`, and `nextDay` from
   `availabilityByEmployee` by the local day-of-week, then calls
   `shiftOutsideAvailability`. When the map has no entry for the shift's
   employee, the function skips the availability check and keeps the
   time-off check. On `true`, it makes a `ConflictCheck` with
   `conflict_type` from `today.type` (`'exception'` or `'recurring'`), a
   message that contains the ISO shift date, and `available_start`/
   `available_end` from the first available slot. A `'not-set'` day can
   still conflict through the prev-day or next-day rules
   (`src/lib/effectiveAvailability.ts:280-303`); that case maps to
   `conflict_type: 'recurring'` with no window fields —
   `formatConflictLine` handles a missing window
   (`src/lib/conflictFormatUtils.ts:99-104`). `formatConflictLine` then
   renders the same wording the assign-time dialog shows.
5. Formats each `ConflictCheck` with `formatConflictLine(conflict, timezone)`
   and stores the lines in the map. A shift with zero conflicts gets no
   entry.

Cost: one pass over shifts with a per-employee time-off index. No new
network calls. The time-off data comes from `useTimeOffRequests` — its
mutations already invalidate the query key, so an approval made elsewhere
appears on the next refetch (30s staleTime).

### 2. Shared badge — new `ConflictBadge` component

New file `src/components/scheduling/ShiftPlanner/ConflictBadge.tsx`. It
renders the triangle-with-tooltip affordance once, for every lane:

- An `AlertTriangle` (`h-3 w-3 text-amber-500`) as a focusable
  `type="button"` inside a Radix `Tooltip`. The tooltip lists each line.
- The click handler calls `e.stopPropagation()` — the chip sits in a
  `ShiftCell` with a cell-level tap-to-assign `onClick`
  (`src/components/scheduling/ShiftPlanner/ShiftCell.tsx:121`); without the
  guard, a tap on the triangle assigns the selected employee.
- The button's `aria-label` carries the full conflict text, so keyboard and
  screen-reader users get the same information as hover users. The app-root
  `TooltipProvider` covers this tree.

### 3. Chip indicator — `EmployeeChip`

New optional prop `conflictLines?: string[]`. When the array has entries:

- The chip gets `border-l-2 border-l-amber-500` — the same low-contrast
  treatment `TimelineBar` uses. The position color stays the fill.
- A `ConflictBadge` renders before the name.

The memo comparator compares the lines by length plus element equality,
not by array reference — the map rebuilds wholesale on every planner edit
(same reason the coverage comparator compares values,
`ShiftCell.tsx:223-232`) — and not by a joined string, which would allocate
on every compare.

### 4. Cell pass-through — `ShiftCell`, `TemplateGrid`, and the two lanes

- `ShiftCell` gets `conflictsByShiftId?: Map<string, string[]>` and passes
  each chip its lines. Its comparator adds a per-shift value comparison for
  this map.
- `TemplateGrid` passes the map through.
- `OffTemplateRow` and `HiddenTemplatesRow` get the same optional map. A
  conflicted row in either lane gets the amber left border and a
  `ConflictBadge`, so the header count always matches the visible
  triangles.

### 5. Week rollup — `PlannerHeader`

New optional prop `conflictedShiftCount?: number`. When above zero, an amber pill
renders before the hours stat: `AlertTriangle` plus the count, with the
badge scale `text-[11px] px-1.5 py-0.5 rounded-md` and the tint
`bg-amber-500/10 text-amber-700 dark:text-amber-400` (the amber pair
`availabilityColorClasses` already uses,
`src/lib/effectiveAvailability.ts:210`). The label is `1 conflict` for one
and `N conflicts` above one. The pill is informational — no click behavior
in this iteration. The count equals the number of shifts that have at
least one conflict line.

### 6. Wiring — `ShiftPlannerTab`

- Call `useTimeOffRequests(restaurantId)`.
- Call `usePlannerShiftConflicts` after the `availabilityByEmployee` memo
  (declaration order matters: `restaurantTimezone` sits at
  `ShiftPlannerTab.tsx:145`, above every memo — no TDZ risk).
- Pass the map to `TemplateGrid` and the count to `PlannerHeader`.
- **Load state:** while any conflict source query loads (time-off,
  availability, exceptions), pass an empty map and no count — the planner
  shows no indicator rather than a partial one.
- **Error state:** when any conflict source query errors, show a muted
  `Conflicts unavailable` note (`text-[13px] text-muted-foreground`) in the
  header's summary section instead of the pill, and suppress the chip
  indicators. A zero without a warning shows incorrect data.

## Scope limits (decided trade-offs)

- A shift that crosses midnight buckets on its start date in the planner
  grid (`src/hooks/usePlannerShiftsIndex.ts:12-15`). The conflict check
  itself uses both local dates, so the time-off overlap stays correct.
- Radix tooltips do not open on touch. The amber border and the triangle
  stay visible on mobile; the full text needs a pointer or keyboard. The
  schedule view has the same limitation.
- The pending-time-off match mirrors the RPC (`approved` and `pending`).
  The message names the status, so a manager can tell them apart.
- **Reuse of `useTimeOffRequests`:** the hook selects `*` with the employee
  join and no date filter (`src/hooks/useTimeOffRequests.tsx:20-27`).
  Reuse keeps one cache and one invalidation path with the schedule view
  (`src/pages/Scheduling.tsx:338` uses the same hook); a second, filtered
  query would drift. The per-employee index makes the client scan cheap. A
  bounded-range variant is a follow-up, not part of this change.
- **Amber literals, not the `warning` token:** the schedule card uses
  `border-l-warning` (`src/pages/SchedulingShiftCard.tsx:20`), but every
  planner warning surface uses amber literals — `TimelineBar.tsx:187`,
  `AvailabilityConflictDialog.tsx:41-42`, and `availabilityColorClasses`
  (`src/lib/effectiveAvailability.ts:210`). The planner indicator matches
  its own view's language.
- **Timezone fallback divergence:** the client uses `safeTz`, which maps a
  null or invalid `restaurants.timezone` to `'America/Chicago'`
  (`ShiftPlannerTab.tsx:136-145`); both RPCs fall back to `'UTC'`
  (`supabase/migrations/20260723180000_timeoff_conflict_local_tz.sql:55`).
  For such a tenant, the indicator and the write-time gate can evaluate
  different local dates. Production rows hold real IANA names; accepted.
- **Day-of-week wrap at week edges:** `computeEffectiveAvailability` keys
  exceptions to the one date per day-of-week inside the displayed week
  (`src/lib/effectiveAvailability.ts:58-62`), so the `prevDay`/`nextDay`
  lookup can wrap to the other end of the week. `TimelineBar.tsx:153-154`
  shares this limit. Accepted; the RPC walks real dates and stays
  authoritative at write time.
- **Single-window containment:** `shiftOutsideAvailability` requires the
  whole shift inside one window (`src/lib/effectiveAvailability.ts:330`);
  the RPC clips the shift per local date. A cross-midnight shift covered by
  two adjacent days' windows can get a spurious client-side marker. The
  write-time RPC stays authoritative. Accepted.

## Tests

- `tests/unit/usePlannerShiftConflicts.test.ts` — pure-function tests with
  fixtures anchored to explicit UTC instants: approved and pending overlap,
  non-overlap, `cancelled`/`completed`/unassigned skip, local-midnight end
  rule, recurring-off day, outside-window shift, exception day, `not-set`
  day, formatted line content.
- `tests/unit/employeeChip.conflicts.test.tsx` — render tests: amber class,
  triangle button `aria-label`, `stopPropagation` on click, no indicator
  without lines, comparator covers `conflictLines`.
- Extend a `shiftPlannerTab` mount test: seeded conflict shows the header
  pill and the chip indicator. Mock every export of the hooks the tree
  imports and wrap in `TooltipProvider` (lesson 2026-07-14).
- `tests/e2e/` — extend the planner spec: seed an approved time-off over an
  assigned shift, check the triangle and the header count appear.
