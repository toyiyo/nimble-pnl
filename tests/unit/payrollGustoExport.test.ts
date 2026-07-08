import { describe, it, expect } from 'vitest';
import { GUSTO_CSV_HEADERS, splitEmployeeName, buildGustoCSV } from '@/utils/payrollGustoExport';
import type { EmployeePayroll, PayrollPeriod } from '@/utils/payrollCalculations';

// Minimal builder — only fields buildGustoCSV reads matter; rest are zeroed.
function employee(overrides: Partial<EmployeePayroll>): EmployeePayroll {
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

function period(employees: EmployeePayroll[]): PayrollPeriod {
  return {
    startDate: new Date('2026-06-01'),
    endDate: new Date('2026-06-07'),
    employees,
    totalRegularHours: 0,
    totalOvertimeHours: 0,
    totalDoubleTimeHours: 0,
    totalGrossPay: 0,
    totalTips: 0,
    totalTipsPaidOut: 0,
    totalTipsOwed: 0,
  };
}

describe('GUSTO_CSV_HEADERS', () => {
  it('matches the Gusto import template exactly (16 columns, in order)', () => {
    expect(GUSTO_CSV_HEADERS.join(',')).toBe(
      'last_name,first_name,title,gusto_employee_id,regular_hours,overtime_hours,double_overtime_hours,missed_break_hours,owners_draw,bonus,commission,paycheck_tips,cash_tips,correction_payment,reimbursement,personal_note',
    );
  });
});

describe('splitEmployeeName', () => {
  it('splits "First Last" into first + last', () => {
    expect(splitEmployeeName('Jose Delgado')).toEqual({ firstName: 'Jose', lastName: 'Delgado' });
  });
  it('treats the last token as the last name and the rest as the first name', () => {
    expect(splitEmployeeName('Ana Maria Cruz')).toEqual({ firstName: 'Ana Maria', lastName: 'Cruz' });
  });
  it('preserves accented characters', () => {
    expect(splitEmployeeName('Javier Gutiérrez')).toEqual({ firstName: 'Javier', lastName: 'Gutiérrez' });
  });
  it('keeps original casing (does not normalize)', () => {
    expect(splitEmployeeName('Shy harrison')).toEqual({ firstName: 'Shy', lastName: 'harrison' });
  });
  it('collapses extra internal/leading/trailing whitespace', () => {
    expect(splitEmployeeName('  Colby   Mullaley  ')).toEqual({ firstName: 'Colby', lastName: 'Mullaley' });
  });
  it('puts a single token in firstName with a blank lastName', () => {
    expect(splitEmployeeName('Cher')).toEqual({ firstName: 'Cher', lastName: '' });
  });
  it('returns two blanks for empty/whitespace input', () => {
    expect(splitEmployeeName('   ')).toEqual({ firstName: '', lastName: '' });
    expect(splitEmployeeName('')).toEqual({ firstName: '', lastName: '' });
  });
});

describe('buildGustoCSV', () => {
  it('emits the exact Gusto header line as the first row', () => {
    const csv = buildGustoCSV(period([]));
    const [headerLine] = csv.split('\n');
    expect(headerLine).toBe(GUSTO_CSV_HEADERS.join(','));
  });

  it('emits header only (no rows) for an empty employee list — no TOTAL row', () => {
    const csv = buildGustoCSV(period([]));
    expect(csv).toBe(GUSTO_CSV_HEADERS.join(','));
    expect(csv.split('\n')).toHaveLength(1);
  });

  it('maps name split, title=position, and leaves gusto_employee_id blank', () => {
    const csv = buildGustoCSV(period([
      employee({ employeeName: 'Jose Delgado', position: 'Server' }),
    ]));
    const [, row] = csv.split('\n');
    expect(row).toBe('"Delgado","Jose","Server",,,,,,,,,,,,,');
  });

  it('splits tips: paycheck_tips = tipsOwed, cash_tips = tipsPaidOut (cents → dollars)', () => {
    const csv = buildGustoCSV(period([
      employee({ employeeName: 'Ann Lee', tipsOwed: 1250, tipsPaidOut: 500 }),
    ]));
    const [, row] = csv.split('\n');
    const cols = row.split(',');
    // header order: ...,paycheck_tips(11),cash_tips(12),...
    expect(cols[11]).toBe('12.50');
    expect(cols[12]).toBe('5.00');
  });

  it('quotes only the free-text cells (last_name, first_name, title); numeric/blank cells are unquoted', () => {
    const csv = buildGustoCSV(period([
      employee({ employeeName: 'Jose Delgado', position: 'Server', regularHours: 40 }),
    ]));
    const [, row] = csv.split('\n');
    const cols = row.split(',');
    expect(cols[0]).toBe('"Delgado"');
    expect(cols[1]).toBe('"Jose"');
    expect(cols[2]).toBe('"Server"');
    expect(cols[4]).toBe('40.00');
    expect(cols[3]).toBe('');
  });

  it('formats hours to up to 2 decimals for regular/overtime/double_overtime', () => {
    const csv = buildGustoCSV(period([
      employee({ employeeName: 'Ann Lee', regularHours: 40, overtimeHours: 2.234, doubleTimeHours: 1.1 }),
    ]));
    const [, row] = csv.split('\n');
    const cols = row.split(',');
    expect(cols[4]).toBe('40.00');
    expect(cols[5]).toBe('2.23');
    expect(cols[6]).toBe('1.10');
  });

  it('renders zero money/hours values as blank cells, not "0" or "0.00"', () => {
    const csv = buildGustoCSV(period([
      employee({ employeeName: 'Ann Lee', regularHours: 0, overtimeHours: 0, doubleTimeHours: 0, tipsOwed: 0, tipsPaidOut: 0 }),
    ]));
    const [, row] = csv.split('\n');
    expect(row).toBe('"Lee","Ann","",,,,,,,,,,,,,');
  });

  it('leaves missed_break_hours, owners_draw, bonus, commission, correction_payment, reimbursement, personal_note blank', () => {
    const csv = buildGustoCSV(period([employee({ employeeName: 'Ann Lee' })]));
    const [, row] = csv.split('\n');
    const cols = row.split(',');
    // indices: 7 missed_break_hours, 8 owners_draw, 9 bonus, 10 commission, 13 correction_payment, 14 reimbursement, 15 personal_note
    expect([cols[7], cols[8], cols[9], cols[10], cols[13], cols[14], cols[15]]).toEqual(['', '', '', '', '', '', '']);
  });

  it('produces exactly header + one row per employee — no TOTAL row, no trailing blank line', () => {
    const csv = buildGustoCSV(period([
      employee({ employeeName: 'Ann Lee' }),
      employee({ employeeName: 'Bob Cruz' }),
    ]));
    const lines = csv.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[2]).not.toBe('');
    expect(csv.toUpperCase()).not.toContain('TOTAL');
  });

  it('is CSV-injection safe: neutralizes a formula-triggering name and RFC-4180 quotes commas/quotes', () => {
    const csv = buildGustoCSV(period([
      employee({ employeeName: '=cmd', position: 'Line, "Cook"' }),
    ]));
    const [, row] = csv.split('\n');
    // single token → lastName blank, firstName carries the neutralized formula; title has an embedded comma + quotes
    expect(row).toBe('"","\'=cmd","Line, ""Cook""",,,,,,,,,,,,,');
  });

  it('is CSV-injection safe against a leading-whitespace/tab formula bypass', () => {
    // `position` is not trimmed by a name-splitting heuristic, so the leading
    // tab survives into the escaper and must still be neutralized there.
    const csv = buildGustoCSV(period([
      employee({ employeeName: 'Ann Lee', position: '\t=HYPERLINK("https://evil")' }),
    ]));
    const [, row] = csv.split('\n');
    expect(row).toBe('"Lee","Ann","\'\t=HYPERLINK(""https://evil"")",,,,,,,,,,,,,');
  });
});
