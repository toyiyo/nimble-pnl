/**
 * Maintenance contract: every bare token must be a real column on `employees`
 * in production, and every joined resource must use PostgREST's
 * `<alias>:<table>(<cols>)` embed form so the FK resolves instead of being
 * read as a bare column. The embed columns must stay in sync with the fields
 * consumed by `resolveCompensationForDate` in `_shared/laborCalculations.ts`.
 */
export const EMPLOYEE_LABOR_COLUMNS =
  'id, name, position, status, restaurant_id, compensation_type, ' +
  'hourly_rate, salary_amount, pay_period_type, ' +
  'contractor_payment_amount, contractor_payment_interval, ' +
  'daily_rate_amount, hire_date, termination_date, ' +
  'compensation_history:employee_compensation_history(' +
  'effective_date,compensation_type,amount_cents,pay_period_type)';
