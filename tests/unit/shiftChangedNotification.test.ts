import { describe, it, expect } from 'vitest';
import {
  checkShiftChangeValidity,
  deriveShiftChangeRecipients,
  buildShiftChangeMessage,
  type ShiftChangeLogRow,
} from '../../supabase/functions/_shared/shiftChangedNotification';

const NOW = new Date('2026-08-15T12:00:00.000Z');

const baseRow: ShiftChangeLogRow = {
  id: 'log-1',
  restaurant_id: 'rest-1',
  shift_id: 'shift-1',
  change_type: 'updated',
  changed_at: NOW.toISOString(),
  before_data: { employee_id: 'emp-1', start_time: '2026-08-11T17:00:00.000Z' },
  after_data: { employee_id: 'emp-1', start_time: '2026-08-11T18:00:00.000Z' },
};

describe('checkShiftChangeValidity', () => {
  it('accepts a fresh updated row with a shift_id', () => {
    expect(checkShiftChangeValidity(baseRow, NOW)).toEqual({ valid: true });
  });

  it('accepts a fresh deleted row with a shift_id', () => {
    expect(checkShiftChangeValidity({ ...baseRow, change_type: 'deleted' }, NOW)).toEqual({
      valid: true,
    });
  });

  it('rejects a row older than 10 minutes', () => {
    const old = { ...baseRow, changed_at: '2026-08-15T11:49:00.000Z' };
    expect(checkShiftChangeValidity(old, NOW)).toEqual({ valid: false, reason: 'too-old' });
  });

  it('rejects an unpublished change_type', () => {
    expect(checkShiftChangeValidity({ ...baseRow, change_type: 'unpublished' }, NOW)).toEqual({
      valid: false,
      reason: 'wrong-change-type',
    });
  });

  it('rejects a created change_type', () => {
    expect(checkShiftChangeValidity({ ...baseRow, change_type: 'created' }, NOW)).toEqual({
      valid: false,
      reason: 'wrong-change-type',
    });
  });

  it('rejects a row with no shift_id (restaurant-level unpublish)', () => {
    expect(checkShiftChangeValidity({ ...baseRow, shift_id: null }, NOW)).toEqual({
      valid: false,
      reason: 'no-shift-id',
    });
  });
});

describe('deriveShiftChangeRecipients', () => {
  it('returns the before employee on delete', () => {
    expect(
      deriveShiftChangeRecipients({
        change_type: 'deleted',
        before_data: { employee_id: 'emp-1' },
        after_data: null,
      }),
    ).toEqual([{ employeeId: 'emp-1', role: 'removed' }]);
  });

  it('returns nothing on delete with no employee', () => {
    expect(
      deriveShiftChangeRecipients({
        change_type: 'deleted',
        before_data: { employee_id: null },
        after_data: null,
      }),
    ).toEqual([]);
  });

  it('returns one updated recipient when the employee is unchanged', () => {
    expect(deriveShiftChangeRecipients(baseRow)).toEqual([{ employeeId: 'emp-1', role: 'updated' }]);
  });

  it('returns both employees on a reassignment', () => {
    const row = {
      change_type: 'updated',
      before_data: { employee_id: 'emp-1' },
      after_data: { employee_id: 'emp-2' },
    };
    expect(deriveShiftChangeRecipients(row)).toEqual([
      { employeeId: 'emp-1', role: 'removed' },
      { employeeId: 'emp-2', role: 'assigned' },
    ]);
  });

  it('returns nothing for an open shift (both sides null)', () => {
    const row = {
      change_type: 'updated',
      before_data: { employee_id: null },
      after_data: { employee_id: null },
    };
    expect(deriveShiftChangeRecipients(row)).toEqual([]);
  });
});

describe('buildShiftChangeMessage', () => {
  it('builds the removed message with the old day and time', () => {
    const msg = buildShiftChangeMessage(
      { employeeId: 'emp-1', role: 'removed' },
      baseRow,
      'UTC',
    );
    expect(msg.title).toBe('Shift Removed');
    expect(msg.body).toContain('Tue');
    expect(msg.body).toContain('removed');
  });

  it('builds the assigned message', () => {
    const msg = buildShiftChangeMessage(
      { employeeId: 'emp-2', role: 'assigned' },
      baseRow,
      'UTC',
    );
    expect(msg).toEqual({ title: 'New Shift Assigned', body: 'You have a new shift.' });
  });

  it('builds the updated message with old and new times', () => {
    const msg = buildShiftChangeMessage(
      { employeeId: 'emp-1', role: 'updated' },
      baseRow,
      'UTC',
    );
    expect(msg.title).toBe('Shift Updated');
    expect(msg.body).toContain('changed to');
  });

  it('names the new end time when only the end time changed', () => {
    const msg = buildShiftChangeMessage(
      { employeeId: 'emp-1', role: 'updated' },
      {
        ...baseRow,
        before_data: {
          employee_id: 'emp-1',
          start_time: '2026-08-11T17:00:00.000Z',
          end_time: '2026-08-11T21:00:00.000Z',
        },
        after_data: {
          employee_id: 'emp-1',
          start_time: '2026-08-11T17:00:00.000Z',
          end_time: '2026-08-11T23:00:00.000Z',
        },
      },
      'UTC',
    );
    // "changed to <same start time>" reads as no change at all.
    expect(msg.body).not.toContain('changed to');
    expect(msg.body).toContain('now ends at');
    expect(msg.body).toContain('11:00 PM');
  });

  it('falls back to a generic update when the times are unchanged', () => {
    const msg = buildShiftChangeMessage(
      { employeeId: 'emp-1', role: 'updated' },
      {
        ...baseRow,
        after_data: { employee_id: 'emp-1', start_time: '2026-08-11T17:00:00.000Z' },
        before_data: { employee_id: 'emp-1', start_time: '2026-08-11T17:00:00.000Z' },
      },
      'UTC',
    );
    expect(msg.body).not.toContain('changed to');
    expect(msg.body).toContain('was updated');
  });
});
