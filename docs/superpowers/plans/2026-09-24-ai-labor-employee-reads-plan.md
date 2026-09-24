# Plan: AI labor tools and AI schedule read employees through `employees_secure`

Design: `docs/superpowers/specs/2026-09-24-ai-labor-employee-reads-design.md`

Rules for every task:

- Write the test first. See it fail. Then write the code.
- Stage explicit paths only. Never `git add -A`.

## Task 1: the employee source

Files: `supabase/functions/_shared/employeeLaborColumns.ts`,
`tests/unit/employeeLaborColumns.test.ts`.

1. Add a test: `EMPLOYEE_LABOR_SOURCE` is `'employees_secure'`.
2. Export `EMPLOYEE_LABOR_SOURCE`. Update the file comment: the columns are
   read from the view, not from the base table.
3. Run the test. Commit.

## Task 2: `hasPayRatesCapability`

Files: `supabase/functions/_shared/tools-registry.ts`,
`tests/unit/tools-registry.test.ts`.

1. Add tests with a stub `rpc`: true, false, an `error` result (false and a
   log), and a rejected promise (false and a log). Check the RPC gets
   `p_capability: 'view:pay_rates'`.
2. Implement it next to `hasSchedulingOrPayrollCapability`, with the same
   fail-closed pattern.
3. Run the tests. Commit.

## Task 3: the pay-hidden helpers

Files: new `supabase/functions/_shared/payHidden.ts` (pure),
new `tests/unit/payHidden.test.ts`, `supabase/functions/_shared/periodMetrics.ts`,
`tests/unit/periodMetrics.test.ts`.

1. Add tests, one per row of the design's field table, for a Chef-shaped
   caller (scheduling true, pay rates false):
   - `PAY_HIDDEN_REASON` is the text in the design.
   - `redactLaborCostsResult` (get_labor_costs), `redactTimePunchShifts`
     (get_time_punches) and `redactPayrollSummary` (get_payroll_summary) set
     the listed fields to `null`, keep the listed fields, and add
     `pay_hidden`.
   - `total_payroll` is `null`, never tips plus manual payments.
   - `redactLaborFields(metrics, false, reason)` uses the given reason. Without
     a reason it keeps the current text.
2. Implement them.
3. Run the tests. Commit.

## Task 4: `ai-execute-tool` reads and gates

Files: `supabase/functions/ai-execute-tool/index.ts`,
new `tests/unit/aiLaborEmployeeReads.test.ts`.

1. Add the source-contract tests from the design: no `.from('employees')`;
   no `employees(*)`; no `employees(` embed that names one of the eight
   revoked columns; `fetchLaborEmployees` reads `EMPLOYEE_LABOR_SOURCE`;
   each of the five labor executors calls `hasPayRatesCapability`.
2. Add `fetchLaborEmployees`. Change the five reads to use it. Change the
   shift embed to `employee:employees(id, name, position)`.
3. Add the `view:pay_rates` gate to each executor with the Task 3 helpers.
   `get_kpis`: AND the pay flag into `hasLaborAccess`; pick the reason in
   the order pay flag, capability, day mismatch. `get_schedule_overview`:
   skip `calculateScheduledLaborCost` without the flag.
4. Run the new test, `tests/unit/employeeEmbedsNarrowed.test.ts`,
   `tests/unit/tools-registry.test.ts`, `tests/unit/periodMetrics.test.ts`,
   `tests/unit/ai-restaurant-today-wiring.test.ts` and `npm run typecheck`.
   Commit.

## Task 5: tool descriptions

Files: `supabase/functions/_shared/tools-registry.ts`,
`tests/unit/tools-registry.test.ts`.

1. Add a test: the descriptions of `get_kpis`, `get_labor_costs`,
   `get_schedule_overview`, `get_time_punches` and `get_payroll_summary`
   mention `pay_hidden`.
2. Add the sentence from the design to each description.
3. Run the test. Commit.

## Task 6: `generate-schedule`

Files: `supabase/functions/generate-schedule/index.ts`,
`supabase/functions/_shared/schedule-prompt-builder.ts`,
`tests/unit/schedule-hour-budget.test.ts`,
`tests/unit/aiLaborEmployeeReads.test.ts`.

1. Add tests: `computeHourBudget(null, weekStart, true)` gives
   `{ is_minor: true, max_weekly_hours: 18 }`; with `false` or no third
   argument it keeps the current result. The source contract covers
   `generate-schedule/index.ts` (no `.from("employees")`).
2. Add the optional `isMinorFallback` argument. Read `employees_secure` with
   the current columns plus `is_minor`, and pass `e.is_minor`.
3. Run the tests under `npm run test:tz`. Commit.

## Task 7: verify

1. Run `npm run test`, `npm run lint`, `npm run typecheck`.
2. Run `npm run test:tz` for the changed test files.
