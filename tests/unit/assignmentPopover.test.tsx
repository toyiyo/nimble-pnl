import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AssignmentPopover } from '@/components/scheduling/ShiftPlanner/AssignmentPopover';
import { getActiveDaysForWeek } from '@/hooks/useShiftPlanner';

describe('AssignmentPopover', () => {
  const defaultProps = {
    open: true,
    employeeName: 'Sarah Johnson',
    shiftName: 'Morning',
    activeDayCount: 5,
    onAssignDay: vi.fn(),
    onAssignAll: vi.fn(),
    onCancel: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders employee and shift name', () => {
    render(<AssignmentPopover {...defaultProps} />);
    expect(screen.getByText(/Sarah Johnson/)).toBeTruthy();
    expect(screen.getByText(/Morning/)).toBeTruthy();
  });

  it('shows day count in all-days button', () => {
    render(<AssignmentPopover {...defaultProps} />);
    expect(screen.getByText(/All 5 days/)).toBeTruthy();
  });

  it('calls onAssignDay when This day only clicked', () => {
    render(<AssignmentPopover {...defaultProps} />);
    fireEvent.click(screen.getByText(/This day only/));
    expect(defaultProps.onAssignDay).toHaveBeenCalledOnce();
  });

  it('calls onAssignAll when All days clicked', () => {
    render(<AssignmentPopover {...defaultProps} />);
    fireEvent.click(screen.getByText(/All 5 days/));
    expect(defaultProps.onAssignAll).toHaveBeenCalledOnce();
  });
});

describe('getActiveDaysForWeek', () => {
  it('returns only days the template applies to', () => {
    // Week of Mon Mar 2 to Sun Mar 8, 2026
    const weekDays = [
      '2026-03-02',
      '2026-03-03',
      '2026-03-04',
      '2026-03-05',
      '2026-03-06',
      '2026-03-07',
      '2026-03-08',
    ];
    // Template for Mon-Fri (days 1-5)
    const template = { days: [1, 2, 3, 4, 5] };
    const result = getActiveDaysForWeek(template, weekDays);
    expect(result).toEqual([
      '2026-03-02',
      '2026-03-03',
      '2026-03-04',
      '2026-03-05',
      '2026-03-06',
    ]);
  });

  it('returns empty for no matching days', () => {
    const weekDays = ['2026-03-07', '2026-03-08']; // Sat, Sun
    const template = { days: [1, 2, 3, 4, 5] }; // Mon-Fri only
    const result = getActiveDaysForWeek(template, weekDays);
    expect(result).toEqual([]);
  });
});
