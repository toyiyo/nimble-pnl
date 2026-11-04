/**
 * The read path for employee rows in the labor code that runs as the caller.
 *
 * 20260806110000_employee_column_gating.sql revokes SELECT on the pay and
 * contact columns of public.employees from authenticated. A caller-JWT read
 * that names one of them fails with "permission denied for column
 * hourly_rate". The employees_secure view returns those columns, masked to
 * NULL unless the caller holds view:pay_rates (or the row is their own).
 */
export const EMPLOYEE_LABOR_SOURCE = 'employees_secure';

/**
 * Maintenance contract: every bare token must be a real column on
 * `employees_secure` in production, and every joined resource must use
 * PostgREST's `<alias>:<table>(<cols>)` embed form so the FK resolves instead
 * of being read as a bare column. The embed columns must stay in sync with the
 * fields consumed by `resolveCompensationForDate` in
 * `_shared/laborCalculations.ts`.
 */
export const EMPLOYEE_LABOR_COLUMNS =
  'id, name, position, status, restaurant_id, compensation_type, ' +
  'hourly_rate, salary_amount, pay_period_type, ' +
  'contractor_payment_amount, contractor_payment_interval, ' +
  'daily_rate_amount, hire_date, termination_date, ' +
  'compensation_history:employee_compensation_history(' +
  'effective_date,compensation_type,amount_cents,pay_period_type)';
