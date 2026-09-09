/**
 * Tests for PlannerHeader — conflict rollup pill and unavailable note.
 *
 * Invariants:
 * 1. conflictCount = 1 renders "1 conflict"; above one renders "N conflicts".
 * 2. conflictCount = 0 (or absent) renders no pill.
 * 3. conflictsUnavailable renders the muted note and wins over the pill.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import { PlannerHeader } from '@/components/scheduling/ShiftPlanner/PlannerHeader';

const baseProps = {
  weekStart: new Date(2026, 3, 20),
  weekEnd: new Date(2026, 3, 26),
  totalHours: 40,
  onPrevWeek: vi.fn(),
  onNextWeek: vi.fn(),
  onToday: vi.fn(),
};

describe('PlannerHeader — conflict rollup', () => {
  it('renders the singular pill for one conflict', () => {
    render(<PlannerHeader {...baseProps} conflictCount={1} />);
    expect(screen.getByText('1 conflict')).toBeTruthy();
  });

  it('renders the plural pill above one', () => {
    render(<PlannerHeader {...baseProps} conflictCount={3} />);
    expect(screen.getByText('3 conflicts')).toBeTruthy();
  });

  it('renders no pill at zero and when absent', () => {
    const { rerender } = render(<PlannerHeader {...baseProps} conflictCount={0} />);
    expect(screen.queryByText(/conflict/)).toBeNull();
    rerender(<PlannerHeader {...baseProps} />);
    expect(screen.queryByText(/conflict/)).toBeNull();
  });

  it('renders the muted note instead of the pill when conflicts are unavailable', () => {
    render(<PlannerHeader {...baseProps} conflictCount={3} conflictsUnavailable />);
    expect(screen.getByText('Conflicts unavailable')).toBeTruthy();
    expect(screen.queryByText('3 conflicts')).toBeNull();
  });
});
