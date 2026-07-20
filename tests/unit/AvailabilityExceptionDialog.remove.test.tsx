/**
 * T7 (impact-aware-deletion plan): AvailabilityExceptionDialog gets the same
 * destructive "Remove" affordance as AvailabilityDialog — shown only when
 * editing an existing exception and only when `onRemove` is supplied.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AvailabilityExceptionDialog } from '../../src/components/AvailabilityExceptionDialog';
import type { AvailabilityException } from '../../src/types/scheduling';

vi.mock('@/hooks/useAvailability', () => ({
  useCreateAvailabilityException: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateAvailabilityException: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: { restaurant: { id: 'r1', timezone: 'UTC' } },
  }),
}));

vi.mock('@/integrations/supabase/client', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function makeChain(): any {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chain: any = {};
    ['select', 'eq', 'not', 'is', 'order', 'limit'].forEach(
      (m) => (chain[m] = () => makeChain()),
    );
    chain.single = () => Promise.resolve({ data: null, error: null });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    chain.then = (res: (v: { data: any[]; error: null }) => any) =>
      Promise.resolve({ data: [], error: null }).then(res);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    chain.catch = (rej: (e: unknown) => any) =>
      Promise.resolve({ data: [], error: null }).catch(rej);
    return chain;
  }
  return { supabase: { from: () => makeChain() } };
});

const existingException: AvailabilityException = {
  id: 'exc-1',
  restaurant_id: 'r1',
  employee_id: 'emp-1',
  date: '2026-03-03',
  is_available: false,
  reason: 'Doctor appointment',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

function renderWithClient(ui: React.ReactElement) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false, staleTime: Infinity },
    },
  });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('AvailabilityExceptionDialog — Remove button (T7)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not render Remove when creating a new exception (no existing row)', () => {
    renderWithClient(
      <AvailabilityExceptionDialog
        open
        onOpenChange={vi.fn()}
        restaurantId="r1"
        onRemove={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: /remove/i })).not.toBeInTheDocument();
  });

  it('does not render Remove when editing but the caller supplies no onRemove', () => {
    renderWithClient(
      <AvailabilityExceptionDialog
        open
        onOpenChange={vi.fn()}
        restaurantId="r1"
        exception={existingException}
      />,
    );
    expect(screen.queryByRole('button', { name: /remove/i })).not.toBeInTheDocument();
  });

  it('renders Remove when editing an existing exception with onRemove supplied', () => {
    renderWithClient(
      <AvailabilityExceptionDialog
        open
        onOpenChange={vi.fn()}
        restaurantId="r1"
        exception={existingException}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /remove/i })).toBeInTheDocument();
  });

  it('clicking Remove closes the editor and calls onRemove with the exception row', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const onRemove = vi.fn();
    renderWithClient(
      <AvailabilityExceptionDialog
        open
        onOpenChange={onOpenChange}
        restaurantId="r1"
        exception={existingException}
        onRemove={onRemove}
      />,
    );

    await user.click(screen.getByRole('button', { name: /remove/i }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onRemove).toHaveBeenCalledWith(existingException);
  });
});
