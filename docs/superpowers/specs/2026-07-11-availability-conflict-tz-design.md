# Design: Fix availability validation inconsistency + pre-drag availability visualization

**Date:** 2026-07-11
**Branch:** `fix/availability-conflict-tz`
**Author:** Jose M Delgado (with Claude)

## Problem

Availability validation in scheduling is wrong and inconsistent across views. A
manager set Termora Johnson available **Tuesday 2:00 PM – 10:30 PM** (visible and
correct in the Availability grid), but dragging her onto a Tuesday shift raised
*"Employee is not available on this day of the week."* The three code paths that
read availability disagree:

| Path | `day_of_week` read as | Times read as | Correct? |
|------|------|------|------|
| Availability grid (`TeamAvailabilityGrid` + `computeEffectiveAvailability`) | local | UTC→local for display | ✅ |
| AI auto-scheduler (`_shared/availability-tz.ts`) | converted to local (splits across midnight) | UTC→local | ✅ |
| Drag-to-assign conflict check (`check_availability_conflict` RPC) | **UTC** | **raw UTC** | ❌ |

### Root cause

`employee_availability` stores `day_of_week` as the **restaurant-local** weekday,
but `start_time`/`end_time` as **UTC clock times** (written by `AvailabilityDialog`
via `localTimeToUtcTime`; documented as lossy-by-design in
`src/lib/availabilityTimeUtils.ts`). The SQL RPC
`check_availability_conflict` (latest def:
`supabase/migrations/20260322170137_conflict_structured_data.sql`) derives the
weekday and time-of-day from the shift's **UTC** date via
`EXTRACT(DOW FROM v_current_date)` where `v_current_date := (p_start_time AT TIME
ZONE 'UTC')::date`, then compares against the local `day_of_week` column. For any
restaurant not on UTC these never line up.

Concretely: a Tuesday-evening local shift in an Americas timezone crosses midnight
**in UTC** and lands partly on **Wednesday UTC**. The RPC loops onto Wednesday,
reads the employee's *Wednesday* availability (`is_available = false`), and reports
it as *"not available on this day of the week"* — attributing Wednesday's status to
a Tuesday assignment. The shift instants reach the RPC correctly
(`interval.startAt.toISOString()` in `shiftMutationPipeline.ts`); the defect is
entirely inside the function's day/time derivation.

### Scope note

`check_availability_conflict` is invoked **only** from the client hook
`useConflictDetection.tsx`. No edge function calls it (the AI scheduler uses its own
`availability-tz.ts`). Its warnings are **advisory** — the dialog always offers
"Assign Anyway." So this is a client-triggered, overridable check; fixing it does
not change any server-authoritative contract.

## Goals

1. Correct the RPC so the drag-to-assign check matches the Availability grid and the
   AI validator — all three read availability in the restaurant-local frame.
2. When a shift is *partially* outside availability, show the available hours in the
   conflict dialog.
3. Visualize each employee's availability (available window / unavailable / not-set)
   **before** dragging, on the planner sidebar strip and the timeline lanes.

## Non-goals

- No schema migration of `employee_availability` (stays `TIME` columns with the
  documented UTC-clock + local-`day_of_week` contract).
- No change to the AI scheduler's validator.
- No change to the time-off RPC (`check_timeoff_conflict`) — it is date-based and
  unaffected.
- The RPC stays server-side and authoritative for the drag path; we are **not**
  moving conflict detection to the client (decision recorded below).

## Decided trade-offs

- **Fix the SQL RPC in place** rather than moving availability conflict detection to
  the client. Rationale: smallest surface, keeps the existing architecture and the 3
  existing pgTAP suites, and `restaurant_id` is already a parameter so the timezone
  lookup needs no signature or client change. Cost accepted: the RPC is a third
  implementation of the same UTC↔local logic (alongside `availabilityTimeUtils.ts`
  and `availability-tz.ts`); mitigated by thorough pgTAP timezone cases and a code
  comment cross-referencing `availability-tz.ts` as the canonical reference.

## Part 1 — Timezone-aware `check_availability_conflict`

**New migration** `supabase/migrations/<ts>_availability_conflict_local_tz.sql`
(forward-only; does **not** edit the prior migration). `CREATE OR REPLACE FUNCTION`
with the **same signature and RETURNS TABLE shape**:

```
check_availability_conflict(
  p_employee_id UUID, p_restaurant_id UUID,
  p_start_time TIMESTAMPTZ, p_end_time TIMESTAMPTZ
) RETURNS TABLE (
  has_conflict BOOLEAN, conflict_type TEXT, message TEXT,
  available_start TIME, available_end TIME
)
```

### Algorithm (restaurant-local frame)

1. **Resolve timezone.** `SELECT timezone INTO v_tz FROM restaurants WHERE id =
   p_restaurant_id`. Then `v_tz := COALESCE(NULLIF(v_tz, ''), 'UTC')`, and if
   `NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = v_tz)` set `v_tz :=
   'UTC'`. (Guards the lesson-2026-07-02 class of invalid-IANA failures.)
2. **Shift → local.** `v_start_local := p_start_time AT TIME ZONE v_tz`
   (`timestamp` in local wall-clock); `v_end_local := p_end_time AT TIME ZONE v_tz`.
   Compute `v_start_date`/`v_end_date` from these; a shift ending exactly at local
   `00:00` belongs to the prior local day (preserve existing end-date rule, in the
   local frame).
3. **Iterate local dates** `v_current_date` from start to end:
   - `v_day_of_week := EXTRACT(DOW FROM v_current_date)` — now **local**, matching
     the column.
   - The shift's local sub-interval on this date is `[v_seg_start, v_seg_end]`
     (concrete local `timestamp`s), clipped to the date for multi-day shifts.
   - **Exception check** (`availability_exceptions.date = v_current_date`; the
     `date` column is already a restaurant-local calendar date):
     - `is_available = false` → conflict `exception`, message *"Employee is
       unavailable on <date>[ (reason)]"*, NULL window.
     - has a window → convert its UTC-clock `start_time`/`end_time` → local (step
       below) and containment-check; if outside, conflict `exception` with the
       **stored UTC** window in `available_start`/`available_end`.
   - **Else recurring:** gather `employee_availability` rows with
     `day_of_week = v_day_of_week`. If any `is_available = false` → conflict
     `recurring`, message *"Employee is not available on this day of the week"*,
     NULL window. Otherwise, for each available row convert its window UTC→local and
     test containment; also consider a **previous-local-day** overnight row whose
     converted window wraps past midnight into `v_current_date`. If no window
     contains the segment → conflict `recurring`, message *"Shift on <date> is
     outside employee availability"*, returning the nearest stored UTC window in
     `available_start`/`available_end`.

### UTC-clock window → local, anchored to a date

Mirror `availability-tz.ts::utcClockToLocal` / `convertOne`:

```
-- start: interpret (anchor_date + start_utc) as a UTC instant, read local wall-clock
local_start := ((anchor_date + start_utc)::timestamp AT TIME ZONE 'UTC') AT TIME ZONE v_tz;
-- end: if the stored window crosses UTC midnight (end_utc <= start_utc), the end
-- instant is on the next day
end_anchor  := CASE WHEN end_utc <= start_utc THEN anchor_date + 1 ELSE anchor_date END;
local_end   := ((end_anchor + end_utc)::timestamp AT TIME ZONE 'UTC') AT TIME ZONE v_tz;
```

`anchor_date = v_current_date` for the current-day row and `v_current_date - 1` for
the previous-day overnight row. Comparisons use these concrete local `timestamp`
values, so a window that runs 6:00 PM → 2:00 AM is represented as
`[D 18:00, D+1 02:00]` and containment "just works" without special-casing
time-of-day wrap. This anchoring matches how the grid localizes each cell, so the
RPC and the grid stay consistent (including the documented ±1h edge at a DST
boundary, which both share).

### Return contract (unchanged, now correctly populated)

- `available_start`/`available_end` carry the **stored UTC** `TIME` values; the
  dialog's `formatConflictLine` localizes them (`formatUTCTimeToLocal`). No client
  change.
- Hard-off day (`is_available = false` / unavailable exception) → NULL window →
  dialog shows *"not available on this day."*
- Partial (outside an existing window) → window returned → dialog shows *"available
  X – Y."*

## Part 2 — Show the hours (verification only)

`formatConflictLine` already renders `available X – Y` when the RPC returns a
window. Part 1 makes those values populate for the partial-availability cases, so
this needs no new code — only a `conflictFormatUtils.test.ts` case asserting the
partial-availability line renders the localized window.

## Part 3 — Pre-drag availability visualization

Source of truth: `computeEffectiveAvailability(availability, exceptions, weekStart,
employeeIds)` — the same function the Availability grid uses, so the planner/timeline
overlay is consistent with that grid by construction.

### 3a. `ShiftPlannerTab` wiring

- Already calls `useEmployeeAvailability(restaurantId)`. Add
  `useAvailabilityExceptions(restaurantId)`.
- `useMemo` an effective-availability map for the planner's `weekStart` over the
  visible employees, keyed `employeeId → Map<dow, EffectiveAvailability>`.
- Pass each employee's slice into `EmployeeSidebar` → `EmployeeMiniWeek`, and into
  the timeline lane model.

### 3b. `EmployeeMiniWeek` (sidebar strip) — primary surface

- Behind each day's shift bars, paint an availability tint keyed off the day's
  `EffectiveAvailability`:
  - available (window) → `bg-emerald-500/10`
  - unavailable (recurring off / unavailable exception) → `bg-red-500/10` with a
    faint diagonal hatch
  - not-set → current neutral `bg-muted/30`
- Per-day accessibility: replace the blanket `aria-hidden="true"` with a per-day
  `role="img"` + `aria-label` and a shadcn `Tooltip`: *"Available 2:00 PM – 10:30
  PM"*, *"Unavailable Tue"*, or *"No availability set."* Times localized via
  `utcTimeToLocalTime` (restaurant timezone + the cell's date as DST anchor),
  matching the Availability grid's formatting.
- Component stays memoized; the availability slice is precomputed in the parent and
  passed as a prop (no hooks added inside the memoized row).

### 3c. Timeline lanes — secondary surface

- In `TimelineLane` (via `useTimelineModel`), render a subtle availability band for
  the lane's employee/day: a thin left border or low-opacity background over the
  lane's available window(s), reusing the same effective slice. Unavailable days get
  a muted/hatched lane background. Keep it low-contrast so shift bars remain the
  focal point; expose the same `aria-label` semantics.

## Testing

### pgTAP (`supabase/tests/`)

Extend the existing suites (`availability_conflict_utc.sql`,
`availability_overnight.sql`, `availability_conflict_structured.sql`) and add
timezone regressions. All dates computed relative to `CURRENT_DATE` (lesson
2026-04-21); deterministic fixtures — RLS disabled in-txn, delete-before-insert in
FK order, `ON CONFLICT DO UPDATE` (lesson 2026-04-22). Set the fixture restaurant's
`timezone` explicitly per case.

- **Non-UTC regression (the reported bug):** restaurant `America/New_York`,
  recurring Tuesday available 2:00 PM–10:30 PM (stored as the corresponding UTC
  clock), employee marked unavailable Wednesday. A Tuesday-evening shift must return
  **no conflict** (previously returned the false "not available on this day").
- **Partial outside-window:** same setup, Tuesday shift 11:00 AM–1:00 PM → conflict
  `recurring` with `available_start`/`available_end` = the stored UTC window.
- **Overnight local window:** available 6:00 PM–2:00 AM local; a 10:00 PM–1:00 AM
  shift → no conflict; a 3:00 AM shift → conflict.
- **Exception unavailable / exception window** in a non-UTC tz.
- **UTC restaurant** cases preserved (existing suites must still pass).
- **Invalid/empty timezone** → treated as UTC (no throw).

### Vitest (`tests/unit/`)

- `effectiveAvailability.test.ts`: extend with a not-set/available/unavailable
  matrix; assert TZ-portable via `new Date(y, m, d)` construction (lesson
  2026-05-10), exercised under `UTC`, `America/Los_Angeles`, `Asia/Tokyo`.
- `conflictFormatUtils.test.ts`: partial-availability line renders the localized
  window; hard-off line renders without a window.
- Sidebar tooltip/aria formatting covered by a focused component test if the logic
  is non-trivial (else covered by the effective-availability unit tests).

## Files touched

- **New:** `supabase/migrations/<ts>_availability_conflict_local_tz.sql`
- `supabase/tests/availability_conflict_utc.sql`,
  `availability_overnight.sql`, `availability_conflict_structured.sql` (extend)
- `src/components/scheduling/ShiftPlanner/ShiftPlannerTab.tsx` (wire exceptions +
  effective map)
- `src/components/scheduling/ShiftPlanner/EmployeeSidebar.tsx`,
  `EmployeeMiniWeek.tsx` (availability tint + tooltip/aria)
- `src/components/scheduling/ShiftTimeline/TimelineLane.tsx`,
  `useTimelineModel.ts` (lane availability band)
- `tests/unit/effectiveAvailability.test.ts`, `conflictFormatUtils.test.ts` (extend)
- Reference only (unchanged): `src/lib/conflictFormatUtils.ts`,
  `src/hooks/useConflictDetection.tsx`, `src/lib/availabilityTimeUtils.ts`,
  `supabase/functions/_shared/availability-tz.ts`

## Risks

- **plpgsql timezone math** is the exact class of subtle bug the codebase has been
  bitten by. Mitigation: mirror `availability-tz.ts` precisely, compare concrete
  local `timestamp`s (not time-of-day), and pin behavior with the pgTAP tz suite
  above.
- **DST ±1h edge:** stored UTC-clock times are anchored to the writer's "today"
  offset. The RPC anchors conversions to the evaluated date, matching the grid, so
  both are consistent; the residual ±1h at a DST transition is the documented,
  pre-existing schema limitation, not a regression.
- **Timeline overlay contrast:** must not compete with shift bars; keep low opacity
  and validate in Phase 5 UI review (light + dark).
