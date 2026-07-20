/**
 * WeekScheduleMobile — mobile (`md:hidden`) day-focused schedule view.
 *
 * Design: docs/superpowers/specs/2026-07-19-schedule-calendar-readability-design.md
 * §4 "Mobile day-focused layout" (plan Task 8). Covers the sticky day-picker
 * strip (a11y: aria-pressed, aria-current="date" on today, ≥44px targets),
 * default-day selection re-derived per week, full-name employee cards with
 * the weekly availability chip, and the per-day shift/time-off/conflict/empty
 * body states reusing `SchedulingTimeOffCellContent` + `ShiftCard`.
 *
 * `useCheckConflicts` and `useRestaurantContext` are mocked (ShiftCard's own
 * dependencies, mirrors tests/unit/TimelineShiftPopover.test.tsx) so no
 * network call or QueryClientProvider is needed.
 */
import React from 'react';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { WeekScheduleMobile } from '@/components/scheduling/WeekScheduleMobile';
import type { WeekAvailabilitySummary } from '@/lib/effectiveAvailability';
import type { EmployeeWeekTimeOff } from '@/lib/scheduleTimeOff';
import type { Employee, Shift } from '@/types/scheduling';

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: { restaurant: { timezone: 'America/Chicago' } },
  }),
}));

const mockUseCheckConflicts = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/useConflictDetection', () => ({
  useCheckConflicts: (...args: unknown[]) => mockUseCheckConflicts(...args),
}));

beforeEach(() => {
  mockUseCheckConflicts.mockReturnValue({ conflicts: [], hasConflicts: false });
});

// Week of Mon 2026-07-13 .. Sun 2026-07-19.
const weekDays = Array.from({ length: 7 }, (_, i) => new Date(2026, 6, 13 + i));

function makeEmployee(overrides: Partial<Employee> & { id: string; name: string }): Employee {
  return {
    restaurant_id: 'r1',
    position: 'Server',
    status: 'active',
    is_active: true,
    employment_type: 'full_time',
    compensation_type: 'hourly',
    hourly_rate: 1500,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  } as Employee;
}

function makeShift(overrides: Partial<Shift> & { id: string; employee_id: string }): Shift {
  return {
    restaurant_id: 'r1',
    start_time: '2026-07-15T15:00:00.000Z',
    end_time: '2026-07-15T23:00:00.000Z',
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

const emma = makeEmployee({ id: 'e1', name: 'Emma Rodriguez', position: 'Server' });
const wednesdayShift = makeShift({ id: 's1', employee_id: 'e1' }); // Wed Jul 15

function defaultProps() {
  return {
    weekDays,
    employees: [emma],
    getShiftsForEmployee: (employeeId: string, day: Date): Shift[] => {
      if (employeeId !== 'e1') return [];
      return day.getDate() === 15 ? [wednesdayShift] : [];
    },
    weekTimeOff: new Map<string, EmployeeWeekTimeOff>(),
    weekAvailabilityByEmployee: new Map<string, WeekAvailabilitySummary>(),
    hoursPerEmployee: new Map<string, number>([['e1', 8]]),
    selectionMode: false,
    selectedShiftIds: new Set<string>(),
    onEditEmployee: vi.fn(),
    onAddShift: vi.fn(),
    onEditShift: vi.fn(),
    onDeleteShift: vi.fn(),
    onToggleSelectShift: vi.fn(),
  };
}

describe('WeekScheduleMobile — day-picker strip', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 15, 12, 0, 0)); // Wed Jul 15 — mid-week
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders 7 day buttons with a ≥44px touch target', () => {
    render(<WeekScheduleMobile {...defaultProps()} />);
    const buttons = screen.getAllByRole('button', { name: /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d+$/ });
    expect(buttons).toHaveLength(7);
    buttons.forEach((btn) => expect(btn).toHaveClass('min-h-11'));
  });

  it('marks today with aria-current="date" and no other day', () => {
    render(<WeekScheduleMobile {...defaultProps()} />);
    const current = screen.getAllByRole('button').filter((b) => b.getAttribute('aria-current') === 'date');
    expect(current).toHaveLength(1);
    expect(within(current[0]).getByText('15')).toBeInTheDocument();
  });

  it('defaults the selected day to today (aria-pressed=true)', () => {
    render(<WeekScheduleMobile {...defaultProps()} />);
    const pressed = screen.getAllByRole('button').filter((b) => b.getAttribute('aria-pressed') === 'true');
    expect(pressed).toHaveLength(1);
    expect(within(pressed[0]).getByText('15')).toBeInTheDocument();
  });

  it('has a focus-visible ring on day buttons', () => {
    render(<WeekScheduleMobile {...defaultProps()} />);
    const buttons = screen.getAllByRole('button', { name: /^Wed 15$/ });
    expect(buttons[0]).toHaveClass('focus-visible:ring-2');
  });

  it('switches the displayed day on click', () => {
    render(<WeekScheduleMobile {...defaultProps()} />);
    // Wed (default/today) shows the shift.
    expect(screen.getByTestId('shift-card')).toBeInTheDocument();
    // Switch to Monday (Jul 13) — no shift that day.
    fireEvent.click(screen.getByRole('button', { name: 'Mon 13' }));
    expect(screen.queryByTestId('shift-card')).not.toBeInTheDocument();
    expect(screen.getByText('No shift scheduled.')).toBeInTheDocument();
  });

  it('falls back to the first day when today is outside the displayed week', () => {
    vi.setSystemTime(new Date(2026, 7, 1, 12, 0, 0)); // Aug 1 — different week
    render(<WeekScheduleMobile {...defaultProps()} />);
    const pressed = screen.getAllByRole('button').filter((b) => b.getAttribute('aria-pressed') === 'true');
    expect(within(pressed[0]).getByText('13')).toBeInTheDocument();
  });
});

describe('WeekScheduleMobile — employee card', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 15, 12, 0, 0));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the employee full name (not just initials)', () => {
    render(<WeekScheduleMobile {...defaultProps()} />);
    expect(screen.getByText('Emma Rodriguez')).toBeInTheDocument();
  });

  it('shows position, employment type, and weekly hours', () => {
    render(<WeekScheduleMobile {...defaultProps()} />);
    const card = screen.getByTestId('week-schedule-mobile-employee-card');
    expect(within(card).getAllByText('Server').length).toBeGreaterThan(0);
    expect(within(card).getByText('FT')).toBeInTheDocument();
    expect(within(card).getByText('8h')).toBeInTheDocument();
  });

  it('renders the weekly availability chip when provided', () => {
    const props = defaultProps();
    props.weekAvailabilityByEmployee.set('e1', { status: 'limited', label: 'Limited availability' });
    render(<WeekScheduleMobile {...props} />);
    expect(screen.getByText('Limited availability')).toBeInTheDocument();
  });

  it('renders no chip when weekly availability is unset', () => {
    const props = defaultProps();
    props.weekAvailabilityByEmployee.set('e1', { status: 'unset', label: 'Availability not set' });
    render(<WeekScheduleMobile {...props} />);
    expect(screen.queryByText('Availability not set')).not.toBeInTheDocument();
  });

  it('renders the shared ShiftCard for a shift on the selected day', () => {
    render(<WeekScheduleMobile {...defaultProps()} />);
    expect(screen.getByTestId('shift-card')).toBeInTheDocument();
  });

  it('renders an empty state + Add shift button when there is no shift', () => {
    const props = defaultProps();
    render(<WeekScheduleMobile {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Mon 13' }));
    expect(screen.getByText('No shift scheduled.')).toBeInTheDocument();
    const addButton = screen.getByRole('button', { name: /Add shift for Emma Rodriguez on Mon Jul 13/ });
    fireEvent.click(addButton);
    expect(props.onAddShift).toHaveBeenCalledWith(weekDays[0], emma);
  });

  it('shows a "Time off" banner (not a shift) on an off day with no shift', () => {
    const props = defaultProps();
    props.weekTimeOff.set('e1', {
      offDayKeys: new Set(['2026-07-13']),
      spans: [{ startKey: '2026-07-13', endKey: '2026-07-13', dayCount: 1, reasons: [] }],
    });
    render(<WeekScheduleMobile {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Mon 13' }));
    expect(screen.getByText('Time off')).toBeInTheDocument();
    expect(screen.queryByTestId('shift-card')).not.toBeInTheDocument();
  });

  it('flags a shift scheduled during approved time off as a conflict', () => {
    const props = defaultProps();
    props.weekTimeOff.set('e1', {
      offDayKeys: new Set(['2026-07-15']),
      spans: [{ startKey: '2026-07-15', endKey: '2026-07-15', dayCount: 1, reasons: [] }],
    });
    render(<WeekScheduleMobile {...props} />);
    expect(screen.getByText('Conflict')).toBeInTheDocument();
    expect(screen.getByTestId('shift-card')).toBeInTheDocument();
  });

  it('hides the edit-employee and add-shift affordances in selection mode', () => {
    const props = { ...defaultProps(), selectionMode: true };
    render(<WeekScheduleMobile {...props} />);
    expect(screen.queryByRole('button', { name: /^Edit Emma Rodriguez$/ })).not.toBeInTheDocument();
  });

  it('shows the "No team members" empty state when there are no employees', () => {
    const props = { ...defaultProps(), employees: [] };
    render(<WeekScheduleMobile {...props} />);
    expect(screen.getByText('No team members to show.')).toBeInTheDocument();
  });
});
