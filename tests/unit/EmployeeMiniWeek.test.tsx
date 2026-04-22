import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';

import { EmployeeMiniWeek } from '@/components/scheduling/ShiftPlanner/EmployeeMiniWeek';

import type { Shift } from '@/types/scheduling';

let nextShiftId = 0;
function makeShift(partial: Partial<Shift>): Shift {
  nextShiftId += 1;
  return {
    id: 's' + nextShiftId,
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

describe('<EmployeeMiniWeek>', () => {
  it('renders 7 day columns', () => {
    const { container } = render(
      <EmployeeMiniWeek weekDays={weekDays} employeeShifts={[]} />,
    );
    expect(container.querySelectorAll('[data-mini-week-day]')).toHaveLength(7);
  });

  it('renders a shift bar only inside the day matching the shift start', () => {
    const shifts = [makeShift({ start_time: '2026-04-21T09:00:00', end_time: '2026-04-21T17:00:00' })];
    const { container } = render(
      <EmployeeMiniWeek weekDays={weekDays} employeeShifts={shifts} />,
    );
    const tuesday = container.querySelector('[data-mini-week-day="2026-04-21"]');
    expect(tuesday).not.toBeNull();
    expect(tuesday!.querySelectorAll('[data-mini-bar]')).toHaveLength(1);
    const monday = container.querySelector('[data-mini-week-day="2026-04-20"]');
    expect(monday).not.toBeNull();
    expect(monday!.querySelectorAll('[data-mini-bar]')).toHaveLength(0);
  });

  it('renders multiple bars when employee has multiple shifts on the same day', () => {
    const shifts = [
      makeShift({ id: 'a', start_time: '2026-04-20T07:00:00', end_time: '2026-04-20T11:00:00' }),
      makeShift({ id: 'b', start_time: '2026-04-20T17:00:00', end_time: '2026-04-20T22:00:00' }),
    ];
    const { container } = render(
      <EmployeeMiniWeek weekDays={weekDays} employeeShifts={shifts} />,
    );
    const monday = container.querySelector('[data-mini-week-day="2026-04-20"]');
    expect(monday).not.toBeNull();
    expect(monday!.querySelectorAll('[data-mini-bar]')).toHaveLength(2);
  });
});
