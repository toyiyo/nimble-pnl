/**
 * Task 8 — StaffingOverlay timezone wiring
 * Verifies that the restaurant timezone from useRestaurantContext reaches the
 * get_hourly_sales_pattern RPC as the business-day p_start_date/p_end_date.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { safeTz, toBusinessDay } from '@/lib/restaurantClock';

// ── Mock the Supabase client so the real queryFn (invoked manually below via
// mockUseQuery) hits this spy instead of a live network call. ──────────────────
const { mockSupabase } = vi.hoisted(() => ({ mockSupabase: { from: vi.fn(), rpc: vi.fn() } }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: mockSupabase }));

// ── Stub heavy sub-components ───────────────────────────────────────────────────
vi.mock('@/components/scheduling/ShiftPlanner/SuggestedShifts', () => ({
  SuggestedShifts: () => <div data-testid="suggested-shifts" />,
}));
vi.mock('@/components/scheduling/ShiftPlanner/StaffingConfigPanel', () => ({
  StaffingConfigPanel: () => <div data-testid="config-panel" />,
}));
vi.mock('@/components/scheduling/ShiftPlanner/StaffingDayColumn', () => ({
  StaffingDayColumn: () => <div data-testid="day-column" />,
}));

vi.mock('@/hooks/useStaffingSettings', () => ({
  useStaffingSettings: () => ({
    effectiveSettings: {
      target_splh: 50,
      min_staff: 1,
      min_crew: null,
      target_labor_pct: 30,
      lookback_weeks: 8,
      open_shifts_enabled: true,
    },
    isLoading: false,
    updateSettings: vi.fn(),
    isSaving: false,
  }),
}));

vi.mock('@/hooks/useEmployees', () => ({
  useEmployees: () => ({ employees: [] }),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// ── useRestaurantContext — return a NON-Chicago timezone so we can tell it apart ─
const mockRestaurantContext = vi.fn();
vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => mockRestaurantContext(),
}));

const mockUseQuery = vi.fn();
vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual('@tanstack/react-query');
  return {
    ...actual,
    useQuery: (opts: { queryKey: string[] }) => mockUseQuery(opts),
  };
});

import { StaffingOverlay } from '@/components/scheduling/ShiftPlanner/StaffingOverlay';

// ── Helpers ─────────────────────────────────────────────────────────────────────
const WEEK_DAYS = ['2026-05-25', '2026-05-26', '2026-05-27', '2026-05-28', '2026-05-29', '2026-05-30', '2026-05-31'];

const wrapper = ({ children }: { children: React.ReactNode }) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <MemoryRouter>
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    </MemoryRouter>
  );
};

/** Runs `useWeekStaffingSuggestions`'s real hourly-sales queryFn so the RPC
 *  call underneath is observable, while `useQuery` itself stays mocked for
 *  the other queries the overlay's descendants may issue. */
function forwardHourlySalesQueryFn(opts: { queryKey: string[]; queryFn?: () => unknown }) {
  const key = opts.queryKey[0];
  if (key === 'hourly-sales-all') {
    void opts.queryFn?.();
    return { data: { total_sales: 0, days: [] }, isLoading: false, error: null };
  }
  if (key === 'staffing-time-punches') return { data: [], isLoading: false, error: null };
  return { data: undefined, isLoading: false, error: null };
}

describe('<StaffingOverlay> timezone wiring (Task 8)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSupabase.rpc.mockResolvedValue({ data: { total_sales: 0, days: [] }, error: null });
    mockUseQuery.mockImplementation(forwardHourlySalesQueryFn);
  });

  it('sends the restaurant timezone from useRestaurantContext as the RPC business-day range', async () => {
    // Use a non-Chicago timezone so the test is unambiguous
    mockRestaurantContext.mockReturnValue({
      selectedRestaurant: { restaurant: { timezone: 'America/New_York' } },
    });

    render(<StaffingOverlay restaurantId="r1" weekDays={WEEK_DAYS} />, { wrapper });

    await Promise.resolve();

    expect(mockSupabase.rpc).toHaveBeenCalled();
    const tz = safeTz('America/New_York');
    const expectedEnd = toBusinessDay(new Date(), tz);
    const [, args] = mockSupabase.rpc.mock.calls[0];
    expect(args.p_end_date).toBe(expectedEnd);
  });

  it('falls back to America/Chicago when selectedRestaurant has no timezone', async () => {
    mockRestaurantContext.mockReturnValue({
      selectedRestaurant: { restaurant: {} }, // no timezone field
    });

    render(<StaffingOverlay restaurantId="r1" weekDays={WEEK_DAYS} />, { wrapper });

    await Promise.resolve();

    expect(mockSupabase.rpc).toHaveBeenCalled();
    const expectedEnd = toBusinessDay(new Date(), 'America/Chicago');
    const [, args] = mockSupabase.rpc.mock.calls[0];
    expect(args.p_end_date).toBe(expectedEnd);
  });

  it('falls back to America/Chicago when selectedRestaurant is null', async () => {
    mockRestaurantContext.mockReturnValue({
      selectedRestaurant: null,
    });

    render(<StaffingOverlay restaurantId="r1" weekDays={WEEK_DAYS} />, { wrapper });

    await Promise.resolve();

    // With no restaurant, the RPC still runs and must use the default timezone.
    expect(mockSupabase.rpc).toHaveBeenCalled();
    const expectedEnd = toBusinessDay(new Date(), 'America/Chicago');
    const [, args] = mockSupabase.rpc.mock.calls[0];
    expect(args.p_end_date).toBe(expectedEnd);
  });
});
