# Plan: AI labor tools read employees through `employees_secure`

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

## Task 3: the pay-hidden helper

Files: new `supabase/functions/_shared/payHidden.ts` (pure),
new `tests/unit/payHidden.test.ts`.

1. Add tests:
   - `PAY_HIDDEN_REASON` is the text in the design.
   - `redactLaborCostBreakdown(breakdown)` keeps the hours and the employee
     and day counts, and sets each `cost` and `total` to `null`.
   - `redactDailyCosts(days)` keeps `date` and `hours_worked`, and sets each
     money field to `null`.
2. Implement them.
3. Run the tests. Commit.

## Task 4: `ai-execute-tool` reads and gates

Files: `supabase/functions/ai-execute-tool/index.ts`,
new `tests/unit/aiLaborEmployeeReads.test.ts`.

1. Add the source-contract tests from the design: no `.from('employees')`;
   no `employees(*)`; no `employees(` embed that names a field of
   `PAY_RATE_FIELDS` or `EMPLOYEE_PII_FIELDS`; `fetchLaborEmployees` reads
   `EMPLOYEE_LABOR_SOURCE`; each of the five labor executors calls
   `hasPayRatesCapability`.
2. Add `fetchLaborEmployees`. Change the five reads to use it. Change the
   shift embed to `employee:employees(id, name, position)`.
3. Add the `view:pay_rates` gate to each executor, as the design says.
   `get_kpis` passes `hasLaborCapability && hasPayRates` to
   `redactLaborFields`, and sets the pay-rates reason when only the pay
   flag is missing.
4. Run the new test, `tests/unit/employeeEmbedsNarrowed.test.ts`,
   `tests/unit/tools-registry.test.ts`, `tests/unit/periodMetrics.test.ts`,
   and `npm run typecheck`. Commit.

## Task 5: verify

1. Run `npm run test`, `npm run lint`, `npm run typecheck`.
2. Run `npm run test:tz` for the changed test files.
