import { describe, it, expect } from 'vitest';
import {
  checkShiftChangeValidity,
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
