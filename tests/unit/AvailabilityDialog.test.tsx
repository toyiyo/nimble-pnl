/**
 * T7 (impact-aware-deletion plan): AvailabilityDialog gets a destructive
 * "Remove" button, shown only when editing an existing row (and only when
 * the caller supplies `onRemove` — Scheduling.tsx is the only caller that
 * does). Clicking it closes the editor and hands the row up so the caller
 * can open the shared DeleteAvailabilityDialog with a resolved personName.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AvailabilityDialog } from '../../src/components/AvailabilityDialog';
import type { EmployeeAvailability } from '../../src/types/scheduling';

const mockPending = vi.hoisted(() => ({ create: false, update: false }));

vi.mock('@/hooks/useAvailability', () => ({
  useCreateAvailability: () => ({ mutate: vi.fn(), isPending: mockPending.create }),
  useUpdateAvailability: () => ({ mutate: vi.fn(), isPending: mockPending.update }),
}));

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: { restaurant: { id: 'r1', timezone: 'UTC' } },
  }),
}));

// EmployeeSelector queries supabase — stub it out.
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

const existingAvailability: EmployeeAvailability = {
  id: 'avail-1',
  restaurant_id: 'r1',
  employee_id: 'emp-1',
  day_of_week: 1,
  start_time: '09:00:00',
  end_time: '17:00:00',
  is_available: true,
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

describe('AvailabilityDialog — Remove button (T7)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPending.create = false;
    mockPending.update = false;
  });

  it('does not render Remove when creating a new availability (no existing row)', () => {
    renderWithClient(
      <AvailabilityDialog
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
      <AvailabilityDialog
        open
        onOpenChange={vi.fn()}
        restaurantId="r1"
        availability={existingAvailability}
      />,
    );
    expect(screen.queryByRole('button', { name: /remove/i })).not.toBeInTheDocument();
  });

  it('renders Remove when editing an existing availability with onRemove supplied', () => {
    renderWithClient(
      <AvailabilityDialog
        open
        onOpenChange={vi.fn()}
        restaurantId="r1"
        availability={existingAvailability}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /remove/i })).toBeInTheDocument();
  });

  it('clicking Remove closes the editor and calls onRemove with the availability row', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const onRemove = vi.fn();
    renderWithClient(
      <AvailabilityDialog
        open
        onOpenChange={onOpenChange}
        restaurantId="r1"
        availability={existingAvailability}
        onRemove={onRemove}
      />,
    );

    await user.click(screen.getByRole('button', { name: /remove/i }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onRemove).toHaveBeenCalledWith(existingAvailability);
  });

  it('disables Remove while a create/update mutation is in-flight, to avoid racing a save against a delete', () => {
    mockPending.update = true;
    renderWithClient(
      <AvailabilityDialog
        open
        onOpenChange={vi.fn()}
        restaurantId="r1"
        availability={existingAvailability}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /remove/i })).toBeDisabled();
  });
});
