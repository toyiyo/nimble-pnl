/**
 * Tests for buildShiftConflictIndex / usePlannerShiftConflicts.
 *
 * The index is the planner's read-time mirror of the two conflict RPCs:
 * check_timeoff_conflict (status filter, local-date frame, midnight-end
 * rule, closed-interval overlap) and check_availability_conflict (through
 * the shared shiftOutsideAvailability predicate).
 *
 * Fixtures anchor to explicit UTC instants and timezone 'UTC', so stored
 * UTC TIME strings equal local wall-clock times on any runner.
 */
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';

import {
  buildShiftConflictIndex,
  usePlannerShiftConflicts,
} from '@/hooks/usePlannerShiftConflicts';
import { computeEffectiveAvailability } from '@/lib/effectiveAvailability';

import type {
  Shift,
  TimeOffRequest,
  EmployeeAvailability,
  AvailabilityException,
} from '@/types/scheduling';

const TZ = 'UTC';

let nextShiftId = 0;
function makeShift(partial: Partial<Shift>): Shift {
  return {
    id: 's' + (nextShiftId++),
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

let nextTimeOffId = 0;
function makeTimeOff(partial: Partial<TimeOffRequest>): TimeOffRequest {
  return {
    id: 't' + (nextTimeOffId++),
    restaurant_id: 'r1',
    employee_id: 'e1',
    start_date: '2026-04-21',
    end_date: '2026-04-22',
    status: 'approved',
    requested_at: '',
    created_at: '',
    updated_at: '',
    ...partial,
  };
}

function makeAvailability(partial: Partial<EmployeeAvailability>): EmployeeAvailability {
  return {
    id: 'a' + Math.random(),
    restaurant_id: 'r1',
    employee_id: 'e1',
    day_of_week: 1, // Monday
    start_time: '09:00:00',
    end_time: '17:00:00',
    is_available: true,
    created_at: '',
    updated_at: '',
    ...partial,
  };
}

// Week of Monday 2026-04-20 (a real Monday).
const WEEK_START = new Date(2026, 3, 20);

function availabilityMap(
  availability: EmployeeAvailability[],
  exceptions: AvailabilityException[] = [],
  employeeIds: string[] = ['e1'],
) {
  return computeEffectiveAvailability(availability, exceptions, WEEK_START, employeeIds);
}

const EMPTY_AVAILABILITY = new Map<string, Map<number, ReturnType<typeof Object>>>() as ReturnType<
  typeof computeEffectiveAvailability
>;

describe('buildShiftConflictIndex — time-off', () => {
  it('flags an approved time-off overlap with the schedule-view message', () => {
    const shift = makeShift({
      start_time: '2026-04-21T13:00:00Z',
      end_time: '2026-04-21T21:00:00Z',
    });
    const index = buildShiftConflictIndex(
      [shift],
      EMPTY_AVAILABILITY,
      [makeTimeOff({ start_date: '2026-04-21', end_date: '2026-04-22' })],
      TZ,
    );
    expect(index.get(shift.id)).toEqual([
      'Employee has approved time-off from 2026-04-21 to 2026-04-22',
    ]);
  });

  it('flags a pending time-off overlap and names the status', () => {
    const shift = makeShift({
      start_time: '2026-04-21T13:00:00Z',
      end_time: '2026-04-21T21:00:00Z',
    });
    const index = buildShiftConflictIndex(
      [shift],
      EMPTY_AVAILABILITY,
      [makeTimeOff({ status: 'pending' })],
      TZ,
    );
    expect(index.get(shift.id)?.[0]).toContain('pending time-off');
  });

  it('ignores a rejected request and a non-overlapping request', () => {
    const shift = makeShift({
      start_time: '2026-04-21T13:00:00Z',
      end_time: '2026-04-21T21:00:00Z',
    });
    const index = buildShiftConflictIndex(
      [shift],
      EMPTY_AVAILABILITY,
      [
        makeTimeOff({ status: 'rejected' }),
        makeTimeOff({ start_date: '2026-04-23', end_date: '2026-04-24' }),
      ],
      TZ,
    );
    expect(index.has(shift.id)).toBe(false);
  });

  it('ignores requests of a different employee', () => {
    const shift = makeShift({
      start_time: '2026-04-21T13:00:00Z',
      end_time: '2026-04-21T21:00:00Z',
    });
    const index = buildShiftConflictIndex(
      [shift],
      EMPTY_AVAILABILITY,
      [makeTimeOff({ employee_id: 'e2' })],
      TZ,
    );
    expect(index.has(shift.id)).toBe(false);
  });

  it('skips cancelled, completed, and unassigned shifts', () => {
    const cancelled = makeShift({ status: 'cancelled', start_time: '2026-04-21T13:00:00Z', end_time: '2026-04-21T21:00:00Z' });
    const completed = makeShift({ status: 'completed', start_time: '2026-04-21T13:00:00Z', end_time: '2026-04-21T21:00:00Z' });
    const unassigned = makeShift({ employee_id: '', start_time: '2026-04-21T13:00:00Z', end_time: '2026-04-21T21:00:00Z' });
    const index = buildShiftConflictIndex(
      [cancelled, completed, unassigned],
      EMPTY_AVAILABILITY,
      [makeTimeOff({})],
      TZ,
    );
    expect(index.size).toBe(0);
  });

  it('gives a shift that ends at local midnight to its start day (RPC midnight rule)', () => {
    // Shift Tue 18:00 -> Wed 00:00. Time-off covers Wednesday only.
    const shift = makeShift({
      start_time: '2026-04-21T18:00:00Z',
      end_time: '2026-04-22T00:00:00Z',
    });
    const index = buildShiftConflictIndex(
      [shift],
      EMPTY_AVAILABILITY,
      [makeTimeOff({ start_date: '2026-04-22', end_date: '2026-04-22' })],
      TZ,
    );
    expect(index.has(shift.id)).toBe(false);
  });

  it('matches a cross-midnight shift against the second day', () => {
    // Shift Tue 20:00 -> Wed 02:00. Time-off covers Wednesday only.
    const shift = makeShift({
      start_time: '2026-04-21T20:00:00Z',
      end_time: '2026-04-22T02:00:00Z',
    });
    const index = buildShiftConflictIndex(
      [shift],
      EMPTY_AVAILABILITY,
      [makeTimeOff({ start_date: '2026-04-22', end_date: '2026-04-22' })],
      TZ,
    );
    expect(index.has(shift.id)).toBe(true);
  });
});

describe('buildShiftConflictIndex — availability', () => {
  it('flags a shift on a recurring-off day', () => {
    const shift = makeShift({
      start_time: '2026-04-20T13:00:00Z',
      end_time: '2026-04-20T17:00:00Z',
    });
    const map = availabilityMap([makeAvailability({ is_available: false })]);
    const index = buildShiftConflictIndex([shift], map, [], TZ);
    expect(index.get(shift.id)?.[0]).toMatch(/outside availability/);
  });

  it('flags a shift outside the available window and renders the window', () => {
    // Window Mon 09:00-17:00 UTC; shift 06:00-14:00 UTC starts before it.
    const shift = makeShift({
      start_time: '2026-04-20T06:00:00Z',
      end_time: '2026-04-20T14:00:00Z',
    });
    const map = availabilityMap([makeAvailability({})]);
    const index = buildShiftConflictIndex([shift], map, [], TZ);
    expect(index.get(shift.id)?.[0]).toMatch(
      /outside availability \(available 9:00 AM – 5:00 PM\)/,
    );
  });

  it('does not flag a shift inside the available window', () => {
    const shift = makeShift({
      start_time: '2026-04-20T10:00:00Z',
      end_time: '2026-04-20T16:00:00Z',
    });
    const map = availabilityMap([makeAvailability({})]);
    const index = buildShiftConflictIndex([shift], map, [], TZ);
    expect(index.has(shift.id)).toBe(false);
  });

  it('flags a shift on an unavailable-exception day', () => {
    const exception: AvailabilityException = {
      id: 'x1',
      restaurant_id: 'r1',
      employee_id: 'e1',
      date: '2026-04-21',
      is_available: false,
      created_at: '',
      updated_at: '',
    };
    const shift = makeShift({
      start_time: '2026-04-21T13:00:00Z',
      end_time: '2026-04-21T17:00:00Z',
    });
    const map = availabilityMap([], [exception]);
    const index = buildShiftConflictIndex([shift], map, [], TZ);
    expect(index.get(shift.id)?.[0]).toMatch(/outside availability/);
  });

  it('does not flag a day with no availability data at all', () => {
    const shift = makeShift({
      start_time: '2026-04-20T13:00:00Z',
      end_time: '2026-04-20T17:00:00Z',
    });
    const map = availabilityMap([]); // every day 'not-set'
    const index = buildShiftConflictIndex([shift], map, [], TZ);
    expect(index.has(shift.id)).toBe(false);
  });

  it('skips the availability check when the employee has no map entry, and keeps time-off', () => {
    const shift = makeShift({
      start_time: '2026-04-21T13:00:00Z',
      end_time: '2026-04-21T21:00:00Z',
    });
    const index = buildShiftConflictIndex(
      [shift],
      EMPTY_AVAILABILITY,
      [makeTimeOff({})],
      TZ,
    );
    expect(index.get(shift.id)).toHaveLength(1);
    expect(index.get(shift.id)?.[0]).toContain('time-off');
  });

  it('collects time-off and availability lines on the same shift', () => {
    const shift = makeShift({
      start_time: '2026-04-20T06:00:00Z',
      end_time: '2026-04-20T14:00:00Z',
    });
    const map = availabilityMap([makeAvailability({})]);
    const index = buildShiftConflictIndex(
      [shift],
      map,
      [makeTimeOff({ start_date: '2026-04-20', end_date: '2026-04-20' })],
      TZ,
    );
    expect(index.get(shift.id)).toHaveLength(2);
  });
});

describe('usePlannerShiftConflicts', () => {
  it('returns the index and counts conflicted shifts once each', () => {
    const conflicted1 = makeShift({
      start_time: '2026-04-21T13:00:00Z',
      end_time: '2026-04-21T21:00:00Z',
    });
    const conflicted2 = makeShift({
      start_time: '2026-04-22T13:00:00Z',
      end_time: '2026-04-22T21:00:00Z',
    });
    const clean = makeShift({
      start_time: '2026-04-24T13:00:00Z',
      end_time: '2026-04-24T21:00:00Z',
    });
    const { result } = renderHook(() =>
      usePlannerShiftConflicts(
        [conflicted1, conflicted2, clean],
        EMPTY_AVAILABILITY,
        [makeTimeOff({ start_date: '2026-04-21', end_date: '2026-04-22' })],
        TZ,
      ),
    );
    expect(result.current.conflictCount).toBe(2);
    expect(result.current.conflictsByShiftId.get(conflicted1.id)).toHaveLength(1);
    expect(result.current.conflictsByShiftId.has(clean.id)).toBe(false);
  });
});
