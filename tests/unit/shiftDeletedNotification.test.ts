import { describe, it, expect } from 'vitest';
import {
  buildDeletedShiftNotification,
  type DeletedShiftNotificationInput,
} from '../../supabase/functions/_shared/shiftDeletedNotification';

const baseInput: DeletedShiftNotificationInput = {
  shiftId: 'shift-123',
  employeeName: 'Jamie Rivera',
  employeeEmail: 'jamie@example.com',
  employeeUserId: 'user-abc',
  restaurantName: 'Nimble Diner',
  timezone: 'America/Chicago',
  position: 'Server',
  startTime: '2026-07-15T17:00:00.000Z',
  endTime: '2026-07-15T22:00:00.000Z',
  appUrl: 'https://app.easyshifthq.com',
};

describe('buildDeletedShiftNotification', () => {
  it('builds an email-only plan when the employee has no user_id', () => {
    const plan = buildDeletedShiftNotification({
      ...baseInput,
      employeeUserId: null,
    });

    expect(plan.email).toBeDefined();
    expect(plan.email?.to).toBe('jamie@example.com');
    expect(plan.email?.subject).toContain('Nimble Diner');
    expect(plan.email?.html).toContain('Server');
    expect(plan.push).toBeUndefined();
    expect(plan.skipped).toBeUndefined();
  });

  it('builds a push-only plan when the employee has no email', () => {
    const plan = buildDeletedShiftNotification({
      ...baseInput,
      employeeEmail: null,
    });

    expect(plan.push).toBeDefined();
    expect(plan.push?.userId).toBe('user-abc');
    expect(plan.push?.payload.tag).toBe('shift-deleted-shift-123');
    expect(plan.push?.payload.url).toBe('/employee/schedule');
    expect(plan.email).toBeUndefined();
    expect(plan.skipped).toBeUndefined();
  });

  it('builds both an email and push plan when both are available', () => {
    const plan = buildDeletedShiftNotification(baseInput);

    expect(plan.email).toBeDefined();
    expect(plan.email?.to).toBe('jamie@example.com');
    expect(plan.push).toBeDefined();
    expect(plan.push?.userId).toBe('user-abc');
    expect(plan.push?.payload.tag).toBe('shift-deleted-shift-123');
    expect(plan.skipped).toBeUndefined();
  });

  it('returns skipped when neither email nor user_id is available', () => {
    const plan = buildDeletedShiftNotification({
      ...baseInput,
      employeeEmail: null,
      employeeUserId: null,
    });

    expect(plan.email).toBeUndefined();
    expect(plan.push).toBeUndefined();
    expect(plan.skipped).toBe('no-email-and-no-user');
  });

  it('falls back to a generic greeting when employeeName is null', () => {
    const plan = buildDeletedShiftNotification({
      ...baseInput,
      employeeName: null,
      employeeUserId: null,
    });

    expect(plan.email?.html).toContain('Hi there');
  });

  it('formats shift start/end using the restaurant timezone', () => {
    const plan = buildDeletedShiftNotification({
      ...baseInput,
      employeeUserId: null,
    });

    // 17:00 UTC on 2026-07-15 => 12:00 PM in America/Chicago (CDT, UTC-5)
    expect(plan.email?.html).toContain('12:00 PM');
  });

  it('push payload title/body describe the removed shift', () => {
    const plan = buildDeletedShiftNotification({
      ...baseInput,
      employeeEmail: null,
    });

    expect(plan.push?.payload.title).toBe('Shift Removed');
    expect(plan.push?.payload.body.length).toBeGreaterThan(0);
  });
});
