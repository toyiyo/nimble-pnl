import { describe, it, expect } from 'vitest';

import { computeAllocationStatus } from '@/lib/shiftAllocation';

import type { Shift, ShiftTemplate } from '@/types/scheduling';

function makeShift(partial: Partial<Shift>): Shift {
  return {
    id: 'shift-1',
    restaurant_id: 'r1',
    employee_id: 'e1',
    start_time: '2026-04-20T13:00:00Z',
    end_time: '2026-04-20T21:00:00Z',
    break_duration: 0,
    position: 'server',
    status: 'scheduled',
    is_published: false,
    locked: false,
    source: 'manual',
    created_at: '',
    updated_at: '',
    ...partial,
  };
}

function makeTemplate(partial: Partial<ShiftTemplate>): ShiftTemplate {
  return {
    id: 't1',
    restaurant_id: 'r1',
    name: 'Open',
    days: [1, 2, 3, 4, 5],
    start_time: '09:00:00',
    end_time: '17:00:00',
    break_duration: 0,
    position: 'server',
    capacity: 2,
    is_active: true,
    created_at: '',
    updated_at: '',
    ...partial,
  };
}

describe('computeAllocationStatus', () => {
  const template = makeTemplate({ start_time: '09:00:00', end_time: '17:00:00' });

  it('returns "none" when template is not active on the day', () => {
    const tpl = makeTemplate({ days: [1, 2, 3] }); // Mon-Wed only
    const sundayShifts: Shift[] = [];
    // 2026-04-19 is a Sunday (day 0)
    const result = computeAllocationStatus(sundayShifts, tpl, '2026-04-19');
    expect(result).toBe('none');
  });

  it('returns "highlight" when employee already has a shift encompassing the template slot', () => {
    const shift = makeShift({
      start_time: '2026-04-20T09:00:00',
      end_time: '2026-04-20T17:00:00',
    });
    expect(computeAllocationStatus([shift], template, '2026-04-20')).toBe('highlight');
  });

  it('returns "highlight" when employee shift strictly contains the template slot', () => {
    const shift = makeShift({
      start_time: '2026-04-20T08:00:00',
      end_time: '2026-04-20T18:00:00',
    });
    expect(computeAllocationStatus([shift], template, '2026-04-20')).toBe('highlight');
  });

  it('returns "conflict" when employee has a partially-overlapping shift', () => {
    const shift = makeShift({
      start_time: '2026-04-20T12:00:00',
      end_time: '2026-04-20T20:00:00',
    });
    expect(computeAllocationStatus([shift], template, '2026-04-20')).toBe('conflict');
  });

  it('returns "available" when employee has no shift on the day', () => {
    expect(computeAllocationStatus([], template, '2026-04-20')).toBe('available');
  });

  it('returns "available" when employee has a shift on a different day', () => {
    const shift = makeShift({
      start_time: '2026-04-21T12:00:00',
      end_time: '2026-04-21T20:00:00',
    });
    expect(computeAllocationStatus([shift], template, '2026-04-20')).toBe('available');
  });

  it('ignores cancelled shifts', () => {
    const shift = makeShift({
      start_time: '2026-04-20T12:00:00',
      end_time: '2026-04-20T20:00:00',
      status: 'cancelled',
    });
    expect(computeAllocationStatus([shift], template, '2026-04-20')).toBe('available');
  });

  it('treats touching-but-not-overlapping shifts as available', () => {
    const shift = makeShift({
      start_time: '2026-04-20T17:00:00',
      end_time: '2026-04-20T22:00:00',
    });
    expect(computeAllocationStatus([shift], template, '2026-04-20')).toBe('available');
  });
});
