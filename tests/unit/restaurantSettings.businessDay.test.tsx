import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * The Business Day control is the ONLY way a restaurant sets the cutoff that
 * every downstream payroll and labor-cost number is bucketed by. Two things
 * about it are easy to get wrong and invisible in review:
 *
 *   - A Select's value is a STRING. The column is SMALLINT with a
 *     CHECK (0..11). Sending "5" instead of 5 is the classic version of this
 *     bug, and PostgREST is lenient enough that it may not fail loudly.
 *   - Saving must also refresh the restaurant CONTEXT. Every consuming hook
 *     reads cutoffHour off `selectedRestaurant` and carries it in its query
 *     key, so a save that only writes the row leaves the whole app rendering
 *     the old buckets until a reload.
 *
 * Mocking follows restaurantSettings.splhConsistency.test.tsx.
 */

const mocks = vi.hoisted(() => ({
  updates: [] as Array<{ table: string; values: Record<string, unknown> }>,
  eqs: [] as Array<{ table: string; column: string; value: unknown }>,
  setSelectedRestaurant: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => {
  type EmptyResult = { data: null; error: null };
  const empty = (): Promise<EmptyResult> => Promise.resolve({ data: null, error: null });
  function makeChain(table: string) {
    const chain = {
      select: () => makeChain(table),
      eq: (column: string, value: unknown) => {
        mocks.eqs.push({ table, column, value });
        return makeChain(table);
      },
      order: () => makeChain(table),
      update: (values: Record<string, unknown>) => {
        mocks.updates.push({ table, values });
        return makeChain(table);
      },
      maybeSingle: empty,
      single: empty,
      upsert: empty,
      then: (resolve: (r: EmptyResult) => unknown, reject: (e: unknown) => unknown) =>
        empty().then(resolve, reject),
    };
    return chain;
  }
  return {
    supabase: {
      from: (table: string) => makeChain(table),
      functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
    },
  };
});

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1', email: 'manager@example.com' } }),
}));

// business_day_start_hour: 2 — a non-default value, so hydration is actually
// proved rather than coinciding with the useState('0') initial value.
const mockUserRestaurant = {
  id: 'ur-1',
  user_id: 'user-1',
  restaurant_id: 'r1',
  role: 'manager',
  created_at: '2026-01-01T00:00:00Z',
  restaurant: {
    id: 'r1',
    name: 'Test Restaurant',
    timezone: 'America/Chicago',
    business_day_start_hour: 2,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
};

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: mockUserRestaurant,
    restaurants: [mockUserRestaurant],
    setSelectedRestaurant: mocks.setSelectedRestaurant,
    loading: false,
    createRestaurant: vi.fn(),
    canCreateRestaurant: false,
  }),
}));

vi.mock('@/hooks/useRestaurants', () => ({
  useRestaurants: () => ({
    updateRestaurant: vi.fn(),
    restaurants: [mockUserRestaurant],
    loading: false,
  }),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('@/hooks/useStaffingSettings', () => ({
  useStaffingSettings: () => ({
    effectiveSettings: {
      target_splh: 30,
      avg_ticket_size: 8,
      target_labor_pct: 25,
      min_staff: 1,
      lookback_weeks: 4,
      manual_projections: null,
      min_crew: null,
      open_shifts_enabled: false,
      require_shift_claim_approval: false,
    },
    updateSettings: vi.fn(),
    isSaving: false,
    isLoading: false,
  }),
}));

vi.mock('@/hooks/useEmployees', () => ({
  useEmployees: () => ({ employees: [], loading: false, error: null }),
}));

import RestaurantSettings from '@/pages/RestaurantSettings';

const renderPayrollTab = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={['/settings?tab=payroll']}>
      <QueryClientProvider client={qc}>
        <RestaurantSettings />
      </QueryClientProvider>
    </MemoryRouter>
  );
};

const businessDayTrigger = () => screen.getByLabelText(/business day starts at/i);

describe('<RestaurantSettings> Payroll tab — Business Day', () => {
  beforeEach(() => {
    mocks.updates.length = 0;
    mocks.eqs.length = 0;
    mocks.setSelectedRestaurant.mockClear();
  });

  it('hydrates the control from the restaurant row', async () => {
    renderPayrollTab();
    // getByLabelText resolving at all is the htmlFor/id association; the text
    // is the stored 2 rendered as wall-clock rather than as a bare integer.
    expect(await screen.findByText('2:00 AM')).toBeInTheDocument();
  });

  it('describes what the setting does, wired to the control for screen readers', async () => {
    renderPayrollTab();
    const trigger = await screen.findByLabelText(/business day starts at/i);
    const helpId = trigger.getAttribute('aria-describedby');
    expect(helpId).toBeTruthy();
    expect(document.getElementById(helpId as string)).toHaveTextContent(
      /counts toward the previous business day/i
    );
  });

  it('offers exactly the 12 hours the CHECK constraint allows', async () => {
    renderPayrollTab();
    fireEvent.click(await screen.findByLabelText(/business day starts at/i));

    const listbox = await screen.findByRole('listbox');
    const options = within(listbox).getAllByRole('option');
    expect(options).toHaveLength(12);
    // Midnight is spelled out; 11 AM is the last legal hour. A 12-hour list
    // has no PM entries to confuse with, which is why the control is a Select.
    expect(options[0]).toHaveTextContent('12:00 AM (midnight)');
    expect(options[11]).toHaveTextContent('11:00 AM');
  });

  it('saves the chosen hour as a NUMBER and refreshes the restaurant context', async () => {
    renderPayrollTab();
    fireEvent.click(await screen.findByLabelText(/business day starts at/i));

    const listbox = await screen.findByRole('listbox');
    fireEvent.click(within(listbox).getByRole('option', { name: '5:00 AM' }));
    await waitFor(() => expect(businessDayTrigger()).toHaveTextContent('5:00 AM'));

    fireEvent.click(screen.getByRole('button', { name: /save business day/i }));

    await waitFor(() => {
      const update = mocks.updates.find((u) => u.table === 'restaurants');
      expect(update?.values).toEqual({ business_day_start_hour: 5 });
      // Not '5'. A string would still be a valid SMALLINT literal to
      // PostgREST, so nothing downstream would complain -- but Number() is
      // what safeCutoffHour and every query key expect.
      expect(typeof update?.values.business_day_start_hour).toBe('number');
    });

    expect(mocks.eqs).toContainEqual({ table: 'restaurants', column: 'id', value: 'r1' });

    // The context object must carry the new hour, or every hook that keys on
    // cutoffHour keeps serving the old buckets until a page reload.
    const pushed = mocks.setSelectedRestaurant.mock.calls.at(-1)?.[0];
    expect(pushed?.restaurant?.business_day_start_hour).toBe(5);
    // A fresh object, not a mutation of the one in context -- React compares
    // by reference.
    expect(pushed).not.toBe(mockUserRestaurant);
    expect(pushed?.restaurant?.timezone).toBe('America/Chicago');
  });
});
