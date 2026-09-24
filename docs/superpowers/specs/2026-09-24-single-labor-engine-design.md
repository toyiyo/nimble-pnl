# One labor engine for the app and the AI chat

## Goal

For the same restaurant, days and data, an AI labor tool returns the same
figures as the page that shows them. The page results do not change for a
viewer in the restaurant's own timezone.

## Problem

### 1. The AI uses a copy of the engine, and the copy drifted

`supabase/functions/_shared/laborCalculations.ts` is a "Port of
src/services/laborCalculations.ts" (line 4). `ai-execute-tool` imports it
(`supabase/functions/ai-execute-tool/index.ts:169`, `:1980`, `:2061`,
`:2173`, `:2274`). The copy differs from the frontend engine:

- **No overtime.** The copy has no overtime logic (no match for "overtime"
  in the file). The dashboard total comes from
  `calculateActualLaborCostForRange` (`src/hooks/useLaborCostsFromTimeTracking.tsx:260`),
  which bands overtime per week (`src/services/laborCalculations.ts:865-929`).
- **No tips owed and no per-job payments in `get_kpis`.** The dashboard total
  is `actualLaborCents / 100 + perJobDollars`
  (`useLaborCostsFromTimeTracking.tsx:274`).
- **No labor basis.** The dashboard uses accrued labor when the period has
  wages, else paid labor from bank transactions
  (`src/hooks/useCostsFromSource.tsx:94`, `:123-124`;
  `src/lib/combineCosts.ts:44-46`). `get_kpis` uses accrued labor only
  (`ai-execute-tool/index.ts:198-211`).
- **Different punch pairing.** `src/` uses `parseWorkPeriods` from
  `src/utils/payrollCalculations.ts:273`, with stale clock-in rules. The copy
  has its own (`_shared/laborCalculations.ts:338`).
- **UTC days.** The copy puts punches into days by runtime-local (UTC)
  fields (`_shared/laborCalculations.ts:548`, `:708`, `:793`). The frontend
  engine uses the restaurant timezone
  (`src/services/laborCalculations.ts:552`, `:710`, `:399`).
- **Payroll summary.** `get_payroll_summary` calls the copy's
  `calculateActualLaborCost` (`ai-execute-tool/index.ts:2334`). The Payroll
  page calls `calculatePayrollPeriod` (`src/hooks/usePayroll.tsx:405`) with
  employee tips, tip payouts, overtime rules and overtime adjustments
  (`usePayroll.tsx:290`, `:303`, `:355`, `:367`).

### 2. The AI labor paths use the UTC day as "today"

The labor paths take "now" from `laborServerNow()` (`ai-execute-tool/index.ts:93`,
`:1981`, `:2063`, `:2176`, `:2275`). `get_kpis` omits labor when the labor day
and the sales day differ (`:97`, `:160`, `:253`). For a day-level period in
Chicago, this happens every evening from 19:00 CDT (18:00 CST).

### 3. The frontend engine is not host-independent

A single engine on the UTC edge runtime must give the same result as in a
Chicago browser. Some code reads the host timezone:

- `calculateActualLaborCostForRange` groups a punch into its overtime week
  with `startOfWeek(t)` on an instant (`src/services/laborCalculations.ts:898-899`).
  On a UTC host, a Sunday 20:00 CDT clock-in goes into the next week. This
  is the open bug from the PR #485 lesson (`memory/lessons.md`, "Local-TZ
  `startOfWeek` makes ISO-week labor wages CI-flaky").
- The hook builds the range with `setHours` on host-local Dates
  (`useLaborCostsFromTimeTracking.tsx:256`, `:258`).
- `weekAlignedFetchStart` / `weekAlignedFetchEnd` use host-local
  `startOfWeek` / `endOfWeek` (`src/utils/punchWindow.ts:66-88`).
- Payroll anomaly messages format instants with host-local `format`
  (`src/utils/payrollCalculations.ts:125`, `:133`, `:160`, `:169`, `:198`, `:321`).

Calendar-day math on day strings or local-field day tokens is
host-independent. Examples: `payrollCalculations.ts:526`, and the loops in
`src/utils/compensationCalculations.ts:722`, `:772`. These do not change.

### 4. The data assembly is in the React hooks

The engine does not choose the fetch windows, page the fetches, net the
tips or read the overtime rules. The hooks do:

- `useLaborCostsFromTimeTracking` (`src/hooks/useLaborCostsFromTimeTracking.tsx:85-287`):
  punch windows (`:103`, `:114`), paged fetches (`fetchAllRows`), tips owed
  (`netTipsOwedByEmployee`), open shifts (`throughNow`), per-job payments.
- `usePayroll` (`src/hooks/usePayroll.tsx:175-426`): restaurant-day window
  (`:196`), buffered punch fetch (`:201`), seven source tables,
  `calculatePayrollPeriod` (`:405`).

The AI cannot call a React hook. So the AI must share this assembly too, or
the numbers drift again.

## Design

### Layer 1: move the engine to `supabase/functions/_shared/labor/`

The repo already shares `_shared/` code with `src/`:
`src/components/MonthlyBreakdownTable.tsx:12` imports
`supabase/functions/_shared/monthlyPerformance`, and
`tests/unit/availability-tz.test.ts:7` imports
`_shared/availability-tz.ts`, which uses a bare `date-fns-tz` import (line 12).

Move these files with `git mv`. Each old `src/` path becomes a re-export
shim with the same exports, so the `src/` files that import them do not
change. 78 files import the 13 moved modules, and 7 more import
`src/lib/scheduleRoster.ts`. The count comes from:
`grep -rlE "from ['\"](@/|\.\.?/.*)(services/laborCalculations|utils/payrollCalculations|utils/compensationCalculations|lib/overtimeCalculations|utils/punchWindow|utils/openShiftPunches|utils/tipAggregation|utils/fetchAllRows|services/tipsFetch|lib/restaurantClock|lib/dateOnly|lib/dateConfig|lib/combineCosts)['\"]" src`.
The plan lists the files. No test uses `vi.mock` on a moved path, and no
moved module has a default export, so `export *` shims are safe.

| From | To |
|---|---|
| `src/services/laborCalculations.ts` | `_shared/labor/laborCalculations.ts` |
| `src/utils/payrollCalculations.ts` | `_shared/labor/payrollCalculations.ts` |
| `src/utils/compensationCalculations.ts` | `_shared/labor/compensationCalculations.ts` |
| `src/lib/overtimeCalculations.ts` | `_shared/labor/overtimeCalculations.ts` |
| `src/utils/punchWindow.ts` | `_shared/labor/punchWindow.ts` |
| `src/utils/openShiftPunches.ts` | `_shared/labor/openShiftPunches.ts` |
| `src/utils/tipAggregation.ts` | `_shared/labor/tipAggregation.ts` |
| `src/utils/fetchAllRows.ts` | `_shared/labor/fetchAllRows.ts` |
| `src/services/tipsFetch.ts` | `_shared/labor/tipsFetch.ts` |
| `src/lib/restaurantClock.ts` | `_shared/labor/restaurantClock.ts` |
| `src/lib/dateOnly.ts` | `_shared/labor/dateOnly.ts` |
| `src/lib/dateConfig.ts` | `_shared/labor/dateConfig.ts` |
| `src/lib/combineCosts.ts` (`resolveLaborBasis`) | `_shared/labor/combineCosts.ts` |
| `calculateShiftHours` (`src/lib/scheduleRoster.ts:40`) | `_shared/labor/shiftHours.ts` |

Rules for the moved files:

- Imports are relative with the `.ts` extension. `tsconfig.app.json` allows
  this (`allowImportingTsExtensions: true`). The only bare imports are
  `date-fns` and `date-fns-tz`.
- Add `"date-fns": "npm:date-fns@3.6.0"` to `supabase/functions/deno.json`,
  next to `date-fns-tz`. `3.6.0` is the installed version.
- No `@/` alias, no React, no browser globals.
  `restaurantClock.ts` reads `import.meta.env?.DEV`
  (`src/lib/restaurantClock.ts:25-26`). That is safe at runtime in Deno. Only
  the Deno type check fails, because `ImportMeta` has no `env` there. Keep the
  literal `import.meta.env` token, so Vite replaces it and `vi.stubEnv` in
  `tests/unit/restaurantClock.test.ts:155-158` keeps working. Add a type-only
  declaration for `env` in the moved file.
- No `@supabase/supabase-js` type import. `tipsFetch.ts` imports
  `SupabaseClient` (line 1). Use a small structural client type, as
  `_shared/timezone.ts` does (`RestaurantTimeZoneQueryClient`, line 145).
- Types: the engine declares the fields it reads in
  `_shared/labor/types.ts` (for example `LaborEmployee`, `LaborShift`,
  `LaborTimePunch`). `src/types/scheduling.ts` and `src/types/timeTracking.ts`
  keep the full UI types. `src/` types are structural supersets, so `tsc`
  checks each call. Output types that the UI uses (for example
  `LaborCostBreakdown`) move, and `src/types` re-exports them. A function that
  returns its input employee is generic (`<E extends LaborEmployee>`).
- `LABOR_EMPLOYEE_KEYS` is a `const` array with
  `satisfies readonly (keyof LaborEmployee)[]`. A test checks it against the
  employee select, because a test cannot read interface keys at runtime and
  `tsconfig` has `strict: false`. The engine also reads `area`, `is_active`,
  `deactivated_at` and `last_active_date` (`payrollCalculations.ts:619`,
  `:677-680`), so the select needs them.
- `getSortedHistory` sorts by `effective_date` only
  (`compensationCalculations.ts:64-67`). Add `created_at` as a tie-break, and
  add `created_at` to the history embed, so the UI and the AI pick the same
  row.
- A source-contract test checks the import rules on every file in
  `_shared/labor/`.

The `src/` DB code and the other `src/lib/dateOnly.ts` users stay as they
are. `_shared/dateOnly.ts` (the current Deno copy) re-exports
`toDateOnlyString` from `_shared/labor/dateOnly.ts`, so there is one copy.

Guardrails that stop at `src/` today move with the code:

- The ESLint timezone rules and the `.limit(10000)` rule apply only to
  `src/**/*.{ts,tsx}` (`eslint.config.js:84-92`). Add
  `supabase/functions/_shared/labor/**/*.ts`, and ignore the moved
  `restaurantClock.ts` and `dateOnly.ts`, as `src/` does for the originals.
- `tests/unit/highVolumeQueryGuard.test.ts:76` walks only `src`, and it looks
  for `@/utils/fetchAllRows`. Extend the walk, and accept `./fetchAllRows.ts`.
- `sonar-project.properties` sets `sonar.sources=src`. Add
  `supabase/functions/_shared/labor`. The vitest coverage include already
  covers `_shared/**`.

### Layer 2: shared loaders

Move the body of each hook's `queryFn` into a loader in `_shared/labor/`.
The hook keeps all of its React Query options: `useQuery`, the query key,
`staleTime`, `enabled` (`!!restaurantId && !!employees.length`),
`refetchOnWindowFocus`, `placeholderData`
(`useLaborCostsFromTimeTracking.tsx:283-287`) and the payroll
`queryKeyEmployeeId` segment (`usePayroll.tsx:171-174`). A loader takes a
structural client, the restaurant id, calendar days (`YYYY-MM-DD`), the
timezone and the employees.

- `loadPeriodLaborCost(client, { restaurantId, startDay, endDay, timeZone,
  employees, throughNow, now })` returns `{ dailyCosts, breakdown, totalCost,
  wageCost, capped }`. It is the current `useLaborCostsFromTimeTracking`
  body. `breakdown` is the `calculateActualLaborCost` breakdown, for
  `get_labor_costs`.
- `loadPeriodBankLabor(client, { restaurantId, startDay, endDay })` is the
  current `useLaborCostsFromTransactions` `queryFn` (`:39-82`). It pages with
  `fetchAllRows`, not `.limit(10000)`, which stops at the 1000-row cap. It
  uses the day strings, not host-local `format(dateFrom, 'yyyy-MM-dd')`.
  `useLaborCostsFromTransactions` calls it.
- `loadPeriodLaborBasis(...)` applies `resolveLaborBasis`
  (`src/lib/combineCosts.ts:44-46`) over the two loaders. It returns the
  `totalLaborCost` and `laborBasis` that `useCostsFromSource` returns
  (`useCostsFromSource.tsx:94`, `:119-120`). `useCostsFromSource` keeps its two
  queries, and a parity test checks that it equals `loadPeriodLaborBasis`.
- `loadPayrollPeriod(client, { restaurantId, startDay, endDay, timeZone,
  employees, employeeId? })` returns `{ period, capped }`, where `period` is
  the `PayrollPeriod` from `calculatePayrollPeriod`. It is the current
  `usePayroll` body.
  - `employeeId` is `string | undefined`, never `null`. The hook uses `null`
    for "self-scoped, pending" (`usePayroll.tsx:171`), and `scopeToEmployee`
    (`:62-68`) reads `null` as "no filter". So the hook does not call the
    loader for `null`, and the loader throws on `null`.
  - `capped` goes to the caller, not only to the console (`:217-222`).
  - The punch fetch names its columns, not `select('*')` (`:205`).
  - `tip_splits`, `tip_split_items`, `daily_labor_allocations`,
    `employee_tips` and `tip_payouts` page with `fetchAllRows`
    (`usePayroll.tsx:227-310`). `tip_split_items` reads in chunks of ids.
- `loadScheduledLaborCost(client, { restaurantId, startDay, endDay,
  timeZone })` fetches the shifts and all employees (`status: 'all'`, as
  `useScheduledLaborCosts.tsx:65` does) and calls
  `calculateScheduledLaborCost`. The Scheduling page passes a Monday week
  (`src/pages/Scheduling.tsx:412-416`).

Two kinds of `Date` go into the engine. They must not mix:

- **Fetch windows are instants.** A loader builds them from the day strings
  and the timezone with `businessDayRangeToInstants`. They go only to the
  PostgREST `gte` / `lte` filters and to `periodsInWindow`.
- **Engine period arguments are day tokens:** `parseDateOnly(startDay)` and
  a local end of day on `endDay`. The engine reads them with local fields:
  `toDateOnlyString(periodStartDate)` (`payrollCalculations.ts:498-500`,
  `:592-593`), the `d.getDate()` loop (`compensationCalculations.ts:722`),
  and the noon compare `new Date(dateKey + 'T12:00:00')` against
  `rangeStart` / `rangeEnd` (`laborCalculations.ts:962-963`).
- An instant in a day-token argument moves the day on the UTC edge. Example:
  a Chicago `rangeEnd` of `endDay+1 04:59:59Z` reads as `endDay+1`, so
  salaried staff get one more day. Variable names keep the two apart:
  `dayStart` / `dayEnd` versus `windowStart` / `windowEnd`.

`now` for `throughNow` is a real instant: `new Date()`, read inside the
loader call. It is never `restaurantNow`, which is a wall-clock Date
(`_shared/restaurantDate.ts:32-42`). `appendOpenShiftClockOuts` needs a real
instant (`src/utils/openShiftPunches.ts:39-44`).

The OT week edges come from the restaurant-local week of `startDay` and
`endDay` on day strings, not from `startOfWeek` on a host Date.

### Layer 3: host-independent engine

Rule: an **instant** becomes a day only through `toBusinessDay(instant, tz)`.
A **day** becomes an instant only through `businessDayRangeToInstants` or a
new `firstInstantOfDay(day, tz)`. Week math runs on day strings.

Known sites to change (from Problem 3):

- `laborCalculations.ts:898-899`: week key of a punch =
  week of `toBusinessDay(punch_time, tz)`, on the day string.
- `laborCalculations.ts:918-919` and `:962-963`: the week start and the
  in-range check use `new Date(dateKey + 'T12:00:00')` (host-local noon).
  Change them to day-string compares.
- `useLaborCostsFromTimeTracking.tsx:256-258` (moves into the loader): the
  engine gets day tokens (Layer 2). The fetch window is
  `businessDayRangeToInstants(startDay, endDay, tz)`.
- `punchWindow.ts:66-88`: week-aligned fetch bounds from day strings and the
  timezone.
- `payrollCalculations.ts` anomaly messages: `formatInstant(t, tz, ...)`
  (`src/lib/restaurantClock.ts:122`).
- `payrollCalculations.ts:687-688`: `endOfWeek(parseISO(deactivated_at))`
  on an instant. Use the restaurant day of `deactivated_at`, then the week of
  that day string.
- `compensationCalculations.ts:249`: `new Date('2024-01-01')` is a UTC anchor
  mixed with local math. Change it to a local-field day token.
- `businessDayRangeToInstants` (`src/lib/restaurantClock.ts:183`) uses
  `fromZonedTime` on `00:00:00.000` and `23:59:59.999`. When a DST change
  falls at local midnight, both ends can be 1 hour off:
  - Gap: `America/Santiago` `2026-09-06` starts at `03:00Z` by this rule
    (23:00 on Sep 5 local). The real start is `04:00Z`.
  - Overlap: Santiago `2026-04-04` ends at `2026-04-05T02:59:59.999Z` by this
    rule. The real end is `03:59:59.999Z`, so punches in the repeated hour
    fall out.
  - Add `firstInstantOfDay(day, tz)`: check the guess, and on a failed check
    do a binary search on whole minutes in ±12 h. Then
    `start = firstInstantOfDay(startDay)` and
    `end = firstInstantOfDay(dayAfter(endDay)) - 1 ms`.

For a viewer in the restaurant timezone, the host day and the restaurant
day are the same, so these site changes keep the page result for that
viewer. The window change in "Behavior changes" is a separate, intended
change.

An audit task reads every date call in the moved files and classifies each
one as instant (change) or day token (keep). The pattern is
`startOfWeek|endOfWeek|setHours|getDate|getDay|getFullYear|format\(|parseISO|setDate|new Date\(|T12:00:00`.

### Layer 4: the AI tools call the loaders

`ai-execute-tool` resolves the timezone once (`index.ts:3573`) and builds
`restaurantNow` (`:3574`). Each labor tool calls the function behind its page:

| AI tool | Page | Shared function |
|---|---|---|
| `get_kpis` (labor, prime cost) | Dashboard (`useCostsFromSource`) | `loadPeriodLaborBasis`, `throughNow: false` |
| `get_labor_costs` | Labor page (`useLaborPnlCore.ts:61`) | `loadPeriodLaborCost`, `throughNow: true` |
| `get_time_punches` | (no page total) | `calculateHoursPerEmployee` and `parseWorkPeriods` (moved engine) |
| `get_payroll_summary` | Payroll (`usePayroll`) | `loadPayrollPeriod` |
| `get_schedule_overview` | Scheduling (`useScheduledLaborCosts.tsx:85`) | `loadScheduledLaborCost` |

- `get_labor_costs` figures:
  - The Labor page shows the straight-time `dailyCosts` only
    (`useLaborPnlCore.ts:56-61`, `useLaborPnlSummary.ts:26`). The tool returns
    the same `daily_costs` and `breakdown`.
  - It also returns `total_labor_cost` = `totalCost` (overtime plus tips owed
    plus per-job), the figure of the dashboard pills. Its description names
    both figures, so the model does not mix them.
- `get_schedule_overview` uses `loadScheduledLaborCost`. Its `week` / `month`
  branches (`index.ts:2176-2189`) and the `status = 'active'` filter
  (`:2208`) go. Weeks are Monday weeks, as on the Scheduling page.
- Weeks: `calculateDateRange` uses `getDay()` for `current_week` and
  `last_week`, so its weeks start on Sunday
  (`_shared/restaurantDate.ts:164`, `:170`). Payroll and Scheduling weeks start
  on Monday (`WEEK_STARTS_ON = 1`, `src/lib/dateConfig.ts:8`). Change
  `calculateDateRange` to `WEEK_STARTS_ON` (moved `dateConfig.ts`). This
  changes the week of every AI tool, the sales tools too (decided with the
  user).
- Every labor period comes from `calculateDateRange(..., restaurantNow)`.
  The loaders get `startDateStr` / `endDateStr`.
- Delete `laborServerNow`, `laborWindowMismatchReason`
  (`_shared/restaurantDate.ts:72`, `:81`), the `laborRange` and the mismatch
  gate in `executeGetKpis` (`index.ts:93-97`, `:160`, `:253`).
- The capability checks stay. `hasSchedulingOrPayrollCapability` gates labor.
  `hasPayRatesCapability` and the `pay_hidden` helpers from
  [toyiyo/nimble-pnl#806](https://github.com/toyiyo/nimble-pnl/pull/806)
  stay: without `view:pay_rates`, every pay-derived figure is `null` with a
  reason. This design needs #806 merged first.
- Employees: the AI reads `EMPLOYEE_LABOR_SOURCE` (`employees_secure`) through
  `fetchLaborEmployees` (#806). The base table `employees` revokes the pay
  columns from `authenticated` (`20260806110000_employee_column_gating.sql:126`).
  Extend `EMPLOYEE_LABOR_COLUMNS` to `LABOR_EMPLOYEE_KEYS` (Layer 1), plus the
  history `created_at`.
- Delete `_shared/laborCalculations.ts`. Update `tests/unit/punchWindow.test.ts:55`,
  which reads it as text. Delete the `laborWindowMismatchReason` tests
  (`tests/unit/restaurantDate.test.ts:9`, `:118-137`).

## Behavior changes

- **AI labor figures change.** They now match the pages: overtime, tips
  owed, per-job payments, labor basis, payroll tips and overtime rules.
- **AI labor uses restaurant days,** and `get_kpis` shows labor at every
  hour.
- **AI punch fetches read all pages** (`fetchAllRows`), not only the first
  1000 rows.
- **AI weeks start on Monday** for `current_week` and `last_week`, in every
  tool (sales tools too).
- **Pages, whole restaurant days (decided with the user).** The loaders work
  on whole restaurant days, as the query keys already do
  (`useLaborCostsFromTimeTracking.tsx:84`). Some callers pass a part of a day
  today, so their numbers change:
  - `src/pages/Index.tsx:240-241`: the previous-period `prevTo` is the
    midnight at the start of the last day. Today the fetch ends at 18:00 of
    that day. When the period ends on a Sunday, `weekAlignedFetchEnd` gives
    Sunday 23:59:59 with no look-ahead, so a Sunday-night shift that clocks
    out on Monday is lost. The loader includes it, so the previous-period
    total goes up to the correct value.
  - `src/components/DetailedPnLBreakdown.tsx:53-54` and
    `src/hooks/usePnLAnalyticsFromSource.tsx:116` (`subDays(now, 30)`) start
    in the middle of a day. The first day of `dailyCosts` now covers the
    whole day.
- **Pages, other viewers.** For a viewer in another timezone, overtime weeks
  and range edges follow the restaurant timezone (a fix). On a DST change at
  local midnight (Santiago, Havana), the first and last hour of the day move
  to the correct day (a fix).
- **Bank labor pages read all rows,** not the first 1000.

## Tests

All tests use fixed UTC instants and pass under `npm run test:tz`
(`package.json:34`: Chicago, Auckland, UTC).

- **Regression guard:** the existing labor tests import the old `src/` paths,
  which are now shims. They must pass without change. Examples:
  `tests/unit/laborCalculations.test.ts`,
  `tests/unit/laborCalculations.calculateActualLaborCostForMonth.test.ts`,
  `tests/unit/monthlyPerformance.acceptance.test.ts`,
  `tests/unit/dashboard-payroll-consistency.test.ts`,
  `tests/unit/laborBucketingTz.test.ts`, `tests/unit/punchWindow.test.ts`.
- **Intended test update:** `tests/unit/useLaborCostsFromTimeTracking.fetchRange.test.ts:112-131`,
  `:150-166` and `:175-188` compute the expected `gte` / `lte` with
  host-local `startOfWeek` / `endOfWeek` for a Chicago restaurant. They fail
  under Auckland and UTC after Layer 3. Change them to restaurant-local week
  edges.
- **Host independence:** a Sunday 20:00 CDT clock-in falls into the Chicago
  week under all three host timezones. `firstInstantOfDay` for Santiago
  `2026-09-06` is `04:00Z`. The Santiago `2026-04-04` window ends at
  `03:59:59.999Z`.
- **Day tokens:** a salaried employee over one Chicago day and one Auckland
  day gives one day of salary on all three hosts, through each loader.
- **Loaders:** a stub client returns fixed rows. Check the windows each query
  gets, the page loop, the tip netting, the per-job sum and the basis rule.
  `loadPayrollPeriod` throws on `employeeId: null`.
- **Hook parity:** each hook returns the loader result for the same input.
  Add hook tests for a `dateTo` at Sunday midnight and a `dateFrom` in the
  middle of a day (the intended changes above).
- **Basis parity:** `loadPeriodLaborBasis` equals the `totalLaborCost` and
  `laborBasis` of `useCostsFromSource` for the same rows.
- **Guardrails:** the ESLint block, `highVolumeQueryGuard` and Sonar include
  `_shared/labor/`.
- **Import rules:** every file in `_shared/labor/` has only relative `.ts`
  imports, `date-fns` or `date-fns-tz`. `deno.json` maps both packages.
- **AI wiring (source contract):** `ai-execute-tool` imports the loaders from
  `_shared/labor/`, has no `laborServerNow`, no `laborWindowMismatchReason`
  and no `_shared/laborCalculations.ts` import.

## E2E

The existing Playwright tests run against the shims. They are the
page-level regression guard: `tests/e2e/labor-cost-alignment.spec.ts`,
`tests/e2e/payroll-complete-journey.spec.ts`,
`tests/e2e/employee-payroll.spec.ts`,
`tests/e2e/dashboard-basis-labels.spec.ts`.

Justified exception for the AI side: the AI chat calls OpenRouter, and CI
cannot drive a model conversation to a deterministic tool call.

## Risks

- **No Deno check in CI.** No workflow in `.github/workflows` runs `deno`,
  and Deno is not installed in this session. A Deno-only import error shows
  only at deploy or at `supabase functions serve`. Mitigation: the
  import-rules test, and a manual `supabase functions serve ai-execute-tool`
  smoke check before merge (by a person with the Supabase CLI).
- **Client type.** The typed browser client must fit the structural client
  type. Plan task 1 checks this first. If it does not fit, the loaders take
  a page callback (`(from, to) => query`) instead, as `fetchAllRows` does now.
- **CPU.** The edge function now runs overtime banding. `calculateDateRange`
  allows `quarter` and `year`, and `calculateActualLaborCostForRange` filters
  all punches per employee (`laborCalculations.ts:873`). The plan measures a
  `year` fixture with 100 employees and 20000 punches (the `fetchAllRows`
  cap).
- **Cold start.** A bare `date-fns` root import loads the whole package. Map
  `"date-fns/": "npm:/date-fns@3.6.0/"` too, and use subpath imports in the
  moved files, or measure the cold start.
- **History rows for a masked caller.** RLS drops `compensation_history`
  without `view:pay_rates`. The engine then uses the current
  `compensation_type` for every day, so hours by type can differ from an
  owner's view. #806 nulls the costs. The hours stay, with this known limit.
- **PR size.** The move is large, but it is mostly `git mv` plus shims.

## Proposed PR split

0. **#806 (open):** employee reads through `employees_secure` and the
   `view:pay_rates` gate. This design builds on it.
1. **PR 1 (pages):** Layers 1 to 3, the loaders and the hook changes. The
   existing test suite is the guard. Only the whole-day window changes page
   numbers, as listed in "Behavior changes".
2. **PR 2 (AI changes):** Layer 4, Monday weeks, delete the Deno copy.

PR 2 changes the numbers the AI gives. Two PRs keep each review focused.

## Decisions (with the user)

- Hotfix first: the employee reads (#806) ship before this work.
- Whole restaurant days in the loaders, with the page changes listed above.
- Monday weeks in every AI tool.
- `get_schedule_overview` is in scope, with `loadScheduledLaborCost`.

## Replaced design

This design replaces the first draft of this file, which fixed only the
day bucketing in the Deno copy (commits `00b7727`, `59311e5`). The Phase 2.5
findings from that draft that still apply are in this design: the DST gap at
midnight, the punch page loop, the look-ahead constant, and the names for
day and instant pairs.

Phase 2.5 round 2 (Supabase and frontend reviewers) found the day-token
convention, the partial-day page windows, the employee column grants, the
masked pay case, the bank labor loader, the `now` instant, the payroll loader
contract, the guardrails, the DST overlap and the Monday weeks. This version
folds all of them.
