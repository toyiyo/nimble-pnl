import { describe, it, expect } from 'vitest';
import {
  sortPayrollRows,
  regularPayDisplayValue,
  type PayrollSortKey,
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
