import { describe, expect, it } from 'vitest';
import {
  EMPLOYEE_PII_FIELDS,
  PAY_RATE_FIELDS,
  assertPermissionsResolved,
  isCompensationHidden,
  maskedEmployeeFields,
  stripMaskedEmployeeFields,
} from '@/lib/employeeMaskedFields';

describe('maskedEmployeeFields', () => {
  it('should mask nothing when the caller holds both flags', () => {
    expect(maskedEmployeeFields({ payRates: true, employeePii: true })).toEqual([]);
  });

  it('should mask the pay fields when the caller lacks view:pay_rates', () => {
    expect(maskedEmployeeFields({ payRates: false, employeePii: true }))
      .toEqual([...PAY_RATE_FIELDS]);
  });

  it('should mask the contact fields when the caller lacks view:employee_pii', () => {
    expect(maskedEmployeeFields({ payRates: true, employeePii: false }))
      .toEqual([...EMPLOYEE_PII_FIELDS]);
  });

  it('should mask all nine fields when the caller holds neither flag', () => {
    expect(maskedEmployeeFields({ payRates: false, employeePii: false }))
      .toHaveLength(9);
  });

  it('should mask is_exempt with the pay fields, though the column is not read-masked', () => {
    // is_exempt keeps its SELECT grant for every caller (20260806110000). The
    // strip below is the only guard on the write, so it must fire with the
    // other pay fields, not only when a real masked NULL is on the line.
    expect(maskedEmployeeFields({ payRates: false, employeePii: true }))
      .toContain('is_exempt');
    expect(maskedEmployeeFields({ payRates: true, employeePii: true }))
      .not.toContain('is_exempt');
  });
});

describe('stripMaskedEmployeeFields', () => {
  it('should drop every masked key from the payload', () => {
    const payload = {
      id: 'e1',
      name: 'Ada',
      hourly_rate: 0,
      salary_amount: undefined,
      email: undefined,
      date_of_birth: null,
    };

    const result = stripMaskedEmployeeFields(payload, [
      'hourly_rate',
      'salary_amount',
      'email',
      'date_of_birth',
    ]);

    expect(result).toEqual({ id: 'e1', name: 'Ada' });
  });

  it('should keep a key that is not masked, even when its value is null', () => {
    const result = stripMaskedEmployeeFields(
      { id: 'e1', notes: null, hourly_rate: 0 },
      ['hourly_rate']
    );

    expect(result).toEqual({ id: 'e1', notes: null });
  });

  it('should return a new object and not change the input', () => {
    const payload = { id: 'e1', hourly_rate: 0 };
    const result = stripMaskedEmployeeFields(payload, ['hourly_rate']);

    expect(result).not.toBe(payload);
    expect(payload).toEqual({ id: 'e1', hourly_rate: 0 });
  });

  it('should drop nothing when the masked list is empty', () => {
    const payload = { id: 'e1', hourly_rate: 1500 };
    expect(stripMaskedEmployeeFields(payload, [])).toEqual(payload);
  });
});

describe('isCompensationHidden', () => {
  it('should read true for a masked hourly rate (null)', () => {
    expect(isCompensationHidden({ compensation_type: 'hourly', hourly_rate: null })).toBe(true);
  });

  it('should read true for a masked hourly rate (undefined)', () => {
    expect(isCompensationHidden({ compensation_type: 'hourly' })).toBe(true);
  });

  it('should read false for a visible hourly rate, even a real $0', () => {
    expect(isCompensationHidden({ compensation_type: 'hourly', hourly_rate: 0 })).toBe(false);
  });

  it('should default to the hourly field when compensation_type is missing', () => {
    expect(isCompensationHidden({ hourly_rate: null })).toBe(true);
    expect(isCompensationHidden({ hourly_rate: 1500 })).toBe(false);
  });

  it('should read the salary field for a salaried employee', () => {
    expect(isCompensationHidden({ compensation_type: 'salary', salary_amount: null })).toBe(true);
    expect(isCompensationHidden({ compensation_type: 'salary', salary_amount: 50000 })).toBe(false);
  });

  it('should read the daily-rate field for a daily-rate employee', () => {
    expect(isCompensationHidden({ compensation_type: 'daily_rate', daily_rate_amount: null })).toBe(true);
    expect(isCompensationHidden({ compensation_type: 'daily_rate', daily_rate_amount: 12000 })).toBe(false);
  });

  it('should read the contractor field for a contractor', () => {
    expect(isCompensationHidden({ compensation_type: 'contractor', contractor_payment_amount: null })).toBe(true);
    expect(isCompensationHidden({ compensation_type: 'contractor', contractor_payment_amount: 75000 })).toBe(false);
  });

  it('should read false for an unrecognized compensation_type', () => {
    expect(isCompensationHidden({ compensation_type: 'unknown_type' })).toBe(false);
  });
});

describe('assertPermissionsResolved', () => {
  it('should throw when permissions are still loading', () => {
    expect(() => assertPermissionsResolved(false)).toThrow(
      'Permissions are still loading. Try again in a moment.'
    );
  });

  it('should not throw once permissions have resolved', () => {
    expect(() => assertPermissionsResolved(true)).not.toThrow();
  });
});
