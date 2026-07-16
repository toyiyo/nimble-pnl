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

`LANGUAGE plpgsql STABLE`, `SECURITY INVOKER` (both unchanged — RLS on
`restaurants` / `employee_availability` / `availability_exceptions` stays enforced
under the caller's role), plus `SET search_path = public, pg_catalog` (new, per
review — matches repo convention and silences the `function_search_path_mutable`
advisory). No `DROP` needed: signature/return shape are unchanged, so
`CREATE OR REPLACE` is a pure catalog update with no lock risk.

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
     `available_start`/`available_end`. The "nearest window" tracker is updated
     across **both** the current-day and previous-day-overnight candidate loops, so
     an early-morning shift outside a prior-day overnight window still returns that
     window (fixes a pre-existing NULL-window gap flagged in review).
   - **Known parity gap (documented in the migration comment):** the exception
     lookup keeps `LIMIT 1`, so an employee with multiple split-window exceptions on
     one date is not fully modeled the way `computeEffectiveAvailability` (array of
     slots) is. Out of scope (no schema change); noted so it isn't silently
     inherited.

### UTC-clock window → local (mirror the **grid**, not `availability-tz.ts`)

**Correction (from Phase 2.5 review).** The first draft proposed mirroring
`availability-tz.ts::convertOne`, which *recomputes* the local weekday from the
converted instant (`zoned.getDay()`) and only compensates for **forward** end-time
rollover. That is wrong for windows whose local start, converted to UTC, exceeds
24:00 — e.g. `America/Los_Angeles` Monday 6:00 PM (stored `start_utc=01:00`,
`end_utc=02:00`, `day_of_week=1`). Anchoring `01:00 UTC` to Monday yields **Sunday**
18:00 local, so the whole window is misattributed to Sunday and a valid Monday
6 PM shift produces a false conflict. (This is a latent discrepancy in
`availability-tz.ts` itself vs. the grid; the AI scheduler inherits it. Logged as an
out-of-scope follow-up — see "Follow-ups".)

The **Availability grid** — the user's source of truth, which displays correctly —
does it right, and is what the RPC must match: it **trusts the stored
`day_of_week`** and converts only the **time-of-day**, never recomputing the day.
So:

```
-- Convert a stored UTC-clock TIME to local time-of-day, anchored to local day D.
-- The date part may roll; ::time discards it (exactly what the grid does).
local_start_tod := (((D + start_utc)::timestamp AT TIME ZONE 'UTC') AT TIME ZONE v_tz)::time;
local_end_tod   := (((D + end_utc)::timestamp   AT TIME ZONE 'UTC') AT TIME ZONE v_tz)::time;

-- Build the concrete local window on day D. A LOCAL overnight window
-- (local_end_tod <= local_start_tod) ends on D+1.
window_start_ts := D + local_start_tod;
window_end_ts   := D + local_end_tod + (CASE WHEN local_end_tod <= local_start_tod
                                             THEN INTERVAL '1 day' ELSE INTERVAL '0' END);
```

Because `local_start_tod` is always a time-of-day in `[00:00, 24:00)`, a window
occupies day **D** and, if locally overnight, spills into **D+1** — it can never
spill backward onto D−1. Therefore the candidate set for a shift on local date `X`
is exactly:

- recurring/exception rows filed under `day_of_week = DOW(X)`, anchored at `X`; **plus**
- recurring rows filed under `day_of_week = DOW(X − 1)` whose converted window is
  locally overnight (`local_end_tod <= local_start_tod`), anchored at `X − 1` (their
  window spills into the morning of `X`).

Containment is tested on concrete local `timestamp`s, so a 6 PM → 2 AM window is
`[X 18:00, X+1 02:00]` and overnight "just works." This trusts the stored weekday
and converts only the clock, so the RPC and the grid stay consistent by
construction (including the documented ±1h DST-boundary edge, which both share).
There is **no** `zoned.getDay()`-style day recomputation and **no** forward/backward
anchor guessing.

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

### Shared color/aria helper (new — kills triplication)

Extract into `src/lib/effectiveAvailability.ts`:

- `availabilityColorClasses(effective): { bg: string; text: string }` returning the
  **exact** semantic treatment used by `TeamAvailabilityGrid.AvailabilityCell` so the
  grid, the sidebar strip, and the timeline bar can't drift:
  - available (recurring or exception) → emerald
  - **exception-unavailable → amber** (`type === 'exception' && !isAvailable`) —
    matches the grid; the first draft wrongly collapsed this into red
  - recurring-unavailable → red (with the hatch below)
  - not-set → neutral `bg-muted/30`
- `availabilityLabel(effective, timezone, date): string` producing the localized text
  ("Available 2:00 PM – 10:30 PM" / "Unavailable" / "No availability set"), reusing
  `utcTimeToLocalTime(time, timezone, date)`.
- `TeamAvailabilityGrid.AvailabilityCell` is refactored to consume these helpers too,
  so "consistent by construction" covers rendering, not just data.

The red-unavailable **hatch** is a `repeating-linear-gradient` referencing a semantic
color at low alpha (e.g. `hsl(var(--destructive) / 0.12)`), not a hex — so Phase 7a
has something concrete to check.

### 3a. `ShiftPlannerTab` wiring

- Already calls `useEmployeeAvailability(restaurantId)`. Add
  `useAvailabilityExceptions(restaurantId)`.
- `useMemo` an effective-availability map for the planner's `weekStart` over the
  visible employees, keyed `employeeId → Map<dow, EffectiveAvailability>`. Single
  `useMemo` so the `Map` identity is stable across renders (avoids invalidating
  memoized rows spuriously).
- Thread `restaurantTimezone` (already at `ShiftPlannerTab.tsx:199`) and a per-cell
  concrete `Date` (not just `weekDays: string[]`) through `ShiftPlannerTab →
  EmployeeSidebar → DraggableEmployee → EmployeeMiniWeek`, so the DST-correct
  conversion anchors on the cell's date (mirrors `AvailabilityCell`'s `date` prop).
  Added to `EmployeeSidebarProps` explicitly.
- Pass each employee's availability slice into the sidebar, and (for 3c) into the
  timeline model so each bar knows its employee's effective availability.

### 3b. `EmployeeMiniWeek` (sidebar strip) — primary surface

- Behind each day's shift bars, paint the tint from `availabilityColorClasses`.
- **Accessibility (revised per review — no 7-tab-stop explosion):** keep individual
  day cells non-focusable (`aria-hidden`); expose **one** focusable, SR-visible
  summary per employee row — a single `aria-label` on the whole strip summarizing the
  week ("Availability — Mon 2:00–10:30 PM, Tue off, Wed not set, …"), optionally in a
  single shadcn `Tooltip`. Gives keyboard/AT/touch users the info without ~7 tab
  stops per employee (≈280 on a 40-person roster). Per-day drill-down already lives
  in `TeamAvailabilityGrid`; the strip stays a glanceable summary.
- Component stays memoized; the availability slice + timezone + dates are precomputed
  in the parent and passed as props (no hooks inside the memoized row).
- **`DraggableEmployee` memo comparator** (`EmployeeSidebar.tsx:151-161`) enumerates
  props explicitly — the new `availabilityByDow` (+ timezone/dates) prop **must** be
  added to the comparator, or a real availability edit won't invalidate the row.
- Roster virtualization out of scope (typical rosters < 100, CLAUDE.md threshold);
  noted so the 7×-per-row DOM growth is a conscious, bounded choice.

### 3c. Timeline — outside-availability marker on shift **bars** (revised per review)

The timeline groups bars by area/position, **not** by employee (`buildLanes` in
`src/lib/timelineModel.ts`), so there is no per-employee lane to tint. Instead the
per-employee treatment goes on each **`TimelineBar`**, which carries one
`shift.employee_id`:

- Compute, per bar, whether the shift falls **outside** its employee's effective
  availability for that local day — reusing the same effective slice and the same
  local-window predicate as the fixed RPC (a small shared predicate so the bar marker
  and the drag-commit dialog never disagree).
- When outside, render a warning treatment (amber left border / stripe) with an
  `aria-label` suffix ("… — outside availability"). It updates live as a bar is
  dragged/resized (`useTimelineBarDrag`) — the timeline's analog of "see availability
  before you commit."
- Available/normal bars unchanged; marker low-contrast so bars stay legible in light
  and dark (validated in Phase 5).

## Testing

### pgTAP (`supabase/tests/`)

Extend the existing suites (`availability_conflict_utc.sql`,
`availability_overnight.sql`, `availability_conflict_structured.sql`) and add
timezone regressions. Deterministic fixtures — RLS disabled in-txn,
delete-before-insert in FK order, `ON CONFLICT DO UPDATE` (lesson 2026-04-22). Set
the fixture restaurant's `timezone` explicitly per case.

**Date strategy (corrected from Phase 2.5 review).** The reviewed draft said "dates
relative to `CURRENT_DATE`," but lesson 2026-04-21 was about a *future-filtering*
function; `check_availability_conflict` does **no** date filtering, so that lesson
does not apply here — and `CURRENT_DATE`-relative dates would make a hand-computed
UTC-clock fixture silently wrong for the months the resolved date lands in the other
DST regime. Therefore: use **fixed absolute dates** (a fixed date's DST status never
changes), like the existing suites, AND **derive the stored UTC-clock value from the
intended local time via inline SQL** rather than hand arithmetic, e.g.

```sql
-- stored UTC clock for "2:00 PM local on 2027-07-13 in America/New_York"
(( '2027-07-13 14:00'::timestamp AT TIME ZONE 'America/New_York') AT TIME ZONE 'UTC')::time
```

so each fixture is internally DST-correct regardless of when CI runs. Pick one
summer (EDT) and one winter (EST) fixed date so both offsets are exercised.

- **Non-UTC regression (the reported bug):** restaurant `America/New_York`,
  recurring Tuesday available 2:00 PM–10:30 PM (stored as the corresponding UTC
  clock), employee marked unavailable Wednesday. A Tuesday-evening shift must return
  **no conflict** (previously returned the false "not available on this day").
- **Late-local-start (the backward-rollover regression — the review's critical
  find):** `America/Los_Angeles`, recurring available **6:00 PM–7:00 PM local**
  (start converts to a next-UTC-day clock). A same-day 6:00–7:00 PM shift must return
  **no conflict**. This case would have FAILED the first-draft `convertOne`-mirroring
  formula; it pins the grid-consistent time-of-day approach. Include a summer and a
  winter fixed date.
- **Partial outside-window:** same setup, Tuesday shift 11:00 AM–1:00 PM → conflict
  `recurring` with `available_start`/`available_end` = the stored UTC window.
- **Overnight local window:** available 6:00 PM–2:00 AM local; a 10:00 PM–1:00 AM
  shift → no conflict; a 3:00 AM shift → conflict; and an **early-morning shift
  covered only by the prior-day overnight window** returns that window in
  `available_start`/`available_end` (pins the nearest-window fix).
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
- `src/lib/effectiveAvailability.ts` — add `availabilityColorClasses` +
  `availabilityLabel` shared helpers; add a small "shift outside effective
  availability" predicate reused by the timeline bar marker.
- `src/components/scheduling/TeamAvailabilityGrid.tsx` — refactor `AvailabilityCell`
  to consume the shared color/label helpers (no visual change).
- `src/components/scheduling/ShiftPlanner/ShiftPlannerTab.tsx` — add
  `useAvailabilityExceptions`, memoize the effective map, thread timezone + dates.
- `src/components/scheduling/ShiftPlanner/EmployeeSidebar.tsx` — new
  `availabilityByDow`/`timezone`/`dates` props (+ update `DraggableEmployee` memo
  comparator).
- `src/components/scheduling/ShiftPlanner/EmployeeMiniWeek.tsx` — availability tint +
  single strip-level aria summary.
- `src/components/scheduling/ShiftTimeline/ShiftTimelineTab.tsx`,
  `TimelineBar.tsx`, `useTimelineModel.ts`/`timelineModel.ts` — per-bar
  outside-availability marker (thread the effective map to bars).
- `tests/unit/effectiveAvailability.test.ts`, `conflictFormatUtils.test.ts` (extend);
  new focused test for the shared color/label helpers if warranted.
- Reference only (unchanged): `src/lib/conflictFormatUtils.ts`,
  `src/hooks/useConflictDetection.tsx`, `src/lib/availabilityTimeUtils.ts`,
  `supabase/functions/_shared/availability-tz.ts`

## Follow-ups (out of scope, logged)

- **`availability-tz.ts` evening-Pacific day-shift:** `convertOne` recomputes the
  local weekday from the converted instant, so an evening window whose local start
  rolls to the next UTC day is placed on the *previous* local day — disagreeing with
  the grid (and now with the fixed RPC). The AI scheduler inherits this. File a
  separate PR to make `availability-tz.ts` trust the stored `day_of_week` and convert
  time-of-day only, matching the grid.
- **Split-window exceptions:** the RPC's exception lookup keeps `LIMIT 1`; multiple
  same-date exception slots aren't fully modeled. Revisit if/when exceptions gain
  multi-slot UI.

## Risks

- **plpgsql timezone math** is the exact class of subtle bug the codebase has been
  bitten by. Mitigation: mirror the **grid's** semantics (trust stored
  `day_of_week`, convert time-of-day only), compare concrete
  local `timestamp`s (not time-of-day), and pin behavior with the pgTAP tz suite
  above.
- **DST ±1h edge:** stored UTC-clock times are anchored to the writer's "today"
  offset. The RPC anchors conversions to the evaluated date, matching the grid, so
  both are consistent; the residual ±1h at a DST transition is the documented,
  pre-existing schema limitation, not a regression.
- **Timeline overlay contrast:** must not compete with shift bars; keep low opacity
  and validate in Phase 5 UI review (light + dark).
