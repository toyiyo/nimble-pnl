/**
 * The eight columns of public.employees that 20260806110000 masks.
 *
 * The masking view returns NULL for a column the caller has no flag for. The
 * Edit Employee form then loads that NULL into its state and writes it back on
 * save. The column keeps its UPDATE grant, so the write succeeds and the real
 * value is gone.
 *
 * The strip below is the fix. It runs in the mutation hooks, not in the form:
 * four call sites write employees (EmployeeDialog, ShiftImportSheet,
 * TimePunchUploadSheet, useSlingEmployeeMapping), and a per-field gate in one
 * component protects one of them.
 */

/** Masked by view:pay_rates. */
export const PAY_RATE_FIELDS = [
  'hourly_rate',
  'salary_amount',
  'contractor_payment_amount',
  'daily_rate_amount',
  'daily_rate_reference_weekly',
] as const;

/** Masked by view:employee_pii. */
export const EMPLOYEE_PII_FIELDS = [
  'email',
  'phone',
  'date_of_birth',
] as const;

export type MaskedEmployeeField =
  | (typeof PAY_RATE_FIELDS)[number]
  | (typeof EMPLOYEE_PII_FIELDS)[number];

/** Which fields the caller may not read, and therefore may not write. */
export function maskedEmployeeFields(held: {
  payRates: boolean;
  employeePii: boolean;
}): MaskedEmployeeField[] {
  const masked: MaskedEmployeeField[] = [];
  if (!held.payRates) masked.push(...PAY_RATE_FIELDS);
  if (!held.employeePii) masked.push(...EMPLOYEE_PII_FIELDS);
  return masked;
}

/** Remove every masked key. Returns a new object. */
export function stripMaskedEmployeeFields<T extends object>(
  payload: T,
  masked: readonly MaskedEmployeeField[]
): T {
  if (masked.length === 0) return { ...payload };

  const blocked = new Set<string>(masked);
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(payload)) {
    if (!blocked.has(key)) result[key] = value;
  }

  return result as T;
}

/**
 * The columns an `employee:employees(...)` resource embed may ask for.
 *
 * A PostgREST resource embed resolves against the base table, not
 * employees_secure (20260806110000). `employees(*)` would ask for the eight
 * masked columns and fail with "permission denied for column hourly_rate".
 * Every embed lists only the columns its consumer reads (useShifts,
 * useTimeOffRequests, useScheduleChangeLogs).
 */
export const EMPLOYEE_EMBED_COLUMNS =
  'id, name, position, area, status, is_active, employment_type, user_id';

/** The pay fields `isCompensationHidden` reads, one per compensation type. */
export interface CompensationPayFields {
  compensation_type?: string | null;
  hourly_rate?: number | null;
  salary_amount?: number | null;
  daily_rate_amount?: number | null;
  contractor_payment_amount?: number | null;
}

/**
 * True when the pay field for this employee's own compensation type is
 * masked (null or undefined). `employees_secure` returns null for a pay
 * column the caller cannot see, and a null rate must read as "unknown," not
 * as a real $0.
 *
 * One shared check for the three call sites that render or total pay:
 * `useEmployeeLaborCosts`, `useMonthlyMetrics` (`labor_cost_hidden`), and
 * `EmployeeList` (`getCompensationDisplay`).
 */
export function isCompensationHidden(employee: CompensationPayFields): boolean {
  const compensationType = employee.compensation_type ?? 'hourly';
  switch (compensationType) {
    case 'hourly':
      return employee.hourly_rate === null || employee.hourly_rate === undefined;
    case 'salary':
      return employee.salary_amount === null || employee.salary_amount === undefined;
    case 'daily_rate':
      return employee.daily_rate_amount === null || employee.daily_rate_amount === undefined;
    case 'contractor':
      return employee.contractor_payment_amount === null || employee.contractor_payment_amount === undefined;
    default:
      return false;
  }
}

/**
 * Throw when permissions are still loading. An unresolved `isResolved`
 * would otherwise read as "no flags" and strip every pay and contact field
 * from the write — a silent partial write, not the explicit retry this
 * gives the caller.
 */
export function assertPermissionsResolved(isResolved: boolean): void {
  if (!isResolved) {
    throw new Error('Permissions are still loading. Try again in a moment.');
  }
}
