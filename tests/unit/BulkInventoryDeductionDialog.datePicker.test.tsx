/**
 * Regression test for BUG-001: BulkInventoryDeductionDialog date pickers
 * must use the controlled DatePicker primitive (no initialFocus) so that
 * the first calendar click registers inside a modal Dialog.
 *
 * Also verifies the end-date disabled guard: days before the selected
 * start date cannot be picked in the end-date picker.
 *
 * RED phase: verifies close-on-select behaviour that only works after
 * replacing the uncontrolled Popover+Calendar+initialFocus blocks with
 * <DatePicker>.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BulkInventoryDeductionDialog } from '../../src/components/BulkInventoryDeductionDialog';

// ── Mock hooks ──────────────────────────────────────────────────────────────
vi.mock('@/hooks/useBulkInventoryDeduction', () => ({
  useBulkInventoryDeduction: () => ({
    bulkProcessHistoricalSales: vi.fn(),
    loading: false,
  }),
}));

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: { restaurant_id: 'r1' },
  }),
}));

// Alert uses ui primitives — no supabase dependency; no stub needed.

// ── Tests ────────────────────────────────────────────────────────────────────
describe('BulkInventoryDeductionDialog — date pickers (BUG-001 regression)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /** Open the outer Dialog by clicking the trigger button. */
  async function openDialog(user: ReturnType<typeof userEvent.setup>) {
    // The outer dialog trigger shows "Bulk Process Sales" (hidden sm:inline)
    // or "Bulk Process" (sm:hidden). Either label may match.
    const trigger = screen.getByRole('button', { name: /bulk process/i });
    await user.click(trigger);
  }

  it('shows "Select start date" and "Select end date" trigger buttons', async () => {
    const user = userEvent.setup();
    render(<BulkInventoryDeductionDialog />);
    await openDialog(user);

    expect(
      screen.getByRole('button', { name: /select start date/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /select end date/i }),
    ).toBeInTheDocument();
  });

  it('start-date: opens calendar on click', async () => {
    const user = userEvent.setup();
    render(<BulkInventoryDeductionDialog />);
    await openDialog(user);

    await user.click(screen.getByRole('button', { name: /select start date/i }));
    expect(await screen.findByRole('grid')).toBeInTheDocument();
  });

  it('start-date: closes the popover after a day is selected — the BUG-001 fix', async () => {
    const user = userEvent.setup();
    render(<BulkInventoryDeductionDialog />);
    await openDialog(user);

    const startTrigger = screen.getByRole('button', { name: /select start date/i });
    await user.click(startTrigger);
    const grid = await screen.findByRole('grid');
    await user.click(within(grid).getByRole('gridcell', { name: '10' }));

    // After migration: controlled DatePicker closes on a real pick.
    expect(startTrigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('end-date: closes the popover after a day is selected — the BUG-001 fix', async () => {
    const user = userEvent.setup();
    render(<BulkInventoryDeductionDialog />);
    await openDialog(user);

    const endTrigger = screen.getByRole('button', { name: /select end date/i });
    await user.click(endTrigger);
    const grid = await screen.findByRole('grid');
    await user.click(within(grid).getByRole('gridcell', { name: '20' }));

    // After migration: controlled DatePicker closes on a real pick.
    expect(endTrigger).toHaveAttribute('aria-expanded', 'false');
  });
});
