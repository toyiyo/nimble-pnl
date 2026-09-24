# Plan: one labor engine for the app and the AI chat

Design: `docs/superpowers/specs/2026-09-24-single-labor-engine-design.md`

Precondition: [toyiyo/nimble-pnl#806](https://github.com/toyiyo/nimble-pnl/pull/806)
is merged (2026-09-24). PR 2 uses its `fetchLaborEmployees`, `hasPayRatesCapability` and
`pay_hidden` helpers.

Rules for every task:

- Write the test first. See it fail. Then write the code.
- Use fixed UTC instants in tests. Each changed test passes under
  `npm run test:tz` (Chicago, Auckland, UTC).
- Stage explicit paths only. Never `git add -A`.
- A pure move (`git mv` plus a shim) gets its own commit, so review sees the
  move and the logic change apart.

## PR 1: the engine moves, the loaders, the pages

### Task 1: check the client type

1. Write a type-only test file that passes the typed browser client
   (`src/integrations/supabase/client.ts`) to a function that takes the
   structural `LaborQueryClient`.
2. Run `npm run typecheck`. If it fails, use a page-callback parameter
   (`(from, to) => query`), as `fetchAllRows` does, and record the choice in
   the design.

### Task 2: move the leaf modules

Files: `dateConfig`, `dateOnly`, `restaurantClock`, `overtimeCalculations`,
`fetchAllRows`, `openShiftPunches`, `tipAggregation`, `combineCosts`
(`resolveLaborBasis`), `calculateShiftHours` (new `shiftHours.ts`).

1. `git mv` each file into `supabase/functions/_shared/labor/`. Leave a shim
   at the old `src/` path (`export * from '...'`). Change the imports to
   relative `.ts` paths.
2. Add the type-only `env` declaration to the moved `restaurantClock.ts`.
   Keep the literal `import.meta.env` token.
3. Make `_shared/dateOnly.ts` re-export `toDateOnlyString` from the moved
   file.
4. Add `date-fns` and `date-fns/` to `supabase/functions/deno.json`.
5. Add the import-rules test for `_shared/labor/`.
6. Run the full unit suite and `npm run typecheck`. Commit (move only).

### Task 3: move the engine modules and the types

Files: `compensationCalculations`, `payrollCalculations`, `punchWindow`,
`laborCalculations`, `tipsFetch`; new `_shared/labor/types.ts`.

1. Add `types.ts`: `LaborEmployee`, `LaborShift`, `LaborTimePunch`,
   `LABOR_EMPLOYEE_KEYS` (`satisfies`), and the output types the UI uses.
   `src/types/*` re-exports the output types.
2. `git mv` the five files, leave shims, change imports. Make the functions
   that return their input employee generic.
3. `tipsFetch.ts` takes the structural client (Task 1).
4. Run the full unit suite and `npm run typecheck`. Commit (move only).

### Task 4: guardrails

1. Add `supabase/functions/_shared/labor/**/*.ts` to the ESLint timezone
   block and the `.limit(10000)` rule. Ignore the moved `restaurantClock.ts`
   and `dateOnly.ts`.
2. Extend `tests/unit/highVolumeQueryGuard.test.ts` to walk `_shared/labor/`
   and accept `./fetchAllRows.ts`.
3. Add `supabase/functions/_shared/labor` to `sonar.sources`.
4. Run `npm run lint` on the changed paths and the guard test. Commit.

### Task 5: `firstInstantOfDay` and the DST-safe window

1. Tests: Santiago `2026-09-06` starts at `04:00Z`; Santiago `2026-04-04`
   ends at `2026-04-05T03:59:59.999Z`; Chicago and Auckland days are
   unchanged; an invalid zone falls back to the default.
2. Implement `firstInstantOfDay` and change `businessDayRangeToInstants` to
   `start = firstInstantOfDay(startDay)`,
   `end = firstInstantOfDay(dayAfter(endDay)) - 1 ms`.
3. Run `tests/unit/restaurantClock.test.ts` and `businessDayParity.test.ts`.
   Commit.

### Task 6: host-independent engine

1. Run the audit pattern from the design over `_shared/labor/`. Record each
   match as instant (change) or day token (keep) in the commit message.
2. Tests (all three hosts): a Sunday 20:00 CDT clock-in is in the Chicago OT
   week; a deactivation at 23:30 Chicago on a Sunday keeps the right payroll
   week; anomaly messages show restaurant-local times.
3. Change the sites from the design: `laborCalculations.ts:898-899`,
   `:918-919`, `:962-963`; `punchWindow.ts:66-88`;
   `payrollCalculations.ts:687-688` and the anomaly `format` calls;
   `compensationCalculations.ts:249`; the `created_at` tie-break in
   `getSortedHistory`.
4. Change `tests/unit/useLaborCostsFromTimeTracking.fetchRange.test.ts` to
   restaurant-local week edges (intended update).
5. Run the full suite under `npm run test:tz`. Commit.

### Task 7: `loadPeriodLaborCost` and `loadPeriodBankLabor`

1. Tests with a stub client: the fetch windows each query gets (instants
   from day strings), the page loop, tip netting, per-job sum, `throughNow`
   with a given real `now`, `capped`, and a salaried employee over one
   Chicago day and one Auckland day on all three hosts.
2. Move the two `queryFn` bodies into the loaders. The engine gets day
   tokens (`parseDateOnly`); the queries get instants. Use the names
   `dayStart` / `dayEnd` and `windowStart` / `windowEnd`.
3. The hooks call the loaders and keep every React Query option. The hook
   reads `new Date()` inside `queryFn`.
4. Hook tests: a `dateTo` at Sunday midnight and a `dateFrom` in the middle
   of a day give whole-day results.
5. Run the full suite under `npm run test:tz`. Commit.

### Task 8: `loadPeriodLaborBasis`

1. Test: for the same rows, `loadPeriodLaborBasis` equals the
   `totalLaborCost` and `laborBasis` of `useCostsFromSource`.
2. Implement it over the two loaders with `resolveLaborBasis`.
3. Commit.

### Task 9: `loadPayrollPeriod`

1. Tests: the seven source reads page; `employeeId: null` throws; `capped`
   comes back; the punch select names its columns.
2. Move the `usePayroll` body. The hook does not call the loader for a
   `null` employee id and keeps its query key segment.
3. Run the payroll tests under `npm run test:tz`. Commit.

### Task 10: `loadScheduledLaborCost`

1. Test: all employees (`status: 'all'`), Monday week window, shift day by
   the restaurant timezone.
2. Implement it. `useScheduledLaborCosts` keeps its inputs; the Scheduling
   page result does not change.
3. Commit.

### Task 11: verify PR 1

1. Run `npm run test`, `npm run test:tz`, `npm run lint`, `npm run
   typecheck`, `npm run build`.
2. Measure the `year` fixture (100 employees, 20000 punches) through
   `loadPeriodLaborCost` and record the time.
3. Ask a person with the Supabase CLI for a `supabase functions serve`
   smoke check. Deno is not in CI.

## PR 2: the AI tools use the shared engine

### Task 12: Monday weeks in `calculateDateRange`

1. Tests: `current_week` and `last_week` start on Monday for a Sunday, a
   Monday and a Saturday `now`.
2. Use `WEEK_STARTS_ON` from the moved `dateConfig.ts`.
3. Run `restaurantDate.test.ts` and `ai-tools-date-resolution.test.ts`.
   Commit.

### Task 13: the AI labor tools call the loaders

1. Source-contract tests: `ai-execute-tool` imports the loaders from
   `_shared/labor/`; no `laborServerNow`, no `laborWindowMismatchReason`, no
   `_shared/laborCalculations.ts` import; `get_schedule_overview` has no
   `status = 'active'` filter and no own week branch.
2. Wire each tool as in the design's Layer 4 table. Keep the capability
   gate and the #806 pay gate. `get_labor_costs` returns `daily_costs`,
   `breakdown` and `total_labor_cost`, and its description names the
   figures.
3. Delete `laborServerNow`, `laborWindowMismatchReason`, their tests and the
   `get_kpis` mismatch gate.
4. Run the AI tests. Commit.

### Task 14: delete the Deno copy

1. Delete `supabase/functions/_shared/laborCalculations.ts`. Update
   `tests/unit/punchWindow.test.ts:55` and `employeeLaborColumns.test.ts`
   (check against `LABOR_EMPLOYEE_KEYS`).
2. Extend `EMPLOYEE_LABOR_COLUMNS` to the engine keys plus the history
   `created_at`.
3. Run the full suite. Commit.

### Task 15: verify PR 2

1. Run `npm run test`, `npm run test:tz`, `npm run lint`, `npm run
   typecheck`.
2. Ask for a `supabase functions serve ai-execute-tool` smoke check.
