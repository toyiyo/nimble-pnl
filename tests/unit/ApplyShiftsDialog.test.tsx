import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock useApplySuggestedShifts so the dialog renders without real supabase
const mockApplyShifts = vi.fn();
vi.mock('@/hooks/useApplySuggestedShifts', () => ({
  useApplySuggestedShifts: () => ({ applyShifts: mockApplyShifts, isApplying: false }),
}));

import { ApplyShiftsDialog } from '@/components/scheduling/ShiftPlanner/ApplyShiftsDialog';
import type { ShiftBlock } from '@/types/scheduling';

const wrapper = ({ children }: { children: React.ReactNode }) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
};

const blocks: ShiftBlock[] = [
  { startHour: 17, endHour: 22, headcount: 4, day: '2026-05-29' }, // Friday
  { startHour: 9, endHour: 14, headcount: 2, day: '2026-05-30' },  // Saturday
];

describe('<ApplyShiftsDialog>', () => {
  const onOpenChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders a dialog title when open', () => {
    render(
      <ApplyShiftsDialog
        open={true}
        onOpenChange={onOpenChange}
        blocks={blocks}
        minCrew={null}
        restaurantId="r1"
        openShiftsEnabled={true}
      />,
      { wrapper },
    );
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText(/apply suggested shifts/i)).toBeTruthy();
  });

  it('renders one checkbox per block with descriptive aria-label', () => {
    render(
      <ApplyShiftsDialog
        open={true}
        onOpenChange={onOpenChange}
        blocks={blocks}
        minCrew={null}
        restaurantId="r1"
        openShiftsEnabled={true}
      />,
      { wrapper },
    );
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes).toHaveLength(2);
    // Both blocks should be checked initially
    checkboxes.forEach((cb) => expect(cb).toBeChecked());
    // aria-labels describe the block
    expect(checkboxes[0].getAttribute('aria-label')).toMatch(/include/i);
    expect(checkboxes[0].getAttribute('aria-label')).toMatch(/fri/i);
  });

  it('shows no-crew nudge when minCrew is null', () => {
    render(
      <ApplyShiftsDialog
        open={true}
        onOpenChange={onOpenChange}
        blocks={blocks}
        minCrew={null}
        restaurantId="r1"
        openShiftsEnabled={true}
      />,
      { wrapper },
    );
    expect(screen.getByText(/no minimum crew set/i)).toBeTruthy();
  });

  it('does not show no-crew nudge when minCrew is set', () => {
    render(
      <ApplyShiftsDialog
        open={true}
        onOpenChange={onOpenChange}
        blocks={blocks}
        minCrew={{ Server: 2, Cook: 1 }}
        restaurantId="r1"
        openShiftsEnabled={true}
      />,
      { wrapper },
    );
    expect(screen.queryByText(/no minimum crew set/i)).toBeNull();
  });

  it('shows no-crew nudge when minCrew has only zero-weight positions', () => {
    // Bug guard: {Server: 0} has keys but no effective crew — must show the warning
    // because distributePositions falls through to the generic "Staff" fallback.
    render(
      <ApplyShiftsDialog
        open={true}
        onOpenChange={onOpenChange}
        blocks={blocks}
        minCrew={{ Server: 0 }}
        restaurantId="r1"
        openShiftsEnabled={true}
      />,
      { wrapper },
    );
    expect(screen.getByText(/no minimum crew set/i)).toBeTruthy();
  });

  it('shows open-shifts-disabled note when openShiftsEnabled is false', () => {
    render(
      <ApplyShiftsDialog
        open={true}
        onOpenChange={onOpenChange}
        blocks={blocks}
        minCrew={null}
        restaurantId="r1"
        openShiftsEnabled={false}
      />,
      { wrapper },
    );
    expect(screen.getByText(/template grid/i)).toBeTruthy();
  });

  it('unchecking a block excludes it from the Create count', () => {
    render(
      <ApplyShiftsDialog
        open={true}
        onOpenChange={onOpenChange}
        blocks={blocks}
        minCrew={null}
        restaurantId="r1"
        openShiftsEnabled={true}
      />,
      { wrapper },
    );
    // Initially both selected → button shows "Create 2 shifts"
    expect(screen.getByRole('button', { name: /create 2 shifts/i })).toBeTruthy();

    // Uncheck the first block
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]);

    // Now shows "Create 1 shift"
    expect(screen.getByRole('button', { name: /create 1 shift/i })).toBeTruthy();
  });

  it('disables the Confirm button when all blocks are unchecked', () => {
    render(
      <ApplyShiftsDialog
        open={true}
        onOpenChange={onOpenChange}
        blocks={blocks}
        minCrew={null}
        restaurantId="r1"
        openShiftsEnabled={true}
      />,
      { wrapper },
    );
    const checkboxes = screen.getAllByRole('checkbox');
    checkboxes.forEach((cb) => fireEvent.click(cb));
    const confirmBtn = screen.getByRole('button', { name: /create 0 shifts/i });
    expect(confirmBtn).toBeDisabled();
  });

  it('calls onOpenChange(false) when Cancel is clicked', () => {
    render(
      <ApplyShiftsDialog
        open={true}
        onOpenChange={onOpenChange}
        blocks={blocks}
        minCrew={null}
        restaurantId="r1"
        openShiftsEnabled={true}
      />,
      { wrapper },
    );
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
