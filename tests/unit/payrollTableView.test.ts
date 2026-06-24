import { describe, it, expect } from 'vitest';
import {
  sortPayrollRows,
  regularPayDisplayValue,
  groupPayrollRows,
  computePayrollTotals,
  UNASSIGNED_LABEL,
  type PayrollSortKey,
  type PayrollGroupMode,
  type PayrollTotals,
} from '@/utils/payrollTableView';
import type { EmployeePayroll } from '@/utils/payrollCalculations';

// Minimal builder — only fields the view layer reads matter; rest are zeroed.
function row(overrides: Partial<EmployeePayroll>): EmployeePayroll {
  return {
    employeeId: 'e', employeeName: '', position: '', area: null,
    compensationType: 'hourly', hourlyRate: 0,
    regularHours: 0, overtimeHours: 0, doubleTimeHours: 0, doubleTimePay: 0,
    dailyOvertimeHours: 0, weeklyOvertimeHours: 0,
    regularPay: 0, overtimePay: 0, salaryPay: 0, contractorPay: 0, dailyRatePay: 0,
    manualPayments: [], manualPaymentsTotal: 0,
    grossPay: 0, totalTips: 0, tipsPaidOut: 0, tipsOwed: 0, totalPay: 0,
    ...overrides,
  };
}

describe('regularPayDisplayValue', () => {
  it('uses regularPay for hourly', () => {
    expect(regularPayDisplayValue(row({ compensationType: 'hourly', regularPay: 500 }))).toBe(500);
  });
  it('uses salaryPay for salary', () => {
    expect(regularPayDisplayValue(row({ compensationType: 'salary', salaryPay: 900 }))).toBe(900);
  });
  it('uses contractorPay + manual for contractor', () => {
    expect(regularPayDisplayValue(row({ compensationType: 'contractor', contractorPay: 700, manualPaymentsTotal: 50 }))).toBe(750);
  });
});

describe('sortPayrollRows', () => {
  it('sorts by name ascending and descending', () => {
    const rows = [row({ employeeName: 'Carol' }), row({ employeeName: 'Alice' }), row({ employeeName: 'Bob' })];
    expect(sortPayrollRows(rows, 'name', 'asc').map(r => r.employeeName)).toEqual(['Alice', 'Bob', 'Carol']);
    expect(sortPayrollRows(rows, 'name', 'desc').map(r => r.employeeName)).toEqual(['Carol', 'Bob', 'Alice']);
  });

  it('sorts numeric columns numerically (not lexically)', () => {
    const rows = [row({ employeeName: 'a', totalPay: 9 }), row({ employeeName: 'b', totalPay: 100 }), row({ employeeName: 'c', totalPay: 20 })];
    expect(sortPayrollRows(rows, 'totalPay', 'asc').map(r => r.totalPay)).toEqual([9, 20, 100]);
  });

  it('sorts the Regular Pay column by the displayed value across comp types', () => {
    const hourly = row({ employeeName: 'h', compensationType: 'hourly', regularPay: 300 });
    const salary = row({ employeeName: 's', compensationType: 'salary', salaryPay: 1000 });
    expect(sortPayrollRows([hourly, salary], 'regularPay', 'asc').map(r => r.employeeName)).toEqual(['h', 's']);
  });

  it('sorts the Rate column by hourlyRate', () => {
    const rows = [row({ employeeName: 'a', hourlyRate: 2500 }), row({ employeeName: 'b', hourlyRate: 1500 })];
    expect(sortPayrollRows(rows, 'rate', 'asc').map(r => r.hourlyRate)).toEqual([1500, 2500]);
  });

  it('treats null area as empty string when sorting the Area column', () => {
    const rows = [row({ employeeName: 'a', area: 'Bar' }), row({ employeeName: 'b', area: null })];
    // null -> '' sorts first ascending
    expect(sortPayrollRows(rows, 'area', 'asc').map(r => r.employeeName)).toEqual(['b', 'a']);
  });

  it('is stable — equal keys keep input order', () => {
    const rows = [row({ employeeName: 'x', position: 'Server' }), row({ employeeName: 'y', position: 'Server' })];
    expect(sortPayrollRows(rows, 'position', 'asc').map(r => r.employeeName)).toEqual(['x', 'y']);
  });

  it('does not mutate the input array', () => {
    const rows = [row({ employeeName: 'b' }), row({ employeeName: 'a' })];
    const snapshot = rows.map(r => r.employeeName);
    sortPayrollRows(rows, 'name', 'asc');
    expect(rows.map(r => r.employeeName)).toEqual(snapshot);
  });
});

describe('groupPayrollRows', () => {
  it('none → a single group containing all rows in input order', () => {
    const rows = [row({ employeeName: 'b' }), row({ employeeName: 'a' })];
    const groups = groupPayrollRows(rows, 'none');
    expect(groups).toHaveLength(1);
    expect(groups[0].rows.map(r => r.employeeName)).toEqual(['b', 'a']);
  });

  it('groups by area, alphabetically, Unassigned last', () => {
    const rows = [
      row({ employeeName: 'a', area: 'Front of House' }),
      row({ employeeName: 'b', area: 'Bar' }),
      row({ employeeName: 'c', area: null }),
      row({ employeeName: 'd', area: 'Bar' }),
    ];
    const groups = groupPayrollRows(rows, 'area');
    expect(groups.map(g => g.label)).toEqual(['Bar', 'Front of House', UNASSIGNED_LABEL]);
    expect(groups[0].rows.map(r => r.employeeName)).toEqual(['b', 'd']);
    expect(groups[2].label).toBe(UNASSIGNED_LABEL);
  });

  it('preserves the incoming (already-sorted) order within each group', () => {
    const rows = [
      row({ employeeName: 'Zoe', area: 'Bar' }),
      row({ employeeName: 'Amy', area: 'Bar' }),
    ];
    const groups = groupPayrollRows(rows, 'area');
    expect(groups[0].rows.map(r => r.employeeName)).toEqual(['Zoe', 'Amy']);
  });

  it('groups by position', () => {
    const rows = [row({ employeeName: 'a', position: 'Server' }), row({ employeeName: 'b', position: 'Cook' })];
    const groups = groupPayrollRows(rows, 'position');
    expect(groups.map(g => g.label)).toEqual(['Cook', 'Server']);
  });

  it('buckets blank/whitespace area into Unassigned', () => {
    const groups = groupPayrollRows([row({ employeeName: 'a', area: '   ' })], 'area');
    expect(groups[0].label).toBe(UNASSIGNED_LABEL);
  });

  it('gives every group a non-empty stable key', () => {
    const groups = groupPayrollRows([row({ area: null }), row({ area: 'Bar' })], 'area');
    expect(groups.every(g => g.key.length > 0)).toBe(true);
  });
});

describe('computePayrollTotals', () => {
  it('returns all-zeros for an empty array', () => {
    const totals = computePayrollTotals([]);
    const expected: PayrollTotals = {
      regularHours: 0,
      overtimeHours: 0,
      regularPay: 0,
      overtimePay: 0,
      totalTips: 0,
      tipsPaidOut: 0,
      tipsOwed: 0,
      totalPay: 0,
    };
    expect(totals).toEqual(expected);
  });

  it('sums regularHours and overtimeHours across all rows', () => {
    const rows = [
      row({ regularHours: 40, overtimeHours: 5 }),
      row({ regularHours: 32, overtimeHours: 0 }),
    ];
    const totals = computePayrollTotals(rows);
    expect(totals.regularHours).toBe(72);
    expect(totals.overtimeHours).toBe(5);
  });

  it('computes regularPay as Σ(regularPay + salaryPay + contractorPay + manualPaymentsTotal)', () => {
    // Matches the exact formula used in Payroll.tsx grand-total row
    const rows = [
      row({ regularPay: 30000, salaryPay: 0, contractorPay: 0, manualPaymentsTotal: 0 }),   // hourly: 300.00
      row({ regularPay: 0, salaryPay: 90000, contractorPay: 0, manualPaymentsTotal: 0 }),    // salary: 900.00
      row({ regularPay: 0, salaryPay: 0, contractorPay: 70000, manualPaymentsTotal: 5000 }), // contractor: 750.00
    ];
    expect(computePayrollTotals(rows).regularPay).toBe(195000);
  });

  it('computes overtimePay as Σ(overtimePay)', () => {
    const rows = [
      row({ overtimePay: 12000 }),
      row({ overtimePay: 8000 }),
    ];
    expect(computePayrollTotals(rows).overtimePay).toBe(20000);
  });

  it('computes totalTips, tipsPaidOut, tipsOwed as straight sums', () => {
    const rows = [
      row({ totalTips: 5000, tipsPaidOut: 2000, tipsOwed: 3000 }),
      row({ totalTips: 4000, tipsPaidOut: 4000, tipsOwed: 0 }),
    ];
    const totals = computePayrollTotals(rows);
    expect(totals.totalTips).toBe(9000);
    expect(totals.tipsPaidOut).toBe(6000);
    expect(totals.tipsOwed).toBe(3000);
  });

  it('computes totalPay as Σ(totalPay), reconciling with legacy Σ(grossPay) + Σ(tipsOwed)', () => {
    // Each row: totalPay = grossPay + tipsOwed (as set by calculateEmployeePay)
    const rows = [
      row({ grossPay: 50000, tipsOwed: 3000, totalPay: 53000 }),
      row({ grossPay: 80000, tipsOwed: 0,    totalPay: 80000 }),
    ];
    const totals = computePayrollTotals(rows);
    // Σ totalPay = 133000; legacy formula = Σ grossPay + Σ tipsOwed = 130000 + 3000 = 133000
    expect(totals.totalPay).toBe(133000);
    const legacyTotal = rows.reduce((s, r) => s + r.grossPay, 0)
                      + rows.reduce((s, r) => s + r.tipsOwed, 0);
    expect(totals.totalPay).toBe(legacyTotal);
  });

  it('reconciles with calculatePayrollPeriod totals over a multi-employee fixture', () => {
    // Build a realistic multi-employee fixture and assert computePayrollTotals
    // produces the same sums as the PayrollPeriod-style aggregations used by the
    // legacy grand-total row in Payroll.tsx.
    const employees: EmployeePayroll[] = [
      row({
        employeeName: 'Alice',
        compensationType: 'hourly',
        regularHours: 40, overtimeHours: 3,
        regularPay: 72000, overtimePay: 8100, salaryPay: 0, contractorPay: 0, manualPaymentsTotal: 0,
        grossPay: 80100, totalTips: 5000, tipsPaidOut: 3000, tipsOwed: 2000, totalPay: 82100,
      }),
      row({
        employeeName: 'Bob',
        compensationType: 'salary',
        regularHours: 40, overtimeHours: 0,
        regularPay: 0, overtimePay: 0, salaryPay: 120000, contractorPay: 0, manualPaymentsTotal: 0,
        grossPay: 120000, totalTips: 0, tipsPaidOut: 0, tipsOwed: 0, totalPay: 120000,
      }),
      row({
        employeeName: 'Carol',
        compensationType: 'contractor',
        regularHours: 0, overtimeHours: 0,
        regularPay: 0, overtimePay: 0, salaryPay: 0, contractorPay: 50000, manualPaymentsTotal: 10000,
        grossPay: 60000, totalTips: 1000, tipsPaidOut: 0, tipsOwed: 1000, totalPay: 61000,
      }),
    ];

    const totals = computePayrollTotals(employees);

    // regularHours / overtimeHours — Σ of employee fields
    expect(totals.regularHours).toBe(
      employees.reduce((s, e) => s + e.regularHours, 0)
    );
    expect(totals.overtimeHours).toBe(
      employees.reduce((s, e) => s + e.overtimeHours, 0)
    );

    // regularPay — matches Payroll.tsx grand-total formula exactly
    expect(totals.regularPay).toBe(
      employees.reduce((s, e) => s + e.regularPay + e.salaryPay + e.contractorPay + e.manualPaymentsTotal, 0)
    );

    // overtimePay — straight sum
    expect(totals.overtimePay).toBe(
      employees.reduce((s, e) => s + e.overtimePay, 0)
    );

    // tips columns — straight sums (matches PayrollPeriod.total* fields)
    expect(totals.totalTips).toBe(employees.reduce((s, e) => s + e.totalTips, 0));
    expect(totals.tipsPaidOut).toBe(employees.reduce((s, e) => s + e.tipsPaidOut, 0));
    expect(totals.tipsOwed).toBe(employees.reduce((s, e) => s + e.tipsOwed, 0));

    // totalPay — matches Payroll.tsx legacy formula: Σgrosspy + ΣtipsOwed
    const legacyTotalPay = employees.reduce((s, e) => s + e.grossPay, 0)
                         + employees.reduce((s, e) => s + e.tipsOwed, 0);
    expect(totals.totalPay).toBe(legacyTotalPay);
    // Also equals Σ(e.totalPay) since totalPay = grossPay + tipsOwed per employee
    expect(totals.totalPay).toBe(employees.reduce((s, e) => s + e.totalPay, 0));
  });

  it('does not mutate the input array', () => {
    const rows = [row({ regularHours: 40 }), row({ regularHours: 32 })];
    const snapshot = rows.map(r => r.regularHours);
    computePayrollTotals(rows);
    expect(rows.map(r => r.regularHours)).toEqual(snapshot);
  });
});
