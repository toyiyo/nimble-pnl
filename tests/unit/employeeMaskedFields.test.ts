import { describe, expect, it } from 'vitest';
import {
  EMPLOYEE_PII_FIELDS,
  PAY_RATE_FIELDS,
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

  it('should mask all eight fields when the caller holds neither flag', () => {
    expect(maskedEmployeeFields({ payRates: false, employeePii: false }))
      .toHaveLength(8);
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
