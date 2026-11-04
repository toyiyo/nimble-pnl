# AI schedule and punch tools: restaurant days — plan

Date: 2026-09-27
Branch: `fix/ai-schedule-restaurant-day`
Design: `docs/superpowers/specs/2026-09-27-ai-schedule-punches-restaurant-day-design.md`

## Goal

Make `get_schedule_overview` and `get_time_punches` use restaurant days.
A Friday 21:00 CDT shift must show under Friday, not Saturday.

## Rules for all tasks

- Use TDD. Write the failing test first. Run it and see it fail. Then write
  the code.
- Anchor all fixtures to UTC instants (`...Z`). Compare ISO strings or
  `YYYY-MM-DD` strings. Do not read host-local date fields in tests.
- Keep the new `_shared` modules free of Deno imports, so Vitest can import
  them.
- Do not change `laborCalculations.ts`. The labor cost engine stays on UTC
  days.
- Stage explicit paths only. Commit after each task.

## Task 1 — `restaurantDayBounds`

Files:
- `supabase/functions/_shared/restaurantDate.ts`
- `tests/unit/restaurantDate.test.ts` (extend)

Tests first:
1. Chicago CDT: `('2026-09-25', '2026-09-25', 'America/Chicago')` gives
   `start` `2026-09-25T05:00:00.000Z` and `end` `2026-09-26T04:59:59.999Z`.
2. Chicago CST: `('2026-12-10', '2026-12-10', ...)` gives
   `2026-12-10T06:00:00.000Z` and `2026-12-11T05:59:59.999Z`.
3. DST end day: `('2026-11-01', '2026-11-01', ...)` gives
   `2026-11-01T05:00:00.000Z` and `2026-11-02T05:59:59.999Z` (25 h).
4. Multi-day range: `('2026-09-21', '2026-09-27', ...)` gives
   `2026-09-21T05:00:00.000Z` and `2026-09-28T04:59:59.999Z`.
5. `UTC`: `start` and `end` are UTC midnight and `23:59:59.999Z`.
6. An invalid zone gives the same result as `America/Chicago`.
7. Month end: `endYmd` `2026-09-30` rolls to `2026-10-01` midnight.

Code:
- Add a private `nextYmd(ymd)` with `Date.UTC` string math.
- Add `restaurantDayBounds(startYmd, endYmd, timeZone)`. Use
  `zonedNaiveToUtc` from `./timezone.ts`.
- Add the guard comment: compare the outputs as instants, or read them with
  `ymdInTimeZone`.

## Task 2 — `scheduleOverview.ts`

Files:
- `supabase/functions/_shared/scheduleOverview.ts` (new)
- `tests/unit/scheduleOverview.test.ts` (new)

Tests first:
1. `groupShiftsByRestaurantDay`: a shift at `2026-09-26T02:00:00Z` (Friday
   21:00 CDT) groups under `2026-09-25`.
2. A shift at `2026-09-27T03:00:00Z` (Saturday 22:00 CDT) groups under
   `2026-09-26`.
3. A `UTC` restaurant groups `2026-09-26T02:00:00Z` under `2026-09-26`.
4. The row shape is exact: `id`, `employee_name`, `position`, `start_time`,
   `end_time`, `status`. The query order stays in each day.
5. A shift with no employee gives the same `employee_name` fallback as the
   current executor.
6. `scheduleOverviewDays('week', undefined, undefined, now)` with the Chicago
   wall clock of `2026-09-25 21:00` gives `2026-09-25`..`2026-10-02`.
7. `scheduleOverviewDays('month', ...)` gives `2026-09-25`..`2026-10-25`.
8. `scheduleOverviewDays('custom', '2026-09-01', '2026-09-07', now)` gives
   the same days as `calculateDateRange`.

Code:
- Move the grouping and the day logic out of `executeGetScheduleOverview`
  (`ai-execute-tool/index.ts:2221-2300`). Keep the same fallbacks.

## Task 3 — `timePunchShifts.ts`

Files:
- `supabase/functions/_shared/timePunchShifts.ts` (new)
- `tests/unit/timePunchShifts.test.ts` (new)

Tests first:
1. A clock-in at `2026-09-26T02:00:00Z` and a clock-out at
   `2026-09-26T08:00:00Z` give one row with `date` `2026-09-25` and
   `hours` 6.
2. A clock-in before `bounds.start` is dropped.
3. A clock-in after `bounds.end` is dropped.
4. An overnight shift that ends after `bounds.end` is kept.
5. A period with `hours < minHours` is dropped. A break period is dropped.
6. An hourly employee gets `cost_cents` = `hourly_rate × hours` from the
   snapshot of the restaurant day. Test a pay change on `2026-09-26`. The
   Friday-night shift must use the old rate.
7. A salary or contractor employee gets `cost_cents` `null`.
8. The fields match the current `Shift` type in `executeGetTimePunches`.

Code:
- Group punches by `employee_id`. Call `parseWorkPeriods` for each group.
- Filter with `bounds`, the break flag and `minHours`.
- Use `getEmployeeSnapshotForDate(employee, ymd)` for the cost.
- Do not call `calculateHoursPerEmployee`.

## Task 4 — Wire the executors

File: `supabase/functions/ai-execute-tool/index.ts`

1. Dispatcher (`:3707`, `:3710`): pass `restaurantTimeZone` and
   `restaurantNow` to both executors.
2. `executeGetScheduleOverview`:
   - Get the days with `scheduleOverviewDays(..., restaurantNow)`.
   - Get the instants with `restaurantDayBounds`.
   - Query with `.gte`/`.lte` on `start_time` with the instant ISO strings.
   - Group with `groupShiftsByRestaurantDay`.
   - Pass the instants to `calculateScheduledLaborCost`.
   - Keep the output keys the same. Report `start_date` and `end_date` as
     the restaurant `YYYY-MM-DD` days.
3. `executeGetTimePunches`:
   - Get the days with `calculateDateRange(..., restaurantNow)`.
   - Get the instants with `restaurantDayBounds`. Pass them to
     `fetchLaborData`.
   - Build the rows with `buildTimePunchShifts`. Keep the sort, the limit,
     the redaction and the output shape.
4. Remove imports that become unused (`toLocalYMD`, `formatDateLocal`,
   `laborServerNow`) only if no other caller in the file uses them.

## Task 5 — Verify

- `npm run test:tz` (Chicago, Auckland, UTC).
- `npm run typecheck` and `npm run lint`.
- `deno check supabase/functions/ai-execute-tool/index.ts` if Deno is
  installed.

## E2E

Justified exception. The change is inside an edge function with no UI. The
Playwright suite does not drive `ai-execute-tool`. The pure-module tests
cover the day math. The executor only wires the helpers.

## Out of scope

- `get_labor_costs`, `get_payroll_summary` and the `get_kpis` labor block.
- The labor cost engine in `_shared/laborCalculations.ts`.
