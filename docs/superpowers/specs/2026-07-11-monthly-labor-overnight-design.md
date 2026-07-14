# Design: Monthly labor cost — overnight-shift attribution

**Date:** 2026-07-11
**Branch:** `fix/monthly-labor-overnight`
**Type:** Bug fix (labor-cost / wage accuracy)

## Problem

`calculateActualLaborCostForMonth` (`src/services/laborCalculations.ts`) —
which feeds the Dashboard "Monthly Performance" labor cost via
`useMonthlyMetrics` — **drops the hours of overnight shifts that cross an
ISO-week boundary**, understating monthly labor cost (real wages).

This function was deliberately left unfixed by PR #599 (the window filter was
made opt-in so this noon-anchored caller wasn't disturbed) and flagged as a
follow-up because it's DST-sensitive (see `memory/lessons.md` PR #485: a
$2,246 TZ swing lived in this exact code).

### Root cause

The hourly branch buckets **each punch by its own `startOfWeek`**:
```ts
for (const p of employeePunches) {
  const weekStart = startOfWeek(new Date(p.punch_time), { weekStartsOn: WEEK_STARTS_ON });
  // → punchesByWeek[weekKey].push(p)
}
```
For an overnight shift Sun 20:00 → Mon 02:00, the clock-in (Sunday, week A) and
the clock-out (Monday, week B) land in **different** week buckets.
`parseWorkPeriods` then runs per bucket and sees a lone clock-in in A and a lone
clock-out in B → **no work period in either** → the shift's hours are dropped
from the weekly wage and the monthly total.

Two related gaps:
- **Month boundary:** `useMonthlyMetrics` fetches `time_punches` with a hard
  `.gte(dateFrom).lte(dateTo)` (no buffer), so a shift clocking out on the 1st
  of the next month has its clock-out excluded entirely.
- **Break after midnight:** the per-day pay distribution keys off
  `period.startTime`; a post-break segment starts the next day, so its hours
  (and month-clip) attribute to the wrong day.

## Approach

Attribute a shift to its **clock-in week / clock-in day**, consistent with #599.

### 1. Bucket punches by the shift's clock-in week (core fix)
Replace the per-punch `startOfWeek` bucketing with a single pass that assigns
**every punch of a shift** (clock_in, any breaks, clock_out) to the week of the
shift's **clock-in**:
```ts
let currentWeekKey: string | null = null;
for (const p of sortedPunches) {
  if (p.punch_type === 'clock_in') {
    currentWeekKey = weekKeyFor(new Date(p.punch_time)); // open shift → clock-in week
  }
  const wk = currentWeekKey ?? weekKeyFor(new Date(p.punch_time)); // orphan → own week
  bucket(wk).push(p);
  if (p.punch_type === 'clock_out') currentWeekKey = null; // shift closed
}
```
A same-week shift is bucketed exactly as before (no behavior change); only a
shift whose clock-out falls in a later week now stays with its clock-in week, so
`parseWorkPeriods` inside `calculateEmployeePay(weekPunches, …)` pairs it whole.
The noon-anchored `weekStart`/`weekEnd` passed downstream are unchanged (for
hourly they only gate `calculateEmployeePay`'s already-off window filter; OT
banding re-derives weeks internally), so the DST behavior lessons.md warns about
is preserved.

### 2. Distribute/clip by clock-in day
In the per-day distribution loop, key the day by the period's **clock-in**
(`period.clockIn ?? period.startTime`, the field #599 added) instead of
`startTime`, so a break-after-midnight segment's hours attribute to the clock-in
day for both the proportional split and the `[monthStart, monthEnd]` clip.

### 3. Look-ahead buffer the fetch (`useMonthlyMetrics`)
Widen the `time_punches` fetch to `dateTo + OVERNIGHT_BUFFER_HOURS` (look-ahead
only, matching the dashboard/AI-tool pattern from #599) so a shift crossing the
month-end boundary has its clock-out available. The month-clip
(`dayDate <= monthEnd`, by clock-in day) already drops out-of-month shifts, so
look-ahead-only is safe and no look-back is needed. Reuse
`lookaheadPunchFetchRange` from `src/utils/punchWindow.ts`.

## Not changing / out of scope
- `calculateEmployeePay`'s internal OT weekly-banding keys off `period.startTime`
  (not `clockIn`), so a break-after-midnight overnight shift that also crosses a
  week boundary bands its pre/post-midnight hours into two OT weeks. This is a
  pre-existing behavior of the shared engine (affects payroll identically, not
  introduced here) and a compound rare case; deferred, noted here.
- The noon-anchor DST workaround stays. We are NOT switching to true midnight
  bounds (that's the risk lessons.md PR #485 documents).
- No DB/RLS/schema/edge-function change (only a client query range widens).

## Testing
- **Unit** (`laborCalculations.calculateActualLaborCostForMonth.test.ts`):
  - Sun→Mon overnight shift crossing an ISO-week boundary **within a month** →
    hours counted once (currently dropped). The headline regression.
  - Same-day and the existing "OT straddles month boundary" case → unchanged
    (they have no cross-week shifts, so identical output — pins no regression).
  - Break-after-midnight overnight shift → hours attributed to the clock-in day.
  - Month-end crossing (with buffered punches supplied) → counted in the
    clock-in month, not double-counted in the next.
- **Hook** (`useMonthlyMetrics` fetch-range test, mirroring
  `useLaborCostsFromTimeTracking.fetchRange.test.ts`): asserts look-ahead-only
  widening (start unchanged, end +18h).
- Full unit suite stays green; run the labor suite under `TZ=America/Chicago`
  and UTC (DST-portability per lessons.md).
