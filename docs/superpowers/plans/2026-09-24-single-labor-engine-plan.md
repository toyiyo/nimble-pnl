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

1. Add tests for `dayAfterYmd` (month end, year end, Feb 28 2026),
   `ymdToLocalDate` (local fields equal the day on every host), and
   `firstInstantOfDay` (Santiago `2026-09-06` is `04:00Z`).
   Add tests for `restaurantDayBoundsUtc(startDay, endDay, tz)`:
   - Chicago CDT `2026-09-24`: start `2026-09-24T05:00:00.000Z`, end
     `2026-09-25T04:59:59.999Z`.
   - Chicago CST `2026-01-15`: start `06:00Z`.
   - Auckland `2026-09-25`: start `2026-09-24T12:00:00.000Z`.
   - Chicago `2026-03-08` (DST, 23 hours): `end - start + 1 ms` is 23 h.
   - Santiago `2026-09-05`: end `2026-09-06T03:59:59.999Z`.
   - A multi-day range and an invalid zone (falls back to Chicago).
2. Implement `dayAfterYmd`, `ymdToLocalDate`, `firstInstantOfDay` (guess
   with `zonedNaiveToUtc`, check, binary search on whole minutes in
   ±12 h on a failed check) and `restaurantDayBoundsUtc`.
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
   steps on day strings, with an early return for a one-day interval. Use
   `ymdInTimeZone` for the day of an instant.
4. `calculateHoursPerEmployee`: give the salary and contractor loops
   `ymdToLocalDate(ymdInTimeZone(bound, tz))` for each instant bound.
5. Update the JSDoc of each function: state which arguments are
   calendar-day Dates and which are instants.
6. Run the new tests under `npm run test:tz`. Commit with Task 4 if the
   file does not type-check alone.

## Task 4: host-independent salary and contractor loops

Files: `supabase/functions/_shared/laborCalculations.ts`,
`tests/unit/laborCalculations.edge.test.ts`.

1. Add tests: one restaurant day of salary is one daily allocation on every
   host. A one-day instant window in `calculateHoursPerEmployee` gives one
   day of salary on every host. A `hire_date` on the last day of the range counts that day only.
2. Change `calculateSalaryForPeriod` and `calculateContractorPayForPeriod`
   to walk `generateDateRange` strings and to compare `hire_date` /
   `termination_date` as `YYYY-MM-DD` strings.
3. Run the tests under `npm run test:tz`. Commit Tasks 3 and 4.

## Task 5: `ai-execute-tool` labor wiring

Files: `supabase/functions/ai-execute-tool/index.ts`,
`tests/unit/ai-restaurant-today-wiring.test.ts`.

1. Add source-contract tests: no `laborServerNow`, no
   `laborWindowMismatchReason`; `calculateActualLaborCost(` and
   `calculateScheduledLaborCost(` get `dayStart, dayEnd, restaurantTimeZone`;
   `calculateHoursPerEmployee(` gets `windowStart, windowEnd,
   restaurantTimeZone`; the labor fetches use `restaurantDayBoundsUtc`; no
   literal `endLookaheadHours: 18`; no
   `formatDateLocal(new Date(p.startTime))` and no
   `toLocalYMD(new Date(shift.start_time))`.
2. Pass `restaurantTimeZone` from the `serve` handler to `executeGetKpis`,
   `executeGetLaborCosts`, `executeGetTimePunches`,
   `executeGetScheduleOverview`, `executeGetPayrollSummary`, and through
   `executeGetAiInsights` to `executeGetKpis`.
3. `executeGetKpis`: delete `laborRange`, the mismatch check, the ternary
   at the `laborOmittedReason` line and the mismatch comment. Use the sales
   range and its instant bounds.
4. `fetchLaborData`: take the instant window. Use
   `LABOR_FETCH_LOOKAHEAD_HOURS`, not `18`. Name the pairs `dayStart` /
   `dayEnd` and `windowStart` / `windowEnd` in every labor executor.
5. `executeGetTimePunches`: shift `date` from `ymdInTimeZone`.
6. `executeGetScheduleOverview`: use `restaurantNow`, instant bounds of
   `[startDateStr, endDateStr]`, and `ymdInTimeZone` for the group key.
7. Run `npm run typecheck`, the wiring test, and `restaurantDate.test.ts`.
   Commit Tasks 2 and 5.

## Task 5b: page loop for the punch fetches

Files: new `supabase/functions/_shared/fetchPunchesInWindow.ts` (pure, no
Deno imports), new `tests/unit/fetchPunchesInWindow.test.ts`,
`supabase/functions/ai-execute-tool/index.ts`.

1. Write a test with a stub client: 2500 rows come back in three pages of
   1000, 1000 and 500. An error on page 2 throws. The `restaurant_id`,
   `employee_id` filter and the window are on each page.
2. Implement `fetchPunchesInWindow(supabase, { restaurantId, windowStart,
   windowEnd, columns, employeeId? })`. Order by `punch_time`, then `id`.
   Stop when a page has fewer than 1000 rows.
3. Use it in `executeGetKpis`, `fetchLaborData` and
   `executeGetPayrollSummary`. Add a wiring test: no `.from('time_punches')`
   is left in `ai-execute-tool/index.ts`.
4. Run the tests and `npm run typecheck`. Commit.

## Task 6: parity with the frontend engine

Files: `tests/unit/laborCalculations.edge.test.ts`.

1. Add a test: the Deno and the `src/services/laborCalculations.ts`
   `calculateActualLaborCost` give the same `dailyCosts` for the same
   punches, dates and timezone (Chicago and Auckland; hourly and daily rate
   employees only, no type change, no stale clock-in).
2. Run under `npm run test:tz`. Commit.

## Task 7: docs

Files: the earlier design doc
`docs/superpowers/specs/2026-09-24-ai-chat-restaurant-today-design.md`.

1. Add a note under "Decided trade-offs": a later change moves the labor
   paths to restaurant days. Link the new design doc.
2. Commit.
