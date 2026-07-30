# Configurable per-restaurant business-day cutoff

**Date:** 2026-07-29
**Branch:** `feature/business-day-cutoff`
**Status:** design, pending Phase 2.5 review

---

## 1. What was asked for

A per-restaurant business-day start/cutoff so that an overnight shift is attributed to
the day the employee clocked **in**, not the calendar day they clocked out. The
reporting restaurant wants a ~2 AM boundary; other restaurants differ, so it must be
configuration, not a constant.

## 2. Premise check — three claims in the brief that the code does not support

Phase 2 requires every claim about existing code to carry a `file:line` citation.
Three premises in the brief did not survive that check, and the design changes shape
as a result.

### 2.1 `toBusinessDay()` does not exist

The brief designates `toBusinessDay()` — from an in-flight `useRestaurantClock()`
effort — as "the designated single seam for this feature," and instructs building on
it if that work has landed.

It has not landed. `grep -rn "toBusinessDay\|useRestaurantClock\|safeTz" src/` returns
nothing on `origin/main` at `4e293abc`. What does exist:

- [`src/lib/timezone.ts`](../../../src/lib/timezone.ts) — `formatDateInTimezone`,
  `getTodayInTimezone`, `isDateInTimezone`. Display-oriented, no cutoff concept, no
  `safeTz` validator.
- [`src/lib/dateOnly.ts`](../../../src/lib/dateOnly.ts) — `parseDateOnly` /
  `toDateOnlyString` / `formatDateOnly`, the established calendar-day-token helpers.
  `toDateOnlyString` is exactly the local-fields serialization the 2026-07-28 lessons
  entry prescribes for `DATE` columns.

**Decision:** build the seam here as `src/lib/businessDay.ts`, reusing
`toDateOnlyString` for serialization. It is written so a later `useRestaurantClock()`
can wrap it rather than duplicate it: pure function, explicit `(instant, tz,
cutoffHour)` signature, no hook dependency, no context access.

### 2.2 There is almost no server-side punch→business-day bucketing to route through

The brief asks to "audit every RPC/view deriving a business day from
`time_punches.punch_time`, `shifts.start_time`, or `unified_sales.sold_at` and route
them through it."

Full sweep of `supabase/migrations` + `supabase/functions` for a `punch_time` cast or
truncation to a date returns exactly two sites, neither of which is a payroll or
reporting bucket:

| Site | What it does | Route through helper? |
|---|---|---|
| [`20251209000000_add_employee_activation_tracking.sql:44`](../../../supabase/migrations/20251209000000_add_employee_activation_tracking.sql) | `MAX(DATE(punch_time))` → `last_active_date` on deactivation | **No.** Audit metadata, not money. Session-TimeZone-framed, so arguably wrong, but changing it moves a displayed "last active" date for no payroll benefit. Tracked as a follow-up, §9. |
| [`20260223100100_sling_sync_rpc.sql:108`](../../../supabase/migrations/20260223100100_sling_sync_rpc.sql) | `st.punch_time::DATE BETWEEN v_start AND v_end` | **No.** An import range filter on staged Sling rows, not an attribution bucket. |

`calculate_worked_hours`
([`20251115165031_…sql:297`](../../../supabase/migrations/20251115165031_3275bc7c-bc33-4b20-b42c-fd1a9c022d07.sql))
pairs punches with `LEAD(tp.punch_time) OVER (ORDER BY tp.punch_time)` and filters
`WHERE tp.punch_time BETWEEN p_start_date AND p_end_date`. It returns period totals
with **no per-day bucketing at all** — nothing to route.

`daily_labor_costs` is not fed from punches. It aggregates `public.square_shifts WHERE
service_date = p_service_date AND status = 'CLOSED'`
([`20250929212801_…sql`](../../../supabase/migrations/20250929212801_5e70703f-586d-4149-bf21-3c84e38e9c48.sql)),
i.e. a POS-supplied service date. Out of scope: rebucketing a vendor's service date is
a different feature with a different correctness argument.

**Consequence:** the punch→business-day mapping lives *in the client*, and the SQL
helper has no production consumer on day one. It is still built, because (a) the
brief's requirement that SQL be authoritative and TS be preview only means something
if the SQL exists to be the reference, (b) pgTAP is the cheapest place to pin the DST
and cutoff semantics, and (c) it is the landing pad for the follow-ups in §9. This is
stated plainly rather than dressed up as routing work.

### 2.3 Overnight hours are **not** currently split across midnight

The brief's motivation says post-midnight hours "get attributed to the NEXT day,
splitting a single shift across two business days."

They do not. `parseWorkPeriods` emits one `WorkPeriod` per clock-in→clock-out pair with
`startTime` = the clock-in and `hours` = the whole span
([`payrollCalculations.ts:170-186`](../../../src/utils/payrollCalculations.ts)). Every
consumer keys that period off a timestamp inside its **first** segment. A 6 PM → 3 AM
shift therefore already lands its full 9 hours on the clock-in day, in both the
payroll path and the dashboard path.

The real defects are different, and the split is live-vs-latent. See §3.

## 3. Evidence: what is actually broken, and for whom

All figures from production (`ncdujvdgqtaunuyigflp`), read-only, 2026-07-29. No row
data is reproduced here — aggregates only.

### 3.1 Population

| | value |
|---|---|
| Restaurants with a populated `timezone` | 35, zero null/empty, 5 distinct IANA zones |
| Employees by `compensation_type` | hourly 226 · salary 7 · `daily_rate` 4 · contractor 1 |
| Paired `clock_in → clock_out` shifts, hourly | 1,186 |
| …crossing local midnight | **54** (25 employees, 5 restaurants) |
| …of those, clocking out before 02:00 local | 46 |
| …of those, clocking out at/after 02:00 local | **8** |
| Punch-type inventory | `clock_in` 1,309 · `clock_out` 1,320 · `break_start` 12 · **`break_end` 0** |
| `overtime_rules` rows | 2, **neither** with `daily_threshold_hours` set |

Quality of the 54 overnight shifts, by duration:

| bucket | shifts | hours | note |
|---|---|---|---|
| ≤ 12h | 39 | 282.3 | plausible; 37 clock out before 02:00 |
| 12–24h | 10 | 151.7 | doubles or sloppy punches |
| > 24h | 5 | 1,068.1 | garbage — worst is 843h (≈35 days), a missing clock-out |

### 3.2 Live defect — the day key is in the **browser's** frame, not the restaurant's

`formatDateUTC` is misnamed; it reads local date fields
([`laborCalculations.ts:43-48`](../../../src/services/laborCalculations.ts)):

```ts
function formatDateUTC(date: Date): string {
  const year = date.getFullYear();          // ← browser-local, not UTC
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
```

`format(new Date(period.clockIn), 'yyyy-MM-dd')` in the payroll path
([`payrollCalculations.ts:492`](../../../src/utils/payrollCalculations.ts)) is likewise
browser-local.

So a manager in `America/New_York` viewing an `America/Chicago` restaurant buckets a
23:00 CT clock-in onto the following day; both the daily labor cost card and the
payroll day/week bands shift. 31 of 35 restaurants are `America/Chicago`, and the
other four zones span `America/Los_Angeles` to `America/New_York`, so cross-zone
viewing is a real configuration, not a hypothetical. It is also invisible in CI, which
runs UTC — the exact trap the 2026-07-28 lessons entry documents.

This is the one defect that is live for every restaurant, independent of overnight
shifts.

### 3.3 Latent defect A — `daily_rate` double-charge on an overnight shift

Two independent sites charge a full daily rate per calendar day *touched*:

- Cost path: the day-span loop at
  [`laborCalculations.ts:580`](../../../src/services/laborCalculations.ts) adds the
  employee to `employeesActivePerDay` for every local day the period touches, and
  [`:624`](../../../src/services/laborCalculations.ts) charges
  `calculateEmployeeDailyCost(effectiveEmployee)` unconditionally on hours. Deliberate
  — the sibling function documents it at
  [`:713-717`](../../../src/services/laborCalculations.ts): "so an overnight period
  (start day → next day) is charged for both days."
- Payroll path: [`payrollCalculations.ts:553-568`](../../../src/utils/payrollCalculations.ts)
  counts distinct calendar dates of **raw punches** — not work periods — so one
  overnight shift yields `daysWorked = 2`.

Note the asymmetry with hourly, which is *not* affected: the extra day in
`employeesActivePerDay` contributes nothing for hourly because
[`:619`](../../../src/services/laborCalculations.ts) gates on `hoursWorked > 0`, and
`hoursPerEmployeePerDay` only ever has the clock-in day. `daily_rate` at
[`:624`](../../../src/services/laborCalculations.ts) has no such gate.

**Live impact today: $0.** 4 `daily_rate` employees across 3 restaurants, 14 paired
shifts all time, **0** crossing local midnight. Trigger: any one of those 4 working
past midnight.

### 3.4 Latent defect B — `startTime` vs `clockIn` divergence between siblings

Four functions bucket the same periods by different anchors:

| site | anchor |
|---|---|
| [`laborCalculations.ts:557`](../../../src/services/laborCalculations.ts) `calculateActualLaborCost` | `period.startTime` |
| [`laborCalculations.ts:726`](../../../src/services/laborCalculations.ts) `calculateHoursPerEmployee` | `period.startTime` |
| [`laborCalculations.ts:945`](../../../src/services/laborCalculations.ts) `calculateActualLaborCostForMonth` | `period.clockIn` |
| [`payrollCalculations.ts:492`](../../../src/utils/payrollCalculations.ts) hourly OT banding | `period.clockIn` |

They differ only when `handleBreakEnd` fires, which rewrites `currentClockIn.punch_time`
to the break-end and so advances the *segment* start while `shiftClockIn` stays pinned
([`payrollCalculations.ts:249-254`](../../../src/utils/payrollCalculations.ts),
[`:101-102`](../../../src/utils/payrollCalculations.ts)).

**Live impact today: $0**, because production contains **zero `break_end` punches** —
`handleBreakEnd` has never executed. But the writer paths exist
([`MobileTimeEntry.tsx:146-152`](../../../src/components/time-tracking/MobileTimeEntry.tsx),
[`ManualTimelineEditor.tsx:327-334`](../../../src/components/time-tracking/ManualTimelineEditor.tsx)),
so the first break-end on an overnight shift makes Dashboard and Payroll disagree —
and [`tests/unit/dashboard-payroll-consistency.test.ts`](../../../tests/unit/dashboard-payroll-consistency.test.ts)
exists precisely to forbid that.

### 3.5 The feature itself

Independent of all of the above: there is no cutoff concept, so a 01:00 clock-in at a
2 AM-cutoff restaurant is attributed to the calendar day it happened on rather than
the business day the restaurant considers it part of. That is not a bug — "business
day == calendar day" is the current, coherent definition. It is the thing being made
configurable.

## 4. Model

Two orthogonal rules that compose. Stated separately because conflating them is what
produces the split-shift outcome the brief was worried about.

**Rule 1 — the cutoff maps an instant to a business day.**

```
businessDay(instant, tz, cutoffHour) = ((instant AT TIME ZONE tz) - cutoffHour hours)::date
```

**Rule 2 — a shift's attribution anchor is its clock-in instant.** Not the clock-out,
not a post-break segment start. One shift → one anchor → one business day. A shift is
never split, at any cutoff.

Composition, worked, for `America/Chicago` and `cutoffHour = 2`:

| clock-in (local) | clock-out (local) | business day |
|---|---|---|
| Jul 28 18:00 | Jul 29 03:00 | Jul 28 — anchor 18:00, minus 2h → Jul 28 |
| Jul 29 01:00 | Jul 29 07:00 | **Jul 28** — anchor 01:00, minus 2h → Jul 28 |
| Jul 29 03:00 | Jul 29 11:00 | Jul 29 — anchor 03:00, minus 2h → Jul 29 |

Row 2 is why the cutoff is needed *in addition* to the anchor: anchoring alone would
put a 01:00 clock-in on Jul 29. Row 1 is why the anchor is needed *in addition* to the
cutoff: a cutoff applied to the clock-out would put those hours on Jul 29 — this is
the brief's §5 edge case, and it is exactly the 8 shifts in §3.1 that clock out at or
after 02:00. At `cutoffHour = 0` Rule 1 degenerates to "restaurant-local calendar
day," which is the current *intended* behavior with §3.2's frame bug corrected.

### 4.1 Why subtract after converting, not before

`(instant AT TIME ZONE tz) - interval` converts into naive-local timestamp space
first, then subtracts. Doing it the other way (`(instant - interval) AT TIME ZONE tz`)
is arithmetically equivalent on a `timestamptz` but reads as if the cutoff were a UTC
offset, and invites the DST mistake of constructing a local wall-clock time that does
not exist — 02:00–03:00 on spring-forward Sunday. Because we only ever *subtract from*
a real instant and never *construct* a local time, the nonexistent-hour case cannot
arise. §8 pins this with tests on both DST transitions.

### 4.2 Cutoff range

`0 ≤ cutoffHour ≤ 11`. Above 12 the mapping is indistinguishable from shifting the
whole calendar by a day, which is a different (and unwanted) feature. 11 is generous
headroom over the plausible 2–6 AM range.

## 5. Schema

```sql
ALTER TABLE public.restaurants
  ADD COLUMN business_day_start_hour SMALLINT NOT NULL DEFAULT 0;

ALTER TABLE public.restaurants
  ADD CONSTRAINT restaurants_business_day_start_hour_range
  CHECK (business_day_start_hour BETWEEN 0 AND 11);
```

**Why `SMALLINT` and not `TIME` or `INTERVAL`.** The cutoff is a whole hour in every
real scenario; `TIME` would admit `02:17:33` and force every consumer to decide what a
sub-hour cutoff means for a `DATE` bucket. `INTERVAL` additionally admits `1 mon` and
negative values, which the CHECK would have to re-forbid awkwardly. `SMALLINT` makes
the domain exactly the set of legal values, is trivially comparable in both SQL and
TS, and serializes over PostgREST as a number with no parsing.

**Why `NOT NULL DEFAULT 0` and no separate backfill.** `DEFAULT 0` *is* the backfill —
Postgres 11+ materializes a non-volatile default without a table rewrite, so all 35
existing rows read `0` immediately. `0` reproduces "business day == calendar day",
which is today's definition, so no restaurant's cutoff semantics change on deploy.
`NOT NULL` means no consumer needs a `COALESCE`, removing the class of bug where one
call site defaults a null differently from another.

**RLS:** none needed. `restaurants` already has policies; adding a column inherits
them. Precedent for a per-restaurant payroll knob:
[`20260221200000_create_overtime_rules.sql`](../../../supabase/migrations/20260221200000_create_overtime_rules.sql).
That table is `UNIQUE (restaurant_id)` with its own RLS via `user_restaurants` — a
separate table was right there because overtime has ~7 correlated fields. One integer
does not justify a table.

**Generated types:** `src/integrations/supabase/types.ts` must be regenerated; the
`restaurants` Row/Insert/Update at
[`types.ts:5689`](../../../src/integrations/supabase/types.ts) gains
`business_day_start_hour: number`. Note `timezone` is typed `string | null` there
despite prod having zero nulls, so TS consumers must still handle null — see §7.

## 6. SQL helper

```sql
CREATE OR REPLACE FUNCTION public.business_day(
  p_instant     TIMESTAMPTZ,
  p_restaurant_id UUID
) RETURNS DATE
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tz   TEXT;
  v_hour SMALLINT;
BEGIN
  IF p_instant IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT r.timezone, r.business_day_start_hour
    INTO v_tz, v_hour
  FROM public.restaurants r
  WHERE r.id = p_restaurant_id;

  -- Covers a NULL timezone, an empty string, and no-such-restaurant (where
  -- SELECT ... INTO leaves both OUT variables NULL).
  v_tz   := COALESCE(NULLIF(v_tz, ''), 'UTC');
  v_hour := COALESCE(v_hour, 0);

  -- An invalid IANA string raises invalid_parameter_value (22023) on first use.
  -- Probe once with a throwaway expression: the error depends only on the zone
  -- string, not on the timestamptz being converted. Reassigning v_tz itself is
  -- what makes the reference below safe.
  BEGIN
    PERFORM now() AT TIME ZONE v_tz;
  EXCEPTION WHEN invalid_parameter_value THEN
    v_tz := 'UTC';
  END;

  RETURN ((p_instant AT TIME ZONE v_tz) - make_interval(hours => v_hour))::date;
END;
$$;
```

Notes on the choices, each following an established pattern in this repo rather than
inventing one:

- **The `v_tz` resolve-then-probe block is copied verbatim in structure** from
  [`20260729120000_publish_schedule_tz_bucketing.sql:73-91`](../../../supabase/migrations/20260729120000_publish_schedule_tz_bucketing.sql),
  which landed yesterday as `4e293abc`. Deliberately not `pg_timezone_names` — the
  2026-07-23 lessons entry measures that at ~49ms per call (≈1,200-row catalog scan)
  versus ~0.4ms for the exception probe. And per the 2026-07-24 entry, the fallback
  reassigns **`v_tz` itself**, the widest-scoped variable, not a local that threw.
- **`STABLE`, not `IMMUTABLE`.** It reads `restaurants`. `IMMUTABLE` would license the
  planner to fold a stale value and would make the function illegal to use in a
  generated column or index — which is fine, because we do not.
- **`SECURITY INVOKER`.** The function needs no elevation: `restaurants` rows are
  already readable by any member via existing RLS, and `SECURITY DEFINER` here would
  create a cross-tenant read oracle for `timezone` and the cutoff. This is the
  opposite call from `publish_schedule`, which mutates and therefore needs DEFINER
  plus an in-body identity check.
- **A per-call `SELECT` is accepted** because there is no bulk consumer (§2.2). Should
  one appear, the sibling to add is a set-returning or two-arg
  `business_day(p_instant, p_tz, p_hour)` overload that the caller feeds from a single
  join — noted in §9 rather than speculatively built.
- **Grants:** `REVOKE ALL ... FROM PUBLIC, anon; GRANT EXECUTE TO authenticated,
  service_role.` Template:
  [`20260723170000_link_invited_employee.sql:165-166`](../../../supabase/migrations/20260723170000_link_invited_employee.sql).
  Cheap, and the Phase 2.5 review of `4e293abc` flagged a missing grant boundary as
  critical on functions that had never had one.

## 7. TypeScript helper

New file `src/lib/businessDay.ts`. Pure, no hook, no context — so a future
`useRestaurantClock()` wraps rather than reimplements.

```ts
import { toZonedTime } from 'date-fns-tz';
import { toDateOnlyString } from '@/lib/dateOnly';

export const DEFAULT_BUSINESS_DAY_START_HOUR = 0;
export const MAX_BUSINESS_DAY_START_HOUR = 11;

/** Falls back to UTC for a null/empty/invalid IANA zone, mirroring the SQL probe. */
export function safeTz(tz: string | null | undefined): string { /* … */ }

/** Clamps to [0, 11] and coerces null/NaN to 0, mirroring the SQL COALESCE + CHECK. */
export function safeCutoffHour(hour: number | null | undefined): number { /* … */ }

/**
 * Map an instant to its business day, as a YYYY-MM-DD calendar-day token.
 *
 * Returns a STRING, not a Date. A Date would be a local-midnight calendar-day
 * token, and the 2026-07-28 lessons entry documents the production incident that
 * follows from one of those meeting `.toISOString()`. Callers that need a Date
 * for date-fns go through parseDateOnly().
 */
export function toBusinessDay(
  instant: Date | string,
  tz: string | null | undefined,
  cutoffHour: number | null | undefined,
): string {
  const zoned = toZonedTime(typeof instant === 'string' ? new Date(instant) : instant, safeTz(tz));
  zoned.setHours(zoned.getHours() - safeCutoffHour(cutoffHour));
  return toDateOnlyString(zoned);
}
```

Correspondence to the SQL, term by term: `toZonedTime` is `AT TIME ZONE v_tz` (both
produce a naive local wall-clock representation); `setHours(getHours() - h)` is
`- make_interval(hours => h)`; `toDateOnlyString` is `::date`. `safeTz` and
`safeCutoffHour` are `COALESCE(NULLIF(...))` plus the exception probe and the CHECK
respectively. Per CLAUDE.md the SQL is authoritative and this is preview — §8.6 pins
them to one shared fixture table so "identical results" is asserted, not asserted-to.

**Returning a string is the load-bearing decision.** `toBusinessDay` is a
calendar-day producer, and the 2026-07-28 lessons entry is about a local-midnight
`Date` reaching `.toISOString().split('T')[0]` and losing a day — 44
`schedule_publications` rows across 9 restaurants got an 8-day Mon→Mon span. A `string`
return makes that mistake unrepresentable at this boundary. Note this is a deliberate
divergence from the brief's sketched `toBusinessDay()` shape.

**Sourcing tz and cutoff in the client.** Both live on `restaurants`, already loaded
via `useRestaurantContext()`. `laborCalculations.ts` and `payrollCalculations.ts` are
pure modules with no context access, so the values are threaded as parameters from the
hooks that call them —
[`useLaborCostsFromTimeTracking.tsx:134`](../../../src/hooks/useLaborCostsFromTimeTracking.tsx),
[`usePayroll.tsx:139`](../../../src/hooks/usePayroll.tsx),
[`useMonthlyMetrics.tsx:385`](../../../src/hooks/useMonthlyMetrics.tsx). Both must join
the React Query keys, or a cutoff change will serve a stale bucketing for up to the
30s `staleTime`.

## 8. Consumer changes

### 8.1 Route the day keys through the helper

| file:line | function | change |
|---|---|---|
| [`laborCalculations.ts:557`](../../../src/services/laborCalculations.ts) | `calculateActualLaborCost` | `formatDateUTC(period.startTime)` → `toBusinessDay(period.clockIn, tz, cutoff)`. Fixes the frame **and** the anchor divergence (§3.4). |
| [`laborCalculations.ts:580-581`](../../../src/services/laborCalculations.ts) | `calculateActualLaborCost` | Replace the calendar-day-span loop with the single business day of `period.clockIn`. This is the §3.3 `daily_rate` fix. |
| [`laborCalculations.ts:726`](../../../src/services/laborCalculations.ts) | `calculateHoursPerEmployee` | same as `:557` |
| [`laborCalculations.ts:730-735`](../../../src/services/laborCalculations.ts) | `calculateHoursPerEmployee` | same as `:580` |
| [`laborCalculations.ts:945`](../../../src/services/laborCalculations.ts) | `calculateActualLaborCostForMonth` | `formatDateUTC(period.clockIn ?? period.startTime)` → `toBusinessDay(...)`. Anchor already right; frame is not. |
| [`laborCalculations.ts:405`](../../../src/services/laborCalculations.ts) | `calculateScheduledLaborCost` | `formatDateUTC(shift.start_time)` → `toBusinessDay(...)`. Scheduled cost must bucket the same way as actual or the variance view compares two frames. |
| [`payrollCalculations.ts:492`](../../../src/utils/payrollCalculations.ts) | hourly OT banding | `format(period.clockIn, 'yyyy-MM-dd')` → `toBusinessDay(...)`. Anchor already right; frame is not. Moves daily **and** weekly OT bands. |
| [`payrollCalculations.ts:558`](../../../src/utils/payrollCalculations.ts) | `daily_rate` | Stop counting raw punch dates. Count distinct business days of **work-period clock-ins**, via `parseWorkPeriods`. This is the §3.3 payroll-side fix. |

`formatDateUTC` is then either deleted or renamed. It is misnamed today
([`:43`](../../../src/services/laborCalculations.ts)) and every remaining caller is a
`generateDateRange` / cursor-walk over already-bucketed day strings
([`:68`](../../../src/services/laborCalculations.ts)) where local fields are correct.
Rename to `formatLocalDate` and add a one-line comment; do not leave a function whose
name asserts the opposite of what it does.

### 8.2 Explicitly not changed

- `parseWorkPeriods` and the whole pairing/anomaly machine. It is instant-based and
  frame-free. Touching it would put every hour total at risk for zero benefit.
- Punch **write** paths (`EmployeeClock`, `KioskMode`, `MobileTimeEntry`,
  `ManualTimelineEditor`, `timePunchImport`). All write `.toISOString()` of a real
  instant, which is correct for `timestamptz` and unaffected by business days.
- Punch **fetch** windows (`lookaheadPunchFetchRange`, the `.gte/.lte` bounds in
  `usePayroll`/`useLaborCostsFromTimeTracking`/`useMonthlyMetrics`). Instant ranges,
  already generous. §10 flags one interaction to verify.
- Display-only formatting of individual punch times (`TimePunchesManager`,
  `EmployeeTimecard`, `PunchStreamView`, `EmployeeClock`). Showing a punch at its
  wall-clock time is a separate concern and belongs to the parallel timezone effort.
- `daily_labor_costs` / `daily_pnl` / `unified_sales`. Fed from POS service dates
  (§2.2), not punches.
- `unified_sales.sold_at` bucketing, named in the brief. No punch-derived business day
  passes through it; rebucketing revenue is a larger change that would move P&L for
  all 35 restaurants and needs its own risk argument.

### 8.3 Settings UI

Payroll tab, [`RestaurantSettings.tsx:935`](../../../src/pages/RestaurantSettings.tsx).
The cutoff is payroll configuration and belongs beside the other per-restaurant money
rule, not next to the display timezone on the General tab
([`:651-660`](../../../src/pages/RestaurantSettings.tsx)).

That `TabsContent` is currently a single `Card` titled "Overtime Rules"
([`:936-945`](../../../src/pages/RestaurantSettings.tsx)), so the cutoff goes in its
**own** `Card` above it rather than inside — a business-day boundary is not an
overtime rule, and filing it under that heading would be a lie in the information
architecture.

It also needs its own save handler: `business_day_start_hour` is on `restaurants`,
whereas `handleSaveOtRules` ([`:294-349`](../../../src/pages/RestaurantSettings.tsx))
upserts `overtime_rules`. Follow the `restaurants`-update shape at
[`:391-392`](../../../src/pages/RestaurantSettings.tsx).

Control: a `Select` of the 12 legal hours rendered as wall-clock labels
("12:00 AM (midnight)" … "11:00 AM"), not a numeric `Input`. The domain is small and
closed, a free-text number invites `2` meaning 2 PM, and a `Select` cannot produce a
value the CHECK constraint would reject. Styling per CLAUDE.md and the adjacent
fields — `h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg`, label
`text-[12px] font-medium text-muted-foreground uppercase tracking-wider`, section
wrapper `rounded-xl border border-border/40 bg-muted/30 overflow-hidden`.

Copy must state the consequence, because this control silently moves money:
> Shifts that start before this hour are counted toward the previous business day.
> Changing this re-buckets historical labor cost and payroll reports.

Accessibility: `htmlFor`/`id` pairing like the sibling fields, and the help text wired
via `aria-describedby`.

## 9. Follow-ups, tracked not silently dropped

1. `last_active_date` at
   [`20251209000000_…sql:44`](../../../supabase/migrations/20251209000000_add_employee_activation_tracking.sql)
   uses `DATE(punch_time)` in the DB session zone (UTC on Supabase). Wrong frame,
   audit-only impact. Deliberately excluded — it is not payroll and it changes a
   displayed date for 35 restaurants for no payroll gain.
2. No bulk/set-returning `business_day` overload. Justified by §2.2 — no bulk consumer
   exists. Add when one does.
3. `unified_sales.sold_at` business-day bucketing (§8.2). Named in the brief, out of
   scope here.
4. `restaurants.timezone` is `NOT NULL`-clean in prod but nullable in schema and types
   ([`types.ts:5689`](../../../src/integrations/supabase/types.ts)). Tightening it is a
   separate migration with its own backfill argument; `safeTz` covers us meanwhile.
5. The 5 overnight shifts >24h (§3.1), incl. one of 843h. Real data-quality defects
   surfaced by this investigation, already flagged as `incomplete_shifts` by
   `parseWorkPeriods` but evidently not acted on. Not this PR's job to clean, but
   worth someone's attention.

## 10. Risks

| risk | mitigation |
|---|---|
| The frame fix (§3.2) changes reported numbers at `cutoff = 0`, so "the default preserves today's behavior" is true of the *cutoff* but **not** of the browser-frame repair. | The golden-master (§11.2) carries an explicit, short allowlist of deliberately-changed cases, each with a hand-computed expected value. A golden master with a long allowlist is not a golden master. |
| Weekly OT band shifts. Moving a business day can move a shift between ISO weeks and cross the 40h band — the 2026-05-03 lessons entry records a $2,246 PT-vs-UTC swing from exactly this. 2 of the 54 overnight shifts clock in on Sunday (`WEEK_STARTS_ON = 1`, [`dateConfig.ts:8`](../../../src/lib/dateConfig.ts)). | §11.4 asserts **dollars**, not just hours, across four pinned zones. |
| Daily OT band shifts. Zero of the 2 `overtime_rules` rows set `daily_threshold_hours` today, so intra-week reassignment is currently dollar-neutral for hourly — but one settings change flips that. | §11.4 runs the suite with daily OT **enabled**, not just at the current prod config. |
| Cutoff changes silently re-bucket history. | §8.3 copy states it. Not versioning the cutoff is a conscious choice: an effective-dated cutoff is a much larger feature, and no restaurant has one to change yet. Called out here so it is a decision, not an oversight. |
| Stale bucketing after a cutoff change. | tz + cutoff join every affected React Query key (§7). |
| A worktree `db reset` from a sibling session drops the migration mid-test (2026-07-28 lessons). | Confirm the migration is still applied before believing a red local DB test. |
| `lookaheadPunchFetchRange` is look-ahead only, by design, so a prior-period shift is not pulled into the window. A nonzero cutoff moves the business-day boundary *later*, which is the same direction the look-ahead already covers. | Verify explicitly rather than assume; a cutoff at the window edge is a §11 case. |

## 11. Test plan

The user's bar: *"You must have e2e tests for this and must pass a strict payroll test
suite to call this complete. we can't be under/over paying people with this change."*
Seven parts plus E2E. Parts 1, 2, and 4 are the ones that actually protect paychecks.

### 11.1 Conservation invariant — the structural guarantee

For every fixture: `Σ hours across all business days == Σ period.hours from
parseWorkPeriods`, at every cutoff in 0..11, in every pinned zone. Bucketing may move
hours between days; it may never create or destroy one. This is the property that
makes under/overpayment structurally impossible rather than merely untested, and it is
the one test that must never be relaxed.

Same invariant on dollars for `daily_rate`: distinct business days == distinct shifts,
so N overnight shifts cost N daily rates, never 2N.

### 11.2 Golden master at `cutoff = 0`

Snapshot `calculateActualLaborCost`, `calculateActualLaborCostForMonth`,
`calculateHoursPerEmployee`, and `calculateEmployeePay` before the change; assert
byte-identical after, at `cutoff = 0`, **with the browser TZ pinned to each
restaurant's own zone** — that isolates the cutoff change from the frame change.

Then a second pass with the browser TZ *differing* from the restaurant zone, where the
frame repair (§3.2) legitimately changes output. Every difference goes in a named
allowlist with a hand-computed expected value and a one-line reason. Fixtures are
synthetic; per the standing rule, no production rows are copied into the repo.

### 11.3 Frame independence

`TZ=UTC`, `America/Chicago`, `America/New_York`, `Pacific/Auckland` — the same
fixtures must produce the same business days for a given restaurant zone regardless of
the process zone. Wired into
[`package.json:32`'s `test:tz`](../../../package.json) chain alongside the existing
`*.tz.test.ts` files. `Pacific/Auckland` is the sign-flip case that catches
east-of-UTC errors a US-only matrix misses.

### 11.4 Dollars, not just hours

Assert `grossPay`, `regularPay`, `overtimePay`, `doubleTimePay`, and `dailyRatePay` in
cents. Run each fixture at: no `overtime_rules` row; weekly-only (today's prod
config); weekly + daily; weekly + daily + double-time. Include a Sunday-clock-in
overnight shift, which is the week-boundary crossing that actually moves money
(`WEEK_STARTS_ON = 1`).

### 11.5 DST boundaries

`America/Chicago`, cutoff 2 — the pathological pairing, since 02:00 is exactly the
nonexistent hour on spring-forward. Spring-forward 2026-03-08 and fall-back
2026-11-01: a shift spanning the transition, one clocking in inside the repeated hour,
one clocking in inside the skipped hour. Assert both the business day and the hour
total (a 22:00→06:00 shift is 7h in spring, 9h in fall — a real payroll fact, not a
rounding artifact).

### 11.6 pgTAP ↔ TS parity

One shared fixture table of `(instant, tz, cutoff_hour, expected_business_day)` —
authored once, consumed by
`supabase/tests/business_day_cutoff.test.sql` and by the Vitest suite. Both must agree
with the *stated expectation*, not merely with each other; two implementations
agreeing on a wrong answer is the failure mode a mutual-comparison test cannot see.
pgTAP also covers null instant, null/empty tz, invalid tz string, missing restaurant,
and CHECK-constraint rejection at -1 and 12.

### 11.7 Dashboard == Payroll

Extend [`tests/unit/dashboard-payroll-consistency.test.ts`](../../../tests/unit/dashboard-payroll-consistency.test.ts)
to run its cross-check at every cutoff, in every pinned zone, and — specifically —
over a fixture with a `break_end` that crosses midnight. That is the §3.4 latent
divergence; after this change the two paths share an anchor, and this test is what
keeps them sharing it.

### 11.8 E2E

Playwright, `test.use({ timezoneId })` to pin the browser zone independently of the
restaurant zone:

1. Set the cutoff to 2 AM on the Payroll settings tab; assert it persists across
   reload (proves the `restaurants` write path and the Select round-trip).
2. With a seeded 6 PM→3 AM shift, assert the labor cost lands on the clock-in day and
   the next day shows zero — the reported symptom, end to end through real RLS.
3. Assert Dashboard and Payroll show the same total for that shift, in a browser zone
   that differs from the restaurant's.
4. Assert the CHECK rejection surfaces as a toast, not an unhandled error.

Existing specs to extend rather than duplicate: the labor/payroll specs under
`tests/e2e/`. Helpers from `'../helpers/e2e-supabase'`, `generateTestUser()`, and
`getByRole`/`getByLabel` selectors per CLAUDE.md.

### 11.9 Note on property testing

`fast-check` is not installed. Rather than add a dependency for this, §11.1 runs its
invariants over a deterministic seeded corpus (every hour of a 48h window × 12 cutoffs
× 4 zones × 2 DST weekends). Deterministic is also the right call for money math: a
random failure that does not reproduce is worse than no test.
