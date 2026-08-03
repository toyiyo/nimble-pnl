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

  /**
   * Return the day cell for `day` in the *displayed* month.
   *
   * The shadcn Calendar sets `showOutsideDays`, so react-day-picker renders the
   * adjacent months' spill-over days in the same grid. A day number near either
   * end of the month therefore matches twice — e.g. a grid whose last row is
   * Aug 30 → Sep 5 contains both "5" cells. Outside days carry the
   * `day-outside` class, so drop them and assert the match is unambiguous.
   */
  function getDayCell(grid: HTMLElement, day: string): HTMLElement {
    const cells = within(grid)
      .getAllByRole('gridcell', { name: day })
      .filter((cell) => !cell.classList.contains('day-outside'));
    expect(cells).toHaveLength(1);
    return cells[0];
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
    await user.click(getDayCell(grid, '10'));

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
    await user.click(getDayCell(grid, '20'));

    // After migration: controlled DatePicker closes on a real pick.
    expect(endTrigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('end-date: days before the selected start date are disabled', async () => {
    const user = userEvent.setup();
    render(<BulkInventoryDeductionDialog />);
    await openDialog(user);

    // Pick day 15 in the start-date picker.
    const startTrigger = screen.getByRole('button', { name: /select start date/i });
    await user.click(startTrigger);
    let grid = await screen.findByRole('grid');
    await user.click(getDayCell(grid, '15'));
    // Start picker closes after selection.
    expect(startTrigger).toHaveAttribute('aria-expanded', 'false');

    // Now open the end-date picker — it should show the same month.
    const endTrigger = screen.getByRole('button', { name: /select end date/i });
    await user.click(endTrigger);
    grid = await screen.findByRole('grid');

    // Day 5 is before the start (day 15) → it must be disabled.
    // react-day-picker renders each day as a <button role="gridcell">;
    // disabled days carry the HTML `disabled` attribute directly on the button.
    expect(getDayCell(grid, '5')).toBeDisabled();

    // Day 20 is after the start (day 15) → it must NOT be disabled.
    expect(getDayCell(grid, '20')).not.toBeDisabled();
  });
});
