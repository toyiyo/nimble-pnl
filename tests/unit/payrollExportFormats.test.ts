import { describe, it, expect } from 'vitest';
import { PAYROLL_EXPORT_FORMATS } from '@/utils/payrollExportFormats';
import { GUSTO_CSV_HEADERS } from '@/utils/payrollGustoExport';
import type { PayrollPeriod } from '@/utils/payrollCalculations';

function emptyPeriod(): PayrollPeriod {
  return {
    startDate: new Date(2026, 5, 8),
    endDate: new Date(2026, 5, 14),
    employees: [],
    totalRegularHours: 0,
    totalOvertimeHours: 0,
    totalDoubleTimeHours: 0,
    totalGrossPay: 0,
    totalTips: 0,
    totalTipsPaidOut: 0,
    totalTipsOwed: 0,
  };
}

describe('PAYROLL_EXPORT_FORMATS', () => {
  it('exposes the internal and gusto formats in order', () => {
    expect(PAYROLL_EXPORT_FORMATS.map((f) => f.id)).toEqual(['internal', 'gusto']);
  });

  it('labels are human-readable', () => {
    const byId = Object.fromEntries(PAYROLL_EXPORT_FORMATS.map((f) => [f.id, f.label]));
    expect(byId.internal).toBe('Standard CSV');
    expect(byId.gusto).toBe('Gusto CSV');
  });

  it('builds filenames from the period date range', () => {
    const start = new Date(2026, 5, 8);
    const end = new Date(2026, 5, 14);
    const byId = Object.fromEntries(PAYROLL_EXPORT_FORMATS.map((f) => [f.id, f]));
    expect(byId.internal.filename(start, end)).toBe('payroll_2026-06-08_to_2026-06-14.csv');
    expect(byId.gusto.filename(start, end)).toBe('payroll_gusto_2026-06-08_to_2026-06-14.csv');
  });

  it('gusto.build produces the Gusto header; internal.build produces the internal header', () => {
    const byId = Object.fromEntries(PAYROLL_EXPORT_FORMATS.map((f) => [f.id, f]));
    expect(byId.gusto.build(emptyPeriod()).split('\n')[0]).toBe(GUSTO_CSV_HEADERS.join(','));
    expect(byId.internal.build(emptyPeriod()).split('\n')[0]).toContain('Employee Name');
  });
});
