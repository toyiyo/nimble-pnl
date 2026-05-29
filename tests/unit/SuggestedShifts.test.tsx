import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock ApplyShiftsDialog so we only test SuggestedShifts behaviour
vi.mock('@/components/scheduling/ShiftPlanner/ApplyShiftsDialog', () => ({
  ApplyShiftsDialog: ({ open }: { open: boolean }) => (
    open ? <div data-testid="apply-dialog">Dialog open</div> : null
  ),
}));

import { SuggestedShifts } from '@/components/scheduling/ShiftPlanner/SuggestedShifts';
import type { ShiftBlock } from '@/types/scheduling';

const wrapper = ({ children }: { children: React.ReactNode }) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
};

const blocks: ShiftBlock[] = [
  { startHour: 17, endHour: 22, headcount: 4, day: '2026-05-29' }, // Friday
  { startHour: 9, endHour: 14, headcount: 2, day: '2026-05-30' },  // Saturday
  { startHour: 17, endHour: 21, headcount: 3, day: '2026-05-29' }, // Friday, second block same day
];

const defaultProps = {
  blocks,
  minCrew: { Server: 2, Cook: 1 } as Record<string, number>,
  restaurantId: 'r1',
  openShiftsEnabled: true,
};

describe('<SuggestedShifts>', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows empty-state message when blocks is empty', () => {
    render(
      <SuggestedShifts {...defaultProps} blocks={[]} />,
      { wrapper },
    );
    expect(screen.getByText(/no consolidated shifts to suggest/i)).toBeTruthy();
  });

  it('does not render the Apply button when blocks is empty', () => {
    render(
      <SuggestedShifts {...defaultProps} blocks={[]} />,
      { wrapper },
    );
    expect(screen.queryByRole('button', { name: /apply suggested shifts/i })).toBeNull();
  });

  it('renders "Suggested shifts" heading when blocks exist', () => {
    render(
      <SuggestedShifts {...defaultProps} />,
      { wrapper },
    );
    expect(screen.getByText('Suggested shifts')).toBeTruthy();
  });

  it('renders an "Apply suggested shifts" button when blocks exist', () => {
    render(
      <SuggestedShifts {...defaultProps} />,
      { wrapper },
    );
    expect(screen.getByRole('button', { name: /apply suggested shifts/i })).toBeTruthy();
  });

  it('groups blocks by day (two Friday blocks shown under one Fri label)', () => {
    render(
      <SuggestedShifts {...defaultProps} />,
      { wrapper },
    );
    // There should be exactly one "Fri" day label and one "Sat" day label
    const friLabels = screen.getAllByText('Fri');
    const satLabels = screen.getAllByText('Sat');
    expect(friLabels).toHaveLength(1);
    expect(satLabels).toHaveLength(1);
  });

  it('opens the dialog when Apply button is clicked', () => {
    render(
      <SuggestedShifts {...defaultProps} />,
      { wrapper },
    );
    expect(screen.queryByTestId('apply-dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /apply suggested shifts/i }));
    expect(screen.getByTestId('apply-dialog')).toBeTruthy();
  });
});
