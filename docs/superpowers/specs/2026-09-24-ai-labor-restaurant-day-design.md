# AI labor tools: use restaurant-local days

## Problem

The AI chat tools take "today" from the restaurant clock
(`supabase/functions/ai-execute-tool/index.ts:3574`). The labor tools do not.
The first change kept them on the server (UTC) clock on purpose. See
`docs/superpowers/specs/2026-09-24-ai-chat-restaurant-today-design.md`,
section "Decided trade-offs".

The result:

1. The Deno labor engine puts each punch period into a day by the runtime
   local fields. These are UTC fields on the edge runtime.
   - `supabase/functions/_shared/laborCalculations.ts:548`
     (`formatDateLocal(new Date(period.startTime))`) and the active-day loop
     at `:554-566` in `calculateActualLaborCost`.
   - `:708` and `:712-716` in `calculateHoursPerEmployee`.
   - `:793` in `calculateScheduledLaborCost`.
2. The labor paths call `calculateDateRange(..., laborServerNow())`, so they
   use the UTC day: `ai-execute-tool/index.ts:93` (labor block of
   `executeGetKpis`), `:1981` (`executeGetLaborCosts`), `:2063`
   (`executeGetTimePunches`), `:2176` (`executeGetScheduleOverview`),
   `:2275` (`executeGetPayrollSummary`).
3. The fetch windows send the wall-clock Dates to PostgREST with
   `toISOString()`: `:179-180`, `:1936-1937`, `:2201-2202`, `:2285-2286`.
4. `get_kpis` omits labor, prime cost and profitability when the labor
   window and the sales window are different days
   (`ai-execute-tool/index.ts:97`, `:160`, `:253`;
   `laborWindowMismatchReason` at `_shared/restaurantDate.ts:81`). For
   `America/Chicago` this happens every evening from 19:00 to 24:00. For
   `Pacific/Auckland` it happens from 00:00 to about 12:00.
5. `executeGetScheduleOverview` groups shifts by the UTC day
   (`ai-execute-tool/index.ts:2234`). `executeGetTimePunches` labels each
   shift with the UTC day (`:2111`).

## Frontend callers

`src/` does not import the Deno file. It has its own port,
`src/services/laborCalculations.ts`. That port already takes a restaurant
timezone:

- `calculateActualLaborCost(..., timezone)` at
  `src/services/laborCalculations.ts:491-497`, with
  `toBusinessDay(period.startTime, timezone)` at `:552`.
- `calculateHoursPerEmployee(..., timezone)` at `:671-676`. It converts the
  instant window to business days at `:689-690`.
- `calculateScheduledLaborCost(..., timezone)` at `:364-369`, with
  `toBusinessDay(shift.start_time, timezone)` at `:399`.
- The callers pass the restaurant timezone:
  `src/hooks/useLaborCostsFromTimeTracking.tsx:206-212`,
  `src/hooks/useScheduledLaborCosts.tsx:85`.

So this change does not touch `src/`. Frontend results do not change for
any viewer. The Deno engine gets the same signatures as the frontend port.
A parity test checks that the two engines give the same daily costs for the
same input and timezone.

## Design

### `_shared/timezone.ts`

- `safeTz` (`timezone.ts:25`) builds a new `Intl.DateTimeFormat` on each call
  (`:30`). The engine calls it once per period. Add a module-level `Set` of
  zones that passed the check, so a second call for the same zone does not
  build a formatter.

### `_shared/restaurantDate.ts`

- Add `restaurantDayBoundsUtc(startDay, endDay, timeZone)`. It returns
  `{ start, end }` as real UTC instants:
  - `start = zonedNaiveToUtc(`${startDay}T00:00:00`, tz)`;
  - `end = zonedNaiveToUtc(`${dayAfter(endDay)}T00:00:00`, tz) - 1 ms`.
  `zonedNaiveToUtc` (`timezone.ts:98`) drops milliseconds, so the end uses
  the next midnight minus 1 ms. It mirrors `businessDayRangeToInstants`
  (`src/lib/restaurantClock.ts:183`), which ends at `23:59:59.999`.
- Delete `laborServerNow` (`restaurantDate.ts:72`) and
  `laborWindowMismatchReason` (`:81`). Delete their tests
  (`tests/unit/restaurantDate.test.ts:118-137`). Update the
  `calculateDateRange` comment (`:123`).

### `_shared/laborCalculations.ts` (Deno engine)

Add a required `timezone: string` last argument, as in the frontend port:

- `calculateActualLaborCost(employees, punches, startDate, endDate, timezone)`.
  `startDate` / `endDate` are calendar-day Dates (local fields), as today.
  The day of a period is `ymdInTimeZone(period.startTime, tz)`. The active
  days are every restaurant day from the start instant to the end instant.
- `calculateHoursPerEmployee(employees, punches, startInstant, endInstant,
  timezone)`. The window is real instants, as in the frontend port. The
  filter at `:692` stays an instant compare. The salary and contractor
  loops get the business days of the two bounds.
- `calculateScheduledLaborCost(shifts, employees, startDate, endDate,
  timezone)`. The day of a shift is `ymdInTimeZone(shift.start_time, tz)`.

The salary and contractor loops (`calculateSalaryForPeriod` at `:246`,
`calculateContractorPayForPeriod` at `:271`) read the day of the cursor with
`normalizeDateString` (`:173`, `toISOString`, UTC fields). The cursor is a
local-midnight Date (`:251`). On a UTC runtime the two agree. On a host east
of UTC (for example `TZ=Pacific/Auckland` in `npm run test:tz`) the loop
reads the previous day. Change both loops to walk the day strings from
`generateDateRange` (`:158`, local fields). Compare `hire_date` and
`termination_date` as `YYYY-MM-DD` strings. On the UTC edge runtime the
result does not change.

One helper, `businessDaysBetween(startInstant, endInstant, tz)`, gives the
restaurant days an interval touches. It steps on day strings, not on
instants, so a DST change cannot skip or repeat a day. It mirrors
`src/lib/restaurantClock.ts:141`.

### `ai-execute-tool/index.ts`

- The `serve` handler passes `restaurantTimeZone` (`:3573`) to the labor
  executors and to `executeGetKpis`.
- Each labor path uses `calculateDateRange(..., restaurantNow)`. It gets the
  fetch window from `restaurantDayBoundsUtc(startDateStr, endDateStr, tz)`.
  The punch fetch keeps `LABOR_FETCH_LOOKAHEAD_HOURS` on the end instant.
- `calculateActualLaborCost` and `calculateScheduledLaborCost` get the
  wall-clock `startDate` / `endDate` and the timezone.
  `calculateHoursPerEmployee` gets the instant window and the timezone.
- `executeGetKpis`: delete `laborRange` and the mismatch check. Labor uses
  the sales range. `labor_omitted` stays for the capability check only.
- `executeGetAiInsights` calls `executeGetKpis` (`:1450`). Pass the
  timezone there too.
- `executeGetTimePunches`: the shift `date` is
  `ymdInTimeZone(p.startTime, tz)` (was `:2111`).
- `executeGetScheduleOverview`: `week` / `month` start from
  `restaurantNow`. The fetch window is the instant bounds of
  `[startDateStr, endDateStr]`. The group key is
  `ymdInTimeZone(shift.start_time, tz)` (was `:2234`).

## Behavior changes

- Labor figures cover restaurant days. A Chicago clock-in at 20:00 CDT counts
  on that restaurant day, not on the next UTC day.
- `get_kpis` shows labor, prime cost and profitability at all hours of the
  day.
- `get_schedule_overview` with `week` now fetches shifts to the end of
  `end_date`. Before, the fetch stopped at 00:00 on `end_date`, but the
  reported range and the cost days included `end_date`.

## Tests

All tests use fixed UTC instants and must pass under `npm run test:tz`
(`package.json:34`: Chicago, Auckland, UTC).

- `tests/unit/restaurantDate.test.ts`: `restaurantDayBoundsUtc` for Chicago
  CDT, Chicago CST, Auckland, and a DST day (2026-03-08 Chicago, 23 hours).
- New `tests/unit/laborCalculations.edge.test.ts` (imports the Deno file):
  - A Chicago clock-in at `2026-09-25T01:00:00Z` (20:00 CDT, Sep 24) counts
    on `2026-09-24`.
  - An Auckland clock-in at `2026-09-24T20:00:00Z` (08:00 NZST, Sep 25)
    counts on `2026-09-25`.
  - An overnight shift charges the daily rate for both restaurant days.
  - `calculateHoursPerEmployee` keeps a period that starts inside the
    instant window and drops one that starts outside.
  - `calculateScheduledLaborCost` puts an evening shift on its restaurant
    day.
  - Salary for one restaurant day is one day of salary on every host.
  - Parity: the Deno and the `src/` engine give the same `dailyCosts` for
    the same punches and timezone.
- `tests/unit/ai-restaurant-today-wiring.test.ts`: `ai-execute-tool` has no
  `laborServerNow` and no `laborWindowMismatchReason`. Each labor
  `calculate*` call passes the timezone. Each punch or shift fetch uses
  `restaurantDayBoundsUtc`.

## E2E

Justified exception: the AI chat calls OpenRouter. CI cannot drive a model
conversation to a deterministic tool call. The unit tests cover the engine
and the date math. The source-contract test covers the wiring.

## Decided trade-offs

- The Deno engine keeps a mixed convention, as in the frontend port:
  `calculateActualLaborCost` and `calculateScheduledLaborCost` take
  calendar-day Dates, `calculateHoursPerEmployee` takes instants. Parity with
  `src/` is worth more than a new convention in one of the two engines. The
  JSDoc of each function states its convention.
- No migration and no SQL change. The labor math stays in TypeScript.
