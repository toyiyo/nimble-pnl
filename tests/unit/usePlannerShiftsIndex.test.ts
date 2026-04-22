import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';

import { usePlannerShiftsIndex } from '@/hooks/usePlannerShiftsIndex';

import type { Shift } from '@/types/scheduling';

function makeShift(partial: Partial<Shift>): Shift {
  return {
    id: 's' + Math.random().toString(36).slice(2, 8),
    restaurant_id: 'r1',
    employee_id: 'e1',
    start_time: '2026-04-20T13:00:00',
    end_time: '2026-04-20T21:00:00',
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

const weekDays = [
  '2026-04-20', '2026-04-21', '2026-04-22', '2026-04-23',
  '2026-04-24', '2026-04-25', '2026-04-26',
];

describe('usePlannerShiftsIndex', () => {
  it('groups shifts by employee', () => {
    const shifts: Shift[] = [
      makeShift({ id: 'a', employee_id: 'e1' }),
      makeShift({ id: 'b', employee_id: 'e2' }),
      makeShift({ id: 'c', employee_id: 'e1', start_time: '2026-04-21T13:00:00', end_time: '2026-04-21T17:00:00' }),
    ];
    const { result } = renderHook(() => usePlannerShiftsIndex(shifts, weekDays));
    expect(result.current.shiftsByEmployee.get('e1')).toHaveLength(2);
    expect(result.current.shiftsByEmployee.get('e2')).toHaveLength(1);
  });

  it('ignores cancelled shifts in all derivations', () => {
    const shifts: Shift[] = [
      makeShift({ id: 'a', status: 'cancelled' }),
    ];
    const { result } = renderHook(() => usePlannerShiftsIndex(shifts, weekDays));
    expect(result.current.shiftsByEmployee.size).toBe(0);
    expect(result.current.coverageByDay.get('2026-04-20')?.every((n) => n === 0)).toBe(true);
  });

  it('computes coverage counts by hour bucket', () => {
    // A shift 13:00-17:00 covers buckets for hours 13,14,15,16 (4 buckets).
    const shifts: Shift[] = [
      makeShift({ start_time: '2026-04-20T13:00:00', end_time: '2026-04-20T17:00:00' }),
      makeShift({ start_time: '2026-04-20T14:00:00', end_time: '2026-04-20T18:00:00' }),
    ];
    const { result } = renderHook(() => usePlannerShiftsIndex(shifts, weekDays));
    const coverage = result.current.coverageByDay.get('2026-04-20')!;
    // Buckets are 6am-11pm (17 buckets). Bucket N covers hour 6+N.
    // Shift 13:00-17:00 covers buckets 7..10 (hours 13,14,15,16).
    // Shift 14:00-18:00 covers buckets 8..11 (hours 14,15,16,17).
    expect(coverage[7]).toBe(1);  // 1pm: only first shift
    expect(coverage[8]).toBe(2);  // 2pm: both shifts
    expect(coverage[10]).toBe(2); // 4pm: both shifts
    expect(coverage[11]).toBe(1); // 5pm: only second shift
    expect(coverage[12]).toBe(0); // 6pm: no one
  });

  it('builds overview day entries for the visible week only', () => {
    const shifts: Shift[] = [
      makeShift({ start_time: '2026-04-20T13:00:00', end_time: '2026-04-20T21:00:00' }),
      makeShift({ start_time: '2026-04-10T13:00:00', end_time: '2026-04-10T21:00:00' }),
    ];
    const { result } = renderHook(() => usePlannerShiftsIndex(shifts, weekDays));
    const overview = result.current.overviewDays;
    expect(overview).toHaveLength(7);
    expect(overview[0].day).toBe('2026-04-20');
    expect(overview[0].pills).toHaveLength(1);
    expect(overview[1].pills).toHaveLength(0);
  });

  it('packs overlapping shifts into separate lanes up to 3, collapses remainder', () => {
    const day = '2026-04-20';
    const shifts: Shift[] = Array.from({ length: 5 }, (_, i) =>
      makeShift({ id: `s${i}`, start_time: `${day}T13:00:00`, end_time: `${day}T17:00:00` }),
    );
    const { result } = renderHook(() => usePlannerShiftsIndex(shifts, weekDays));
    const monday = result.current.overviewDays[0];
    expect(monday.pills.filter((p) => p.lane >= 0 && p.lane < 3)).toHaveLength(3);
    expect(monday.collapsedCount).toBe(2);
  });
});
