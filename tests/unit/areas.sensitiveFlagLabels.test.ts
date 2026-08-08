import { describe, it, expect } from 'vitest';
import { SENSITIVE_FLAGS } from '@/lib/permissions/areas';

describe('SENSITIVE_FLAGS labels match stored columns', () => {
  it('names the view:employee_pii flag after data the app stores', () => {
    const flag = SENSITIVE_FLAGS.find((f) => f.flag === 'view:employee_pii');
    expect(flag?.name).toBe('Contact details');
    expect(flag?.hint).toBe('Email, phone, date of birth');
  });
});
