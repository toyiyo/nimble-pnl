/**
 * Regression test for the handleApplyDate day-shift bug (CodeRabbit review,
 * PR #682): `date` from the DatePicker is a local-midnight calendar-day
 * token (case (a) -- see restaurantClock.ts's module doc), not an instant.
 * The pre-fix code ran it through `formatInTimeZone(date, restaurantTz, ...)`,
 * which re-derives the day from an instant -- for a restaurant zone behind
 * the viewer's host clock that yields the PREVIOUS day, so imported sales
 * get attributed to the wrong business day.
 *
 * Fix: `toDateOnlyString(date)` -- serialize the picked Date's own local
 * fields, never route a calendar day through a zone converter.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { format } from 'date-fns';
import { POSSalesImportReview } from '../../src/components/POSSalesImportReview';

vi.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: {
      restaurant_id: 'r1',
      // West of UTC. The bug reads the local-midnight token as an instant and
      // re-derives the day in this (behind) zone, landing on the previous day.
      restaurant: { timezone: 'America/Chicago' },
    },
  }),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => Promise.resolve({ data: [], error: null })),
      insert: vi.fn(() => ({ select: vi.fn(() => Promise.resolve({ data: [], error: null })) })),
    })),
  },
}));

const SALE_WITHOUT_DATE = {
  itemName: 'Burger',
  quantity: 1,
  totalPrice: 10,
  saleDate: '',
  rawData: {},
};
const salesDataNeedsDate = Object.assign([SALE_WITHOUT_DATE], { needsDateInput: true });

/**
 * Opens the primary DatePicker, clicks day "15" of whatever month it
 * currently displays (defaults to the current month), and returns the
 * rendered "Date" table-cell text for the Burger row once applied.
 */
async function pickDay15AndReadRowText(): Promise<string> {
  const user = userEvent.setup();
  render(
    <POSSalesImportReview
      salesData={salesDataNeedsDate}
      onImportComplete={vi.fn()}
      onCancel={vi.fn()}
    />,
  );
  const trigger = screen.getByRole('button', { name: /select sales date/i });
  await user.click(trigger);
  const grid = await screen.findByRole('grid');
  await user.click(within(grid).getByRole('gridcell', { name: '15' }));
  await waitFor(() => {
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
  });
  const row = screen.getByText(/Burger/).closest('tr');
  return row?.textContent ?? '';
}

const ORIGINAL_TZ = process.env.TZ;

describe('POSSalesImportReview — handleApplyDate emits the picked calendar day', () => {
  afterEach(() => {
    process.env.TZ = ORIGINAL_TZ;
    vi.clearAllMocks();
  });

  it('under TZ=UTC, with a restaurant zone behind UTC (America/Chicago)', async () => {
    process.env.TZ = 'UTC';
    // Read "today" through the same clock the Calendar's defaultMonth uses,
    // so the expectation tracks whatever month is actually displayed.
    const now = new Date();
    const expectedLabel = format(new Date(now.getFullYear(), now.getMonth(), 15), 'MMM d, yyyy');
    const shiftedLabel = format(new Date(now.getFullYear(), now.getMonth(), 14), 'MMM d, yyyy');

    const rowText = await pickDay15AndReadRowText();

    expect(rowText).toContain(expectedLabel);
    expect(rowText).not.toContain(shiftedLabel);
  });

  it('under a viewer zone east of the restaurant (Pacific/Auckland vs America/Chicago)', async () => {
    process.env.TZ = 'Pacific/Auckland';
    const now = new Date();
    const expectedLabel = format(new Date(now.getFullYear(), now.getMonth(), 15), 'MMM d, yyyy');
    const shiftedLabel = format(new Date(now.getFullYear(), now.getMonth(), 14), 'MMM d, yyyy');

    const rowText = await pickDay15AndReadRowText();

    expect(rowText).toContain(expectedLabel);
    expect(rowText).not.toContain(shiftedLabel);
  });
});
