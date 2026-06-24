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
  if (row.compensationType === 'daily_rate') return row.dailyRatePay + row.manualPaymentsTotal;
  return row.contractorPay + row.manualPaymentsTotal; // contractor / per-job
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

export type PayrollGroupMode = 'none' | 'area' | 'position';

export interface PayrollGroup {
  key: string;   // stable, non-empty id (used for collapse Set + DOM aria)
  label: string; // display label ('' for the 'none' group)
  rows: EmployeePayroll[];
}

/** Sentinel key used in the internal map for null/blank group values. */
const UNASSIGNED_BUCKET_KEY = '__unassigned__';
/** Display label for the null/blank bucket. */
export const UNASSIGNED_LABEL = 'Unassigned';

/**
 * Buckets already-sorted rows into groups, preserving input order within each
 * group. Groups are ordered alphabetically by label with Unassigned last —
 * matching src/lib/scheduleGrouping.ts so the same data groups identically on
 * the schedule grid and the payroll table. 'none' returns one unlabeled group.
 *
 * The null/blank bucket always gets key === UNASSIGNED_BUCKET_KEY ('__unassigned__')
 * so it never collides with a real area or position literally named "Unassigned".
 */
export function groupPayrollRows(
  rows: EmployeePayroll[],
  mode: PayrollGroupMode,
): PayrollGroup[] {
  if (mode === 'none') {
    return [{ key: 'all', label: '', rows: [...rows] }];
  }

  const map = new Map<string, EmployeePayroll[]>();
  for (const r of rows) {
    const raw = (mode === 'area' ? r.area : r.position) || '';
    const key = raw.trim() || UNASSIGNED_BUCKET_KEY;
    const bucket = map.get(key);
    if (bucket) bucket.push(r);
    else map.set(key, [r]);
  }

  const keys = Array.from(map.keys()).sort((a, b) => {
    if (a === UNASSIGNED_BUCKET_KEY) return 1;
    if (b === UNASSIGNED_BUCKET_KEY) return -1;
    return a.localeCompare(b);
  });

  return keys.map((key) => ({
    key, // stable, non-empty, never collides with real data
    label: key === UNASSIGNED_BUCKET_KEY ? UNASSIGNED_LABEL : key,
    rows: map.get(key) ?? [],
  }));
}

/**
 * Aggregated totals returned by computePayrollTotals.
 * Used for per-group subtotal rows and the grand TOTAL row.
 */
export interface PayrollTotals {
  regularHours: number;
  overtimeHours: number;
  /** Σ(regularPay + salaryPay + contractorPay + manualPaymentsTotal) — matches Payroll.tsx grand-total formula */
  regularPay: number;
  overtimePay: number;
  totalTips: number;
  tipsPaidOut: number;
  tipsOwed: number;
  /** Σ(totalPay) = Σ(grossPay + tipsOwed) — matches Payroll.tsx line 675 */
  totalPay: number;
}

/**
 * Aggregate a set of payroll rows into totals.
 * Formulas are pinned equal to the legacy grand-total row in Payroll.tsx so
 * per-group subtotals and the grand total are provably behavior-preserving.
 *
 * regularPay = Σ(regularPay + salaryPay + contractorPay + manualPaymentsTotal)
 * overtimePay = Σ(overtimePay)
 * totalPay = Σ(totalPay)  [= Σ(grossPay + tipsOwed) per employee]
 * Hours and tips are straight sums.
 */
export function computePayrollTotals(rows: EmployeePayroll[]): PayrollTotals {
  return rows.reduce<PayrollTotals>((acc, r) => ({
    regularHours: acc.regularHours + r.regularHours,
    overtimeHours: acc.overtimeHours + r.overtimeHours,
    regularPay: acc.regularPay + r.regularPay + r.salaryPay + r.contractorPay + r.manualPaymentsTotal,
    overtimePay: acc.overtimePay + r.overtimePay,
    totalTips: acc.totalTips + r.totalTips,
    tipsPaidOut: acc.tipsPaidOut + r.tipsPaidOut,
    tipsOwed: acc.tipsOwed + r.tipsOwed,
    totalPay: acc.totalPay + r.totalPay,
  }), { regularHours: 0, overtimeHours: 0, regularPay: 0, overtimePay: 0, totalTips: 0, tipsPaidOut: 0, tipsOwed: 0, totalPay: 0 });
}
