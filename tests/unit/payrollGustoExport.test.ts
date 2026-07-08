import { describe, it, expect } from 'vitest';
import { GUSTO_CSV_HEADERS, splitEmployeeName } from '@/utils/payrollGustoExport';

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
