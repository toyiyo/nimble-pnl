# Plan: AI labor tools use restaurant-local days

Design: `docs/superpowers/specs/2026-09-24-ai-labor-restaurant-day-design.md`

Rules for every task:

- Use fixed UTC instants in tests (`new Date('2026-09-25T01:00:00Z')`).
- Each new test must pass under `npm run test:tz` (Chicago, Auckland, UTC).
- Write the test first. See it fail. Then write the code.
- Stage explicit paths only. Never `git add -A`.

## Task 1: `safeTz` validity cache

Files: `supabase/functions/_shared/timezone.ts`, `tests/unit/edgeTimezone.test.ts`.

1. Add a test: `safeTz` returns the same zone on a second call, and still
   falls back for an invalid zone after a valid one.
2. Add a module-level `Set<string>` of zones that passed the check. Return
   early on a hit.
3. Run the `safeTz` tests. Commit.

## Task 2: `restaurantDayBoundsUtc`, delete the labor server clock

Files: `supabase/functions/_shared/restaurantDate.ts`,
`tests/unit/restaurantDate.test.ts`.

1. Add tests for `restaurantDayBoundsUtc(startDay, endDay, tz)`:
   - Chicago CDT `2026-09-24`: start `2026-09-24T05:00:00.000Z`, end
     `2026-09-25T04:59:59.999Z`.
   - Chicago CST `2026-01-15`: start `06:00Z`.
   - Auckland `2026-09-25`: start `2026-09-24T12:00:00.000Z`.
   - Chicago `2026-03-08` (DST, 23 hours): `end - start + 1 ms` is 23 h.
   - A multi-day range and an invalid zone (falls back to Chicago).
2. Implement it with `zonedNaiveToUtc`, next midnight minus 1 ms.
3. Delete `laborServerNow`, `laborWindowMismatchReason` and their tests.
   Update the `calculateDateRange` JSDoc.
4. Do not commit yet: `ai-execute-tool` still imports the two functions.
   Commit together with Task 5.

## Task 3: Deno engine day bucketing

Files: `supabase/functions/_shared/laborCalculations.ts`,
new `tests/unit/laborCalculations.edge.test.ts`.

1. Write the tests from the design ("Tests" section) that import
   `supabase/functions/_shared/laborCalculations.ts`:
   Chicago evening clock-in, Auckland morning clock-in, overnight daily
   rate, instant-window filter of `calculateHoursPerEmployee`, evening
   shift in `calculateScheduledLaborCost`.
2. Add a required `timezone` argument to `calculateActualLaborCost`,
   `calculateHoursPerEmployee` and `calculateScheduledLaborCost`.
3. Add a private `businessDaysBetween(startInstant, endInstant, tz)` that
   steps on day strings. Use `ymdInTimeZone` for the day of an instant.
4. `calculateHoursPerEmployee`: convert the instant bounds to business days
   for the salary and contractor loops.
5. Update the JSDoc of each function: state which arguments are
   calendar-day Dates and which are instants.
6. Run the new tests under `npm run test:tz`. Commit with Task 4 if the
   file does not type-check alone.

## Task 4: host-independent salary and contractor loops

Files: `supabase/functions/_shared/laborCalculations.ts`,
`tests/unit/laborCalculations.edge.test.ts`.

1. Add tests: one restaurant day of salary is one daily allocation on every
   host. A `hire_date` on the last day of the range counts that day only.
2. Change `calculateSalaryForPeriod` and `calculateContractorPayForPeriod`
   to walk `generateDateRange` strings and to compare `hire_date` /
   `termination_date` as `YYYY-MM-DD` strings.
3. Run the tests under `npm run test:tz`. Commit Tasks 3 and 4.

## Task 5: `ai-execute-tool` labor wiring

Files: `supabase/functions/ai-execute-tool/index.ts`,
`tests/unit/ai-restaurant-today-wiring.test.ts`.

1. Add source-contract tests: no `laborServerNow`, no
   `laborWindowMismatchReason`; every `calculateActualLaborCost(`,
   `calculateHoursPerEmployee(` and `calculateScheduledLaborCost(` call
   passes the timezone; the labor fetches use `restaurantDayBoundsUtc`; no
   `formatDateLocal(new Date(p.startTime))` and no
   `toLocalYMD(new Date(shift.start_time))`.
2. Pass `restaurantTimeZone` from the `serve` handler to `executeGetKpis`,
   `executeGetLaborCosts`, `executeGetTimePunches`,
   `executeGetScheduleOverview`, `executeGetPayrollSummary`, and through
   `executeGetAiInsights` to `executeGetKpis`.
3. `executeGetKpis`: delete `laborRange` and the mismatch check. Use the
   sales range and its instant bounds.
4. `fetchLaborData`: take the instant window.
5. `executeGetTimePunches`: shift `date` from `ymdInTimeZone`.
6. `executeGetScheduleOverview`: use `restaurantNow`, instant bounds of
   `[startDateStr, endDateStr]`, and `ymdInTimeZone` for the group key.
7. Run `npm run typecheck`, the wiring test, and `restaurantDate.test.ts`.
   Commit Tasks 2 and 5.

## Task 6: parity with the frontend engine

Files: `tests/unit/laborCalculations.edge.test.ts`.

1. Add a test: the Deno and the `src/services/laborCalculations.ts`
   `calculateActualLaborCost` give the same `dailyCosts` for the same
   punches, dates and timezone (Chicago and Auckland; hourly, daily rate
   and salary employees).
2. Run under `npm run test:tz`. Commit.

## Task 7: docs

Files: the earlier design doc
`docs/superpowers/specs/2026-09-24-ai-chat-restaurant-today-design.md`.

1. Add a note under "Decided trade-offs": a later change moves the labor
   paths to restaurant days. Link the new design doc.
2. Commit.
