import { describe, it, expect } from 'vitest';
import {
  buildShiftDeletedInvoke,
  type DeletableShift,
} from '../../src/lib/shiftDeleteNotification';

const baseShift: DeletableShift = {
  id: 'shift-123',
  restaurant_id: 'restaurant-abc',
  employee_id: 'employee-xyz',
  is_published: true,
  position: 'Server',
  start_time: '2026-07-15T17:00:00.000Z',
  end_time: '2026-07-15T22:00:00.000Z',
};

describe('buildShiftDeletedInvoke', () => {
  it('returns an invoke body for a published shift with an assigned employee', () => {
    const body = buildShiftDeletedInvoke(baseShift);

    expect(body).toEqual({
      shiftId: 'shift-123',
      action: 'deleted',
      deletedShift: {
        restaurant_id: 'restaurant-abc',
        employee_id: 'employee-xyz',
        position: 'Server',
        start_time: '2026-07-15T17:00:00.000Z',
        end_time: '2026-07-15T22:00:00.000Z',
      },
    });
  });

  it('returns null when the shift is not published', () => {
    const body = buildShiftDeletedInvoke({ ...baseShift, is_published: false });

    expect(body).toBeNull();
  });

  it('returns null when is_published is null', () => {
    const body = buildShiftDeletedInvoke({ ...baseShift, is_published: null });

    expect(body).toBeNull();
  });

  it('returns null when is_published is undefined', () => {
    const body = buildShiftDeletedInvoke({ ...baseShift, is_published: undefined });

    expect(body).toBeNull();
  });

  it('returns null when employee_id is null (open/unassigned shift)', () => {
    const body = buildShiftDeletedInvoke({ ...baseShift, employee_id: null });

    expect(body).toBeNull();
  });

  it('never includes email or user_id in the invoke body', () => {
    const body = buildShiftDeletedInvoke(baseShift);

    expect(body).not.toBeNull();
    const serialized = JSON.stringify(body);
    expect(serialized).not.toMatch(/email/i);
    expect(serialized).not.toMatch(/user_id/i);
  });

  it('gates on is_published, not locked — publish/unpublish set both in lockstep, but the semantic gate is is_published', () => {
    // A hypothetically "locked" but not-yet-published shift must NOT notify:
    // locked is an editing-lock concern, is_published is the "was the employee
    // already told about this shift?" concern. Only the latter should gate notification.
    const body = buildShiftDeletedInvoke({ ...baseShift, is_published: false });

    expect(body).toBeNull();
  });
});
