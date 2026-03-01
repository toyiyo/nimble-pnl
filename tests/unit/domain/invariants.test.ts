import { describe, it, expect } from 'vitest';
import {
  assertTimeValidity,
  assertIdentityComplete,
  assertNotCanceled,
  assertEditable,
  assertHasEmployee,
  assertIsOpen,
} from '@/domain/scheduling/invariants';
import { DomainError } from '@/domain/scheduling/types';
import type { ShiftState } from '@/domain/scheduling/types';

const base: ShiftState = {
  shiftId: 's1',
  restaurantId: 'r1',
  locationId: 'l1',
  timezone: 'America/Chicago',
  businessDate: '2026-02-28',
  startAt: '2026-02-28T14:00:00Z',
  endAt: '2026-02-28T22:00:00Z',
  roleId: 'cashier',
  employeeId: null,
  status: 'Draft',
  version: 1,
};

function expectDomainError(fn: () => void, code: string): void {
  try {
    fn();
    expect.fail(`Expected DomainError with code "${code}" but no error was thrown`);
  } catch (err) {
    expect(err).toBeInstanceOf(DomainError);
    expect((err as DomainError).code).toBe(code);
  }
}

describe('assertTimeValidity', () => {
  it('passes for valid times', () => {
    expect(() => assertTimeValidity('2026-02-28T14:00:00Z', '2026-02-28T22:00:00Z')).not.toThrow();
  });

  it('rejects end <= start', () => {
    expectDomainError(
      () => assertTimeValidity('2026-02-28T22:00:00Z', '2026-02-28T22:00:00Z'),
      'CMD_BAD_TIME',
    );
  });

  it('rejects duration < 15 minutes', () => {
    expectDomainError(
      () => assertTimeValidity('2026-02-28T14:00:00Z', '2026-02-28T14:10:00Z'),
      'CMD_TOO_SHORT',
    );
  });
});

describe('assertIdentityComplete', () => {
  it('passes when all required fields present', () => {
    expect(() => assertIdentityComplete(base)).not.toThrow();
  });

  it('rejects missing restaurantId', () => {
    expectDomainError(
      () => assertIdentityComplete({ ...base, restaurantId: undefined }),
      'INV_MISSING_FIELDS',
    );
  });

  it('rejects missing roleId', () => {
    expectDomainError(
      () => assertIdentityComplete({ ...base, roleId: undefined }),
      'INV_MISSING_FIELDS',
    );
  });
});

describe('assertNotCanceled', () => {
  it('passes for Draft', () => {
    expect(() => assertNotCanceled({ ...base, status: 'Draft' })).not.toThrow();
  });

  it('passes for Published', () => {
    expect(() => assertNotCanceled({ ...base, status: 'Published' })).not.toThrow();
  });

  it('rejects Canceled', () => {
    expectDomainError(
      () => assertNotCanceled({ ...base, status: 'Canceled' }),
      'SHIFT_CANCELED',
    );
  });
});

describe('assertEditable', () => {
  it('passes for Draft', () => {
    expect(() => assertEditable({ ...base, status: 'Draft' })).not.toThrow();
  });

  it('passes for Published', () => {
    expect(() => assertEditable({ ...base, status: 'Published' })).not.toThrow();
  });

  it('rejects Canceled', () => {
    expectDomainError(
      () => assertEditable({ ...base, status: 'Canceled' }),
      'SHIFT_CANCELED',
    );
  });
});

describe('assertHasEmployee', () => {
  it('passes when employee assigned', () => {
    expect(() => assertHasEmployee({ ...base, employeeId: 'e1' })).not.toThrow();
  });

  it('rejects when no employee', () => {
    expectDomainError(
      () => assertHasEmployee({ ...base, employeeId: null }),
      'SHIFT_NOT_ASSIGNED',
    );
  });
});

describe('assertIsOpen', () => {
  it('passes when no employee', () => {
    expect(() => assertIsOpen({ ...base, employeeId: null })).not.toThrow();
  });

  it('rejects when employee assigned', () => {
    expectDomainError(
      () => assertIsOpen({ ...base, employeeId: 'e1' }),
      'SHIFT_ALREADY_ASSIGNED',
    );
  });
});
