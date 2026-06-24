import type { EmployeePayroll } from '@/utils/payrollCalculations';

export type PayrollSortKey =
  | 'name' | 'position' | 'area' | 'rate'
  | 'regularHours' | 'overtimeHours' | 'regularPay' | 'overtimePay'
  | 'totalTips' | 'tipsPaidOut' | 'tipsOwed' | 'totalPay';

export type SortDirection = 'asc' | 'desc';

/**
 * The numeric value the "Regular Pay" cell displays for a row, which depends on
 * compensation type. Shared by the page's cell formatter and the sort comparator
 * so the column sorts by exactly what the user sees.
 */
export function regularPayDisplayValue(row: EmployeePayroll): number {
  if (row.compensationType === 'hourly') return row.regularPay;
  if (row.compensationType === 'salary') return row.salaryPay;
  return row.contractorPay + row.manualPaymentsTotal; // contractor / daily / per-job
}

// String-valued sort keys → accessor. null area sorts as '' (clusters predictably,
// flips with direction). "Unassigned last" is a grouping concern, not a sort one.
const STRING_ACCESSORS: Partial<Record<PayrollSortKey, (r: EmployeePayroll) => string>> = {
  name: (r) => r.employeeName,
  position: (r) => r.position,
  area: (r) => r.area ?? '',
};

// Numeric-valued sort keys → accessor.
// NOTE: "rate" sorts by hourlyRate — the Rate cell is heterogeneous across
// compensation types ($/hr, $/period, "Per-Job"); hourlyRate is the deliberate,
// documented choice covering the hourly majority (see design doc trade-offs).
const NUMBER_ACCESSORS: Partial<Record<PayrollSortKey, (r: EmployeePayroll) => number>> = {
  rate: (r) => r.hourlyRate,
  regularHours: (r) => r.regularHours,
  overtimeHours: (r) => r.overtimeHours,
  regularPay: regularPayDisplayValue,
  overtimePay: (r) => r.overtimePay,
  totalTips: (r) => r.totalTips,
  tipsPaidOut: (r) => r.tipsPaidOut,
  tipsOwed: (r) => r.tipsOwed,
  totalPay: (r) => r.totalPay,
};

/**
 * Returns a new array sorted by the given column. Stable (ties keep input order).
 * Does not mutate the input.
 */
export function sortPayrollRows(
  rows: EmployeePayroll[],
  key: PayrollSortKey,
  dir: SortDirection,
): EmployeePayroll[] {
  const factor = dir === 'asc' ? 1 : -1;
  const stringAccessor = STRING_ACCESSORS[key];
  const numberAccessor = NUMBER_ACCESSORS[key];
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const cmp = stringAccessor
        ? stringAccessor(a.row).localeCompare(stringAccessor(b.row))
        : numberAccessor!(a.row) - numberAccessor!(b.row);
      if (cmp !== 0) return cmp * factor;
      return a.index - b.index; // stable tie-break
    })
    .map((d) => d.row);
}
