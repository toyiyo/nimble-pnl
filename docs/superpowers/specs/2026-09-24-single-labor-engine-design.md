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
shim with the same exports, so the 69 `src/` files that import them do not
change:

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
- No `@/` alias, no `import.meta.env`, no React, no browser globals.
  `restaurantClock.ts` reads `import.meta.env` (`src/lib/restaurantClock.ts:25`).
  Change it to a guarded read that is safe when `env` is undefined (Deno).
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
- A source-contract test checks the import rules on every file in
  `_shared/labor/`.

The `src/` DB code and the other `src/lib/dateOnly.ts` users stay as they
are. The existing `_shared/dateOnly.ts` stays for its current Deno users.

### Layer 2: shared loaders

Move the body of each hook's `queryFn` into a loader in `_shared/labor/`.
The hook keeps `useQuery`, the query key, `staleTime` and the React inputs.
A loader takes a structural client, the restaurant id, calendar days
(`YYYY-MM-DD`), the timezone and the employees.

- `loadPeriodLaborCost(client, { restaurantId, startDay, endDay, timeZone,
  employees, throughNow, now })` returns `{ dailyCosts, totalCost, wageCost,
  capped }`. It is the current `useLaborCostsFromTimeTracking` body.
- `loadPeriodLaborBasis(...)` applies `resolveLaborBasis` over
  `loadPeriodLaborCost` and the bank-transaction labor
  (`src/hooks/useLaborCostsFromTransactions.tsx`, `bank_transactions` and
  `pending_outflows`). It returns the `totalLaborCost` and `laborBasis` that
  `useCostsFromSource` returns (`useCostsFromSource.tsx:123-130`).
- `loadPayrollPeriod(client, { restaurantId, startDay, endDay, timeZone,
  employees, employeeId? })` returns the `PayrollPeriod` from
  `calculatePayrollPeriod`. It is the current `usePayroll` body.

Each loader builds every instant window from the calendar days and the
timezone, with `businessDayRangeToInstants`. The OT week edges come from the
restaurant-local week of `startDay` and `endDay`, not from `startOfWeek` on a
host Date.

### Layer 3: host-independent engine

Rule: an **instant** becomes a day only through `toBusinessDay(instant, tz)`.
A **day** becomes an instant only through `businessDayRangeToInstants` or a
new `firstInstantOfDay(day, tz)`. Week math runs on day strings.

Known sites to change (from Problem 3):

- `laborCalculations.ts:898-899`: week key of a punch =
  week of `toBusinessDay(punch_time, tz)`, on the day string.
- `useLaborCostsFromTimeTracking.tsx:256-258` (moves into the loader): range
  bounds from `businessDayRangeToInstants(startDay, endDay, tz)`.
- `punchWindow.ts:66-88`: week-aligned fetch bounds from day strings and the
  timezone.
- `payrollCalculations.ts` anomaly messages: `formatInstant(t, tz, ...)`
  (`src/lib/restaurantClock.ts:122`).
- `businessDayRangeToInstants` (`src/lib/restaurantClock.ts:183`) uses
  `fromZonedTime('YYYY-MM-DDT00:00:00.000')`. When local midnight falls in a
  DST gap, this is 1 hour early. Example: `America/Santiago`, `2026-09-06`
  gives `03:00Z`, which is 23:00 on Sep 5 local. The day starts at `04:00Z`.
  Add `firstInstantOfDay`: check the guess, and on a failed check do a
  binary search on whole minutes in ±12 h.

For a viewer in the restaurant timezone, the host day and the restaurant
day are the same. So these changes do not change page results for that
viewer. For a viewer in another timezone they fix the result.

An audit task reads every date call in the moved files (about 47 matches of
`startOfWeek|endOfWeek|setHours|getDate|getDay|getFullYear|format(|parseISO|setDate`)
and classifies each one as instant (change) or day token (keep).

### Layer 4: the AI tools call the loaders

`ai-execute-tool` resolves the timezone once (`index.ts:3573`) and builds
`restaurantNow` (`:3574`). Each labor tool calls the function behind its page:

| AI tool | Page | Shared function |
|---|---|---|
| `get_kpis` (labor, prime cost) | Dashboard (`useCostsFromSource`) | `loadPeriodLaborBasis`, `throughNow: false` |
| `get_labor_costs` | Labor page (`useLaborPnlCore.ts:61`) | `loadPeriodLaborCost`, `throughNow: true` |
| `get_time_punches` | (no page total) | `calculateHoursPerEmployee` and `parseWorkPeriods` (moved engine) |
| `get_payroll_summary` | Payroll (`usePayroll`) | `loadPayrollPeriod` |
| `get_schedule_overview` | Scheduling (`useScheduledLaborCosts.tsx:46`) | `calculateScheduledLaborCost` |

- Every labor period comes from `calculateDateRange(..., restaurantNow)`.
  The loaders get `startDateStr` / `endDateStr`.
- Delete `laborServerNow`, `laborWindowMismatchReason`
  (`_shared/restaurantDate.ts:72`, `:81`), the `laborRange` and the mismatch
  gate in `executeGetKpis` (`index.ts:93-97`, `:160`, `:253`).
- The capability check stays (`hasSchedulingOrPayrollCapability`). Without
  the capability, labor stays omitted, as today.
- Employees: the AI selects `EMPLOYEE_LABOR_COLUMNS`
  (`_shared/employeeLaborColumns.ts:8-13`). The dashboard selects `*` from
  `employees_secure` (`src/hooks/useEmployees.tsx:41-45`). Extend the
  constant to every field the moved engine reads. A test checks that the
  keys of `LaborEmployee` are in the constant.
- Delete `_shared/laborCalculations.ts`. Update `tests/unit/punchWindow.test.ts:55`,
  which reads it as text.

## Behavior changes

- **AI labor figures change.** They now match the pages: overtime, tips
  owed, per-job payments, labor basis, payroll tips and overtime rules.
- **AI labor uses restaurant days,** and `get_kpis` shows labor at every
  hour.
- **AI punch fetches read all pages** (`fetchAllRows`), not only the first
  1000 rows.
- **Pages:** no change for a viewer in the restaurant timezone. For a viewer
  in another timezone, overtime weeks and range edges follow the restaurant
  timezone (a fix). On a DST change at local midnight (Santiago, Havana), the
  first hour of the day moves back into the correct day (a fix).

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
- **Host independence:** a Sunday 20:00 CDT clock-in falls into the Chicago
  week under all three host timezones. `firstInstantOfDay` for Santiago
  `2026-09-06` is `04:00Z`.
- **Loaders:** a stub client returns fixed rows. Check the windows each query
  gets, the page loop, the tip netting, the per-job sum and the basis rule.
- **Hook parity:** each hook returns the loader result for the same input.
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
- **CPU.** The edge function now runs overtime banding. A month for 30 staff
  is about 130 employee-weeks. This is small, but the plan measures one
  month fixture.
- **PR size.** The move is large, but it is mostly `git mv` plus shims.

## Proposed PR split

1. **PR 1 (no behavior change for the pages):** Layers 1 to 3 and the hook
   changes. The existing test suite is the guard.
2. **PR 2 (AI changes):** Layer 4, delete the Deno copy, the restaurant-day
   windows for the AI.

PR 2 changes the numbers the AI gives. PR 1 changes no numbers for a viewer
in the restaurant timezone. Two PRs keep each review focused.

## Replaced design

This design replaces the first draft of this file, which fixed only the
day bucketing in the Deno copy (commits `00b7727`, `59311e5`). The Phase 2.5
findings from that draft that still apply are in this design: the DST gap at
midnight, the punch page loop, the look-ahead constant, and the names for
day and instant pairs.
