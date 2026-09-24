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
2. The labor paths take "now" from `laborServerNow()`, so they use the UTC
   day: `ai-execute-tool/index.ts:93` (labor block of `executeGetKpis`),
   `:1981` (`executeGetLaborCosts`), `:2063` (`executeGetTimePunches`),
   `:2275` (`executeGetPayrollSummary`). `executeGetScheduleOverview` reads
   `laborServerNow()` at `:2176`. Its `week` / `month` branches build the
   range by hand (`:2180-2185`). Only its other periods call
   `calculateDateRange` (`:2187`).
3. The fetch windows send the wall-clock Dates to PostgREST with
   `toISOString()`: `:179-180`, `:1936-1937`, `:2201-2202`, `:2285-2286`.
4. `get_kpis` omits labor, prime cost and profitability when the labor
   window and the sales window are different days
   (`ai-execute-tool/index.ts:97`, `:160`, `:253`;
   `laborWindowMismatchReason` at `_shared/restaurantDate.ts:81`). For a
   day-level period (`today`, `week`, ...) in `America/Chicago` this happens
   every evening from 19:00 CDT (18:00 CST) to 24:00. In
   `Pacific/Auckland` it happens from 00:00 to 12:00 or 13:00. For the
   default `month` period it happens only on the last evening of the month.
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

- Add `firstInstantOfDay(day, timeZone)`. It returns the first instant whose
  restaurant day (`ymdInTimeZone`) is `day`.
  - The first guess is `zonedNaiveToUtc(`${day}T00:00:00`, tz)`
    (`timezone.ts:98`).
  - Some zones change DST at midnight (`America/Santiago`,
    `America/Havana`). Then local 00:00 does not exist, and the guess is
    23:00 on the day before. Example: Santiago `2026-09-06` gives
    `03:00Z`, but the day starts at `04:00Z`.
  - So check the guess: the day of `guess` must be `day`, and the day of
    `guess - 1 ms` must be before `day`. If the check fails, do a binary
    search on whole minutes in `[guess - 12 h, guess + 12 h]`. Offsets and
    DST changes fall on whole minutes.
- Add `restaurantDayBoundsUtc(startDay, endDay, timeZone)`. It returns
  `{ start, end }` as real UTC instants:
  - `start = firstInstantOfDay(startDay, tz)`;
  - `end = firstInstantOfDay(dayAfterYmd(endDay), tz) - 1 ms`.
  Every instant in `[start, end]` has a restaurant day in
  `[startDay, endDay]`. The frontend `businessDayRangeToInstants`
  (`src/lib/restaurantClock.ts:183`) uses `fromZonedTime` on 00:00 and
  23:59:59.999. It gives the same result except on a DST change at midnight.
- Add `dayAfterYmd(day)`. It steps a `YYYY-MM-DD` string with `Date.UTC`,
  not with a local Date.
- Add `ymdToLocalDate(day)`: `new Date(y, m - 1, d)`, a calendar-day Date
  with local fields. It is the Deno twin of `parseDateOnly`
  (`src/lib/dateOnly.ts`). Never use `new Date('YYYY-MM-DD')` for this: it
  is UTC midnight, which is the day before on a host west of UTC.
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
  loops get `ymdToLocalDate(ymdInTimeZone(bound, tz))` for each bound, as
  `src` does with `parseDateOnly` (`src/services/laborCalculations.ts:689-690`).
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
`src/lib/restaurantClock.ts:141`. It returns early when the start day and
the end day are the same (most periods), to save `formatToParts` calls.

### `ai-execute-tool/index.ts`

- Names: a calendar-day pair is `dayStart` / `dayEnd`. An instant pair is
  `windowStart` / `windowEnd`. Both are `Date`, so `tsc` cannot catch a
  swap. The names and the wiring test do.
- The `serve` handler passes `restaurantTimeZone` (`:3573`) to the labor
  executors and to `executeGetKpis`.
- Each labor path uses `calculateDateRange(..., restaurantNow)`. It gets the
  fetch window from `restaurantDayBoundsUtc(startDateStr, endDateStr, tz)`.
  The punch fetch keeps `LABOR_FETCH_LOOKAHEAD_HOURS` on the end instant.
  `:1988` and `:2077` pass the literal `18`. Use the constant there too.
- The three punch fetches (`:175-181`, `:1932-1938`, `:2281-2287`) have no
  page loop. `supabase/config.toml:9` sets `max_rows = 1000`. A month for 30
  staff can have more than 1000 punches. The cap drops the last punches and
  leaves open clock-ins. Add one helper, `fetchPunchesInWindow`, with a
  `.range()` page loop of 1000 rows, ordered by `punch_time` and `id`. All
  three paths use it.
- `calculateActualLaborCost` and `calculateScheduledLaborCost` get the
  wall-clock `startDate` / `endDate` and the timezone.
  `calculateHoursPerEmployee` gets the instant window and the timezone.
- `executeGetKpis`: delete `laborRange` and the mismatch check. Labor uses
  the sales range. `labor_omitted` stays for the capability check only.
  Delete the ternary at `:253` and the mismatch comment near `:159`.
- `executeGetAiInsights` calls `executeGetKpis` (`:1450`). Pass the
  timezone there too.
- `executeGetTimePunches`: the shift `date` is
  `ymdInTimeZone(p.startTime, tz)` (was `:2111`). Compute it once per
  shift.
- `executeGetScheduleOverview`: `week` / `month` start from
  `restaurantNow`. The fetch window is the instant bounds of
  `[startDateStr, endDateStr]`. The group key is
  `ymdInTimeZone(shift.start_time, tz)` (was `:2234`).

## Behavior changes

- Labor figures cover restaurant days. A Chicago clock-in at 20:00 CDT counts
  on that restaurant day, not on the next UTC day.
- `get_kpis` shows labor, prime cost and profitability at all hours of the
  day.
- `get_schedule_overview` with `week` or `month` now fetches shifts to the
  end of `end_date`. Before, the fetch stopped at 00:00 on `end_date`, but
  the reported range and the cost days included `end_date`.
- `get_payroll_summary` reads `tip_splits` and `daily_labor_allocations` for
  restaurant days (`:2297-2305`), because the range now comes from
  `restaurantNow`.
- The labor punch fetches read all pages, not only the first 1000 rows.

## Tests

All tests use fixed UTC instants and must pass under `npm run test:tz`
(`package.json:34`: Chicago, Auckland, UTC).

- `tests/unit/restaurantDate.test.ts`: `restaurantDayBoundsUtc` for Chicago
  CDT, Chicago CST, Auckland, a DST day (2026-03-08 Chicago, 23 hours), and
  a DST change at midnight (`America/Santiago` 2026-09-06 starts at
  `04:00Z`; 2026-09-05 ends at `03:59:59.999Z`). `ymdToLocalDate` and
  `dayAfterYmd` (month end, year end).
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
  - Salary for a one-day instant window in `calculateHoursPerEmployee` is
    one day of salary on every host.
  - Parity: the Deno and the `src/` engine give the same `dailyCosts` for
    the same punches and timezone. The fixtures use hourly and daily_rate
    employees only, with no type change and no stale clock-in. See the
    known differences below.
- `fetchPunchesInWindow`: a stub client with 2500 rows returns all rows in
  three pages.
- `tests/unit/ai-restaurant-today-wiring.test.ts`: `ai-execute-tool` has no
  `laborServerNow` and no `laborWindowMismatchReason`.
  `calculateActualLaborCost(` and `calculateScheduledLaborCost(` get
  `dayStart, dayEnd, restaurantTimeZone`. `calculateHoursPerEmployee(` gets
  `windowStart, windowEnd, restaurantTimeZone`. Each punch or shift fetch
  uses `restaurantDayBoundsUtc`. No literal `18` look-ahead.

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
- No branded `Instant` type. The `src/` port has none, and a brand in one
  port only makes the two ports differ. Variable names and the wiring test
  guard the convention (Phase 2.5, major).
- No migration and no SQL change. The labor math stays in TypeScript.
- Known differences between the Deno and the `src/` engine. They exist
  before this change and stay out of scope:
  - Deno `calculateActualLaborCost` passes all employees to
    `distributeFixedCosts` (`laborCalculations.ts:607`, `:611`). `src`
    passes only employees whose current type is salary or contractor.
  - `src` uses a different `parseWorkPeriods`
    (`src/utils/payrollCalculations.ts:273`) with stale clock-in rules.
  - `src` scheduled hours use `calculateShiftHours`. Deno uses inline math
    (`laborCalculations.ts:800-804`).
