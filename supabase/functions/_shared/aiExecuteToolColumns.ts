/**
 * PostgREST projection for the `employees` SELECT used by `ai-execute-tool`'s
 * `fetchLaborData`. Lives in `_shared/` (no Deno imports) so it can be
 * exercised by Vitest unit tests that assert the projection's contract
 * against the actual columns on the `employees` table.
 *
 * The trailing `compensation_history:employee_compensation_history(*)` is a
 * PostgREST embedded-resource alias — it follows the FK
 * `employee_compensation_history.employee_id → employees.id` and returns the
 * related rows as an array under the field name `compensation_history`. This
 * matches the consumer shape expected by `laborCalculations.ts`
 * (`compensation_history?: CompensationHistoryEntry[]`).
 *
 * If you add a new column, it must exist on `employees` in production; if you
 * add a new joined resource, use the same `<alias>:<table>(<cols>)` form so
 * PostgREST resolves the embed instead of trying to read a bare column.
 */
export const EMPLOYEE_LABOR_COLUMNS =
  'id, name, position, status, restaurant_id, compensation_type, ' +
  'hourly_rate, salary_amount, pay_period_type, ' +
  'contractor_payment_amount, contractor_payment_interval, ' +
  'daily_rate_amount, hire_date, termination_date, ' +
  'compensation_history:employee_compensation_history(*)';
