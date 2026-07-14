/**
 * Tests that EmployeeSidebar accepts `availabilityByEmployee` + `timezone`
 * props (Task 5) and threads them down to EmployeeMiniWeek per employee,
 * along with a stable concrete per-day Date[] derived from weekDays.
 *
 * Also pins the memoization contract: the internal DraggableEmployee row
 * must re-render (and therefore re-invoke EmployeeMiniWeek) when the
 * employee's availability map or the restaurant timezone changes identity,
 * but must NOT re-render when an unrelated prop changes while availability/
 * timezone stay referentially stable.
 *
 * EmployeeMiniWeek is mocked to a spy so this test only pins
 * EmployeeSidebar's wiring + comparator (Task 6 covers how EmployeeMiniWeek
 * itself renders the tint/aria summary).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';

import { EmployeeSidebar } from '@/components/scheduling/ShiftPlanner/EmployeeSidebar';
import type { EmployeeSidebarProps } from '@/components/scheduling/ShiftPlanner/EmployeeSidebar';
import type { EffectiveAvailability } from '@/lib/effectiveAvailability';
import type { Shift } from '@/types/scheduling';

const miniWeekSpy = vi.fn();

vi.mock('@/components/scheduling/ShiftPlanner/EmployeeMiniWeek', () => ({
  EmployeeMiniWeek: (props: Record<string, unknown>) => {
    miniWeekSpy(props);
    return <div data-testid="mini-week" />;
  },
}));

const weekDays = [
  '2027-07-12', '2027-07-13', '2027-07-14', '2027-07-15',
  '2027-07-16', '2027-07-17', '2027-07-18',
];

const employees = [
  { id: 'emp-1', name: 'Ann', position: 'Server', area: 'Front' },
];

const shiftsByEmployee = new Map<string, Shift[]>();

function makeAvailability(): EffectiveAvailability {
  return {
    type: 'recurring',
    slots: [{
      isAvailable: true,
      startTime: '09:00',
      endTime: '17:00',
      sourceRecord: {} as EffectiveAvailability['slots'][number]['sourceRecord'],
    }],
  };
}

function baseProps(overrides: Partial<EmployeeSidebarProps> = {}): EmployeeSidebarProps {
  const availabilityByEmployee = new Map<string, Map<number, EffectiveAvailability>>([
    ['emp-1', new Map([[1, makeAvailability()]])],
  ]);
  return {
    employees,
    shifts: [],
    weekDays,
    shiftsByEmployee,
    availabilityByEmployee,
    timezone: 'America/Chicago',
    ...overrides,
  };
}

describe('<EmployeeSidebar> availability props', () => {
  beforeEach(() => {
    miniWeekSpy.mockClear();
  });

  it('threads availabilityByDow + timezone + concrete dates to EmployeeMiniWeek', () => {
    const props = baseProps();
    render(<EmployeeSidebar {...props} />);

    expect(miniWeekSpy).toHaveBeenCalledTimes(1);
    const call = miniWeekSpy.mock.calls[0][0] as {
      availabilityByDow: Map<number, EffectiveAvailability>;
      timezone: string;
      dates: Date[];
    };
    expect(call.availabilityByDow).toBe(props.availabilityByEmployee.get('emp-1'));
    expect(call.timezone).toBe('America/Chicago');
    expect(call.dates).toHaveLength(7);
    expect(call.dates[0].getFullYear()).toBe(2027);
    expect(call.dates[0].getMonth()).toBe(6); // July, 0-indexed
    expect(call.dates[0].getDate()).toBe(12);
  });

  it('does not re-render the row when availability/timezone are referentially unchanged', () => {
    const props = baseProps();
    const { rerender } = render(<EmployeeSidebar {...props} />);
    expect(miniWeekSpy).toHaveBeenCalledTimes(1);

    // Re-render with a new EmployeeSidebar props object, but the SAME
    // availabilityByEmployee / timezone / weekDays / shiftsByEmployee
    // references and equivalent employees array content.
    rerender(<EmployeeSidebar {...baseProps({
      availabilityByEmployee: props.availabilityByEmployee,
      timezone: props.timezone,
      weekDays: props.weekDays,
      shiftsByEmployee: props.shiftsByEmployee,
      employees: props.employees,
      shifts: props.shifts,
    })} />);

    expect(miniWeekSpy).toHaveBeenCalledTimes(1);
  });

  it('re-renders the row when the availability map identity changes', () => {
    const props = baseProps();
    const { rerender } = render(<EmployeeSidebar {...props} />);
    expect(miniWeekSpy).toHaveBeenCalledTimes(1);

    const newAvailabilityByEmployee = new Map<string, Map<number, EffectiveAvailability>>([
      ['emp-1', new Map([[1, makeAvailability()]])],
    ]);

    rerender(<EmployeeSidebar {...baseProps({
      availabilityByEmployee: newAvailabilityByEmployee,
      timezone: props.timezone,
      weekDays: props.weekDays,
      shiftsByEmployee: props.shiftsByEmployee,
      employees: props.employees,
      shifts: props.shifts,
    })} />);

    expect(miniWeekSpy).toHaveBeenCalledTimes(2);
    const secondCall = miniWeekSpy.mock.calls[1][0] as {
      availabilityByDow: Map<number, EffectiveAvailability>;
    };
    expect(secondCall.availabilityByDow).toBe(newAvailabilityByEmployee.get('emp-1'));
  });

  it('re-renders the row when the timezone changes', () => {
    const props = baseProps();
    const { rerender } = render(<EmployeeSidebar {...props} />);
    expect(miniWeekSpy).toHaveBeenCalledTimes(1);

    rerender(<EmployeeSidebar {...baseProps({
      availabilityByEmployee: props.availabilityByEmployee,
      timezone: 'America/Los_Angeles',
      weekDays: props.weekDays,
      shiftsByEmployee: props.shiftsByEmployee,
      employees: props.employees,
      shifts: props.shifts,
    })} />);

    expect(miniWeekSpy).toHaveBeenCalledTimes(2);
    const secondCall = miniWeekSpy.mock.calls[1][0] as { timezone: string };
    expect(secondCall.timezone).toBe('America/Los_Angeles');
  });
});
