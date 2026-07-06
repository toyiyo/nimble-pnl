/**
 * Unit tests: TimelineShiftEditor — the shared edit/create form used by the
 * Timeline popover (design doc: docs/superpowers/specs/2026-07-05-timeline-edit-create-design.md,
 * plan task B1).
 *
 * `useCheckConflicts` is mocked so no network/Supabase call is exercised here —
 * that hook's own behavior is covered by useConflictDetection's tests. This
 * file pins: field rendering + onChange wiring, employee options ranked via
 * `rankEmployeesForShift`, amber warning chips from local `validateShift` +
 * mocked RPC conflicts, and the single `aria-live="polite"` region.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TimelineShiftEditor } from '@/components/scheduling/ShiftTimeline/TimelineShiftEditor';
import type { Employee, Shift, ConflictCheck } from '@/types/scheduling';

const mockUseCheckConflicts = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/useConflictDetection', () => ({
  useCheckConflicts: (...args: unknown[]) => mockUseCheckConflicts(...args),
}));

function makeEmployee(overrides: Partial<Employee> & { id: string; name: string }): Employee {
  return {
    restaurant_id: 'r1',
    position: 'Server',
    status: 'active',
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  } as Employee;
}

function makeShift(overrides: Partial<Shift> = {}): Shift {
  return {
    id: 'shift-1',
    restaurant_id: 'r1',
    employee_id: 'e1',
    start_time: '2026-03-10T15:00:00.000Z',
    end_time: '2026-03-10T23:00:00.000Z',
    break_duration: 30,
    position: 'Server',
    status: 'scheduled',
    is_published: false,
    locked: false,
    source: 'manual',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  } as Shift;
}

const NO_CONFLICTS = { conflicts: [] as ConflictCheck[], hasConflicts: false, loading: false, error: null };

const employees: Employee[] = [
  makeEmployee({ id: 'e1', name: 'Amy Server', position: 'Server' }),
  makeEmployee({ id: 'e2', name: 'Cody Cook', position: 'Cook' }),
];

describe('TimelineShiftEditor', () => {
  beforeEach(() => {
    mockUseCheckConflicts.mockReset();
    mockUseCheckConflicts.mockReturnValue(NO_CONFLICTS);
  });

  it('renders start/end time fields, employee select, break, and notes', () => {
    render(
      <TimelineShiftEditor
        mode="edit"
        shift={makeShift()}
        employees={employees}
        restaurantId="r1"
        dateStr="2026-03-10"
        tz="America/Chicago"
        existingShifts={[]}
        onChange={() => {}}
        values={{
          employeeId: 'e1',
          startTime: '09:00',
          endTime: '17:00',
          breakDuration: '30',
          notes: '',
        }}
      />,
    );

    expect(screen.getByLabelText(/start time/i)).toBeTruthy();
    expect(screen.getByLabelText(/end time/i)).toBeTruthy();
    expect(screen.getByLabelText(/select employee/i)).toBeTruthy();
    expect(screen.getByLabelText(/break/i)).toBeTruthy();
    expect(screen.getByLabelText(/notes/i)).toBeTruthy();
  });

  it('ranks employees via rankEmployeesForShift using the shift position as context', async () => {
    const user = userEvent.setup();

    render(
      <TimelineShiftEditor
        mode="edit"
        shift={makeShift({ position: 'Cook' })}
        employees={employees}
        restaurantId="r1"
        dateStr="2026-03-10"
        tz="America/Chicago"
        existingShifts={[]}
        onChange={() => {}}
        values={{
          employeeId: 'e1',
          startTime: '09:00',
          endTime: '17:00',
          breakDuration: '30',
          notes: '',
        }}
      />,
    );

    await user.click(screen.getByLabelText(/select employee/i));

    const options = screen.getAllByRole('option').map((el) => el.textContent);
    // Cody Cook (position match) should be ranked ahead of Amy Server.
    expect(options.findIndex((t) => t?.includes('Cody Cook'))).toBeLessThan(
      options.findIndex((t) => t?.includes('Amy Server')),
    );
  });

  it('calls onChange when the start time field changes', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <TimelineShiftEditor
        mode="edit"
        shift={makeShift()}
        employees={employees}
        restaurantId="r1"
        dateStr="2026-03-10"
        tz="America/Chicago"
        existingShifts={[]}
        onChange={onChange}
        values={{
          employeeId: 'e1',
          startTime: '09:00',
          endTime: '17:00',
          breakDuration: '30',
          notes: '',
        }}
      />,
    );

    const startInput = screen.getByLabelText(/start time/i) as HTMLInputElement;
    await user.clear(startInput);
    await user.type(startInput, '10:30');

    expect(onChange).toHaveBeenCalled();
  });

  it('renders an amber conflict chip when useCheckConflicts reports a conflict', () => {
    mockUseCheckConflicts.mockReturnValue({
      conflicts: [
        {
          has_conflict: true,
          conflict_type: 'time-off',
          message: 'Employee has approved time-off from 2026-03-10 to 2026-03-10',
        },
      ] as ConflictCheck[],
      hasConflicts: true,
      loading: false,
      error: null,
    });

    const { container } = render(
      <TimelineShiftEditor
        mode="edit"
        shift={makeShift()}
        employees={employees}
        restaurantId="r1"
        dateStr="2026-03-10"
        tz="America/Chicago"
        existingShifts={[]}
        onChange={() => {}}
        values={{
          employeeId: 'e1',
          startTime: '09:00',
          endTime: '17:00',
          breakDuration: '30',
          notes: '',
        }}
      />,
    );

    expect(screen.getByText(/time-off/i)).toBeTruthy();
    expect(container.querySelector('.bg-amber-500\\/10')).toBeTruthy();
  });

  it('renders an amber chip for local validateShift warnings (e.g. overlap)', () => {
    const overlapping = makeShift({
      id: 'shift-2',
      employee_id: 'e1',
      start_time: '2026-03-10T14:00:00.000Z',
      end_time: '2026-03-10T20:00:00.000Z',
    });

    render(
      <TimelineShiftEditor
        mode="edit"
        shift={makeShift({ id: 'shift-1' })}
        employees={employees}
        restaurantId="r1"
        dateStr="2026-03-10"
        tz="America/Chicago"
        existingShifts={[overlapping]}
        onChange={() => {}}
        values={{
          employeeId: 'e1',
          startTime: '09:00',
          endTime: '17:00',
          breakDuration: '30',
          notes: '',
        }}
      />,
    );

    expect(screen.getByText(/overlaps with existing shift/i)).toBeTruthy();
  });

  it('exposes exactly one aria-live="polite" region', () => {
    mockUseCheckConflicts.mockReturnValue({
      conflicts: [
        { has_conflict: true, conflict_type: 'time-off', message: 'conflict!' },
      ] as ConflictCheck[],
      hasConflicts: true,
      loading: false,
      error: null,
    });

    const { container } = render(
      <TimelineShiftEditor
        mode="edit"
        shift={makeShift()}
        employees={employees}
        restaurantId="r1"
        dateStr="2026-03-10"
        tz="America/Chicago"
        existingShifts={[]}
        onChange={() => {}}
        values={{
          employeeId: 'e1',
          startTime: '09:00',
          endTime: '17:00',
          breakDuration: '30',
          notes: '',
        }}
      />,
    );

    const liveRegions = container.querySelectorAll('[aria-live="polite"]');
    expect(liveRegions.length).toBe(1);
  });

  it('does not call useCheckConflicts (skips RPC) until an employee and both times are set', () => {
    render(
      <TimelineShiftEditor
        mode="create"
        shift={null}
        employees={employees}
        restaurantId="r1"
        dateStr="2026-03-10"
        tz="America/Chicago"
        existingShifts={[]}
        onChange={() => {}}
        values={{
          employeeId: '',
          startTime: '',
          endTime: '',
          breakDuration: '0',
          notes: '',
        }}
      />,
    );

    // First arg is the params object; expect null/falsy when incomplete.
    expect(mockUseCheckConflicts).toHaveBeenCalledWith(null);
  });
});
