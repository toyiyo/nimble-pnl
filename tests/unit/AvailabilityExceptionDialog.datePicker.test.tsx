/**
 * Regression test for BUG-001: AvailabilityExceptionDialog date picker
 * must use the controlled DatePicker primitive (no initialFocus) so that
 * the first calendar click registers inside a modal Dialog.
 *
 * RED phase: verifies close-on-select behaviour that only works after
 * replacing the uncontrolled Popover+Calendar+initialFocus block with
 * <DatePicker>.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AvailabilityExceptionDialog } from '../../src/components/AvailabilityExceptionDialog';

// ── Mock hooks ──────────────────────────────────────────────────────────────
vi.mock('@/hooks/useAvailability', () => ({
  useCreateAvailabilityException: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateAvailabilityException: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: { restaurant: { id: 'r1', timezone: 'UTC' } },
  }),
}));

// EmployeeSelector uses supabase queries — stub them out.
vi.mock('@/integrations/supabase/client', () => {
  function makeChain(): any {
    const chain: any = {};
    ['select', 'eq', 'not', 'is', 'order', 'limit'].forEach(
      (m) => (chain[m] = () => makeChain()),
    );
    chain.single = () => Promise.resolve({ data: null, error: null });
    chain.then = (res: (v: { data: any[]; error: null }) => any) =>
      Promise.resolve({ data: [], error: null }).then(res);
    chain.catch = (rej: (e: unknown) => any) =>
      Promise.resolve({ data: [], error: null }).catch(rej);
    return chain;
  }
  return { supabase: { from: () => makeChain() } };
});

// ── Helper ──────────────────────────────────────────────────────────────────
const JAN_2026 = new Date(2026, 0, 1);

function renderDialog() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false, staleTime: Infinity },
    },
  });
  return render(
    <QueryClientProvider client={qc}>
      <AvailabilityExceptionDialog
        open
        onOpenChange={vi.fn()}
        restaurantId="r1"
        defaultDate={JAN_2026}
      />
    </QueryClientProvider>,
  );
}

// ── Tests ────────────────────────────────────────────────────────────────────
describe('AvailabilityExceptionDialog — date picker (BUG-001 regression)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the date picker trigger button', () => {
    renderDialog();
    // After migration the date field is a <DatePicker> which renders a button
    // with the formatted date or placeholder text.
    const trigger = screen.getByRole('button', { name: /select date/i });
    expect(trigger).toBeInTheDocument();
  });

  it('opens the calendar when the date trigger is clicked', async () => {
    const user = userEvent.setup();
    renderDialog();
    const trigger = screen.getByRole('button', { name: /select date/i });
    await user.click(trigger);
    expect(await screen.findByRole('grid')).toBeInTheDocument();
  });

  it('closes the calendar (popover) after a date is selected — the BUG-001 fix', async () => {
    const user = userEvent.setup();
    renderDialog();
    const trigger = screen.getByRole('button', { name: /select date/i });
    await user.click(trigger);
    const grid = await screen.findByRole('grid');
    // Click day 15 in the calendar.
    await user.click(within(grid).getByRole('gridcell', { name: '15' }));
    // After migration: the controlled DatePicker closes on selection.
    // aria-expanded on the trigger must be 'false'.
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });
});
