# AI schedule and punch tools: restaurant days — design

Date: 2026-09-27
Branch: `fix/ai-schedule-restaurant-day`

## Problem

A manager asked the EasyShiftHQ MCP for a schedule. The answer put the
Friday and Saturday night shifts of an employee under Saturday and Sunday.
The `get_time_punches` tool has the same fault.

The MCP server forwards each data tool to `ai-execute-tool`
(`supabase/functions/mcp/index.ts:29`). The in-app AI chat uses the same
executor. So one fix covers both clients.

## Root cause

Edge functions run in UTC. A shift that starts at 19:00 or later in
`America/Chicago` (CDT) has a UTC date of the next day.

- `executeGetScheduleOverview` groups each shift with
  `toLocalYMD(new Date(shift.start_time))`
  (`supabase/functions/ai-execute-tool/index.ts:2288`). `toLocalYMD` reads
  runtime-local fields, which are UTC.
- The same function builds its window from `laborServerNow()` fields
  (`ai-execute-tool/index.ts:2236`, `:2239`) and sends it as
  `startDate.toISOString()` (`:2258`). The window is UTC midnight to UTC
  midnight, not restaurant midnight to restaurant midnight.
- `executeGetTimePunches` sets each shift `date` with
  `formatDateLocal(new Date(p.startTime))` (`ai-execute-tool/index.ts:2164`).
  `formatDateLocal` also reads runtime-local (UTC) fields
  (`supabase/functions/_shared/laborCalculations.ts:154`).
- `executeGetTimePunches` gets its window from `calculateDateRange(...,
  laborServerNow())` and fetches with `startDate.toISOString()` through
  `fetchLaborData` (`ai-execute-tool/index.ts:1989`).
  `calculateHoursPerEmployee` then keeps periods whose `startTime` is inside
  `[startDate, endDate]` (`_shared/laborCalculations.ts:692`). Both bounds are
  UTC midnights.

PR #805 left these paths on the server clock on purpose. Its design lists
`executeGetTimePunches` and `executeGetScheduleOverview` as a later PR
(`docs/superpowers/specs/2026-09-24-ai-chat-restaurant-today-design.md:75`).
This is that PR, for these two tools.

## Approach

Recommended: keep the labor engine as it is. Give the two tools
restaurant-day windows as real UTC instants, and restaurant-day keys.

Alternatives not taken:

- Change the labor engine to take a time zone. This changes dollar totals in
  `get_labor_costs`, `get_payroll_summary` and `get_kpis`. The user chose the
  smaller scope.
- Keep the UTC window and change only the day key. The window would still
  drop the first local evening of the range and add one from after the range.

### New pure helpers — `supabase/functions/_shared/restaurantDate.ts`

The file has no Deno imports, so Vitest can import it (header comment,
`_shared/restaurantDate.ts:1-15`). It already imports `safeTz` and
`tzOffsetMs` from `./timezone.ts`.

- `restaurantDayBounds(startYmd, endYmd, timeZone): { start: Date; end: Date }`
  - `start` = the UTC instant of `startYmd 00:00` in `timeZone`.
  - `end` = the UTC instant of the next day after `endYmd` at 00:00 in
    `timeZone`, minus 1 ms. So the range is inclusive and fits the existing
    `<=` filters.
  - Build `start` with `zonedNaiveToUtc(`${startYmd}T00:00:00`, tz)`.
    Build `end` with `zonedNaiveToUtc(`${nextDay(endYmd)}T00:00:00`, tz)`
    minus 1 ms. Get `nextDay` with UTC calendar math on the `YYYY-MM-DD`
    string. Do not add a fixed 24 h, because a DST day is 23 h or 25 h.
  - `zonedNaiveToUtc` (`_shared/timezone.ts:98`) is DST-aware (two-pass
    fix). An invalid zone falls back to `America/Chicago` (`safeTz`).
  - The outputs are real instants. A code comment tells callers to compare
    them as instants or read them with `ymdInTimeZone`. Never read them with
    `getFullYear()` / `getDate()`.
- `ymdInTimeZone` already exists (`_shared/restaurantDate.ts:45`). The
  day keys use it.

### New pure module — `supabase/functions/_shared/scheduleOverview.ts`

- `groupShiftsByRestaurantDay(shifts, timeZone)` returns the
  `shifts_by_date` record. The key is `ymdInTimeZone(start_time, timeZone)`.
  The row shape does not change: `id`, `employee_name`, `position`,
  `start_time`, `end_time`, `status`. Order in each day stays the query order
  (`start_time` ascending).
- `scheduleOverviewDays(period, startDate, endDate, restaurantNow)` returns
  `{ startDateStr, endDateStr }`. `week` = today to today + 7 days. `month` =
  today to the same day next month. Other periods use `calculateDateRange`
  with `restaurantNow`. This keeps the current forward-looking semantics
  (`ai-execute-tool/index.ts:2235-2240`), with "today" from the restaurant.

### New pure module — `supabase/functions/_shared/timePunchShifts.ts`

- `buildTimePunchShifts(employees, punches, bounds, timeZone, minHours)`
  returns the `Shift[]` rows that `executeGetTimePunches` builds today
  (`ai-execute-tool/index.ts:2147-2180`).
- It groups punches by employee and calls `parseWorkPeriods`
  (`_shared/laborCalculations.ts:338`). It keeps a period when
  `bounds.start <= startTime <= bounds.end`, it is not a break, and
  `hours >= minHours`.
- It does not call `calculateHoursPerEmployee`. That function also feeds
  `startDate` / `endDate` to `calculateSalaryForPeriod` and
  `calculateContractorPayForPeriod` (`_shared/laborCalculations.ts:723-724`).
  Those read UTC calendar fields, so instant bounds would count one extra day
  (Phase 2.5 review, major). The tool output never read those totals.
- `date` = `ymdInTimeZone(startTime, timeZone)`. The pay snapshot uses the
  same day. The cost rule does not change: hourly snapshot gives
  `hourly_rate × hours`; other types give `null`.

### `ai-execute-tool/index.ts`

- The dispatcher already has `restaurantTimeZone` and `restaurantNow`
  (`ai-execute-tool/index.ts:3663`). Pass them to `executeGetScheduleOverview`
  and `executeGetTimePunches` (`:3707`, `:3710`).
- `executeGetScheduleOverview`:
  - Days from `scheduleOverviewDays(..., restaurantNow)`.
  - Instants from `restaurantDayBounds(startDateStr, endDateStr, tz)`. Query
    with `.gte('start_time', start.toISOString())` and
    `.lte('start_time', end.toISOString())`.
  - Group with `groupShiftsByRestaurantDay(shifts, tz)`.
  - Pass the instants to `calculateScheduledLaborCost`.
- `executeGetTimePunches`:
  - Days from `calculateDateRange(..., restaurantNow)`.
  - Instants from `restaurantDayBounds`. Pass them to `fetchLaborData` (the
    18 h lookahead stays).
  - Build the rows with `buildTimePunchShifts(..., tz, minHours)`. The sort,
    the limit and the output shape do not change.

## Decided trade-offs

- **Labor cost engine stays on UTC days.** `calculateScheduledLaborCost`
  (`_shared/laborCalculations.ts:793`) still picks the pay snapshot and the
  daily-rate day by UTC day. The projected cost can differ only for a
  daily-rate employee or a pay change on a boundary day. `get_labor_costs`,
  `get_payroll_summary` and the `get_kpis` labor block do not change.
- `start_time` and `end_time` stay UTC ISO strings in the output. The day key
  is the fix. The MCP instructions already say dates are restaurant-zone
  `YYYY-MM-DD`.

## Tests

- `tests/unit/restaurantDate.test.ts`: `restaurantDayBounds` for
  `America/Chicago` in CDT and CST, a DST change day (2026-11-01), `UTC`, and
  an invalid zone. Assertions compare ISO strings, so they do not depend on
  the host zone.
- `tests/unit/timePunchShifts.test.ts`: a Friday 21:00 CDT clock-in gets
  `date` `2026-09-25`. A clock-in before `bounds.start` or after `bounds.end`
  is dropped, and an overnight shift that ends after `bounds.end` is kept.
  `min_hours` and breaks filter as before. The hourly cost uses the snapshot
  of the restaurant day.
- `tests/unit/scheduleOverview.test.ts`: a Friday 21:00 CDT shift
  (`2026-09-26T02:00:00Z`) groups under `2026-09-25`. A Saturday 22:00 shift
  groups under Saturday. A `UTC` restaurant keeps the UTC day.
  `scheduleOverviewDays('week', ...)` from a Chicago "now" of 2026-09-25
  21:00 gives `2026-09-25`..`2026-10-02`.
- Run `npm run test:tz` (Chicago, Auckland, UTC).
- E2E: justified exception. The change is inside an edge function that the
  Playwright suite does not drive. It has no UI. The pure-module tests cover
  the day math, and the executor only wires the helpers.
