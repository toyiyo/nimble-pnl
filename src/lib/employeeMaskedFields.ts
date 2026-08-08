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
