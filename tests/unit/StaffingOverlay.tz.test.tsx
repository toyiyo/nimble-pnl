/**
 * Task 8 — StaffingOverlay timezone wiring
 * Verifies that the restaurant timezone from useRestaurantContext is resolved and
 * forwarded as the second argument to aggregateHourlySales.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ── Spy on aggregateHourlySales BEFORE the component imports it ────────────────
// We need the module factory to expose the spy so we can assert call args.
const aggregateSpy = vi.fn();
vi.mock('@/hooks/useHourlySalesPattern', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useHourlySalesPattern')>('@/hooks/useHourlySalesPattern');
  return {
    ...actual,
    aggregateHourlySales: (...args: Parameters<typeof actual.aggregateHourlySales>) => {
      aggregateSpy(...args);
      return actual.aggregateHourlySales(...args);
    },
  };
});

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

// A Friday with sales data so the memoised computation actually calls aggregateHourlySales
const FAKE_SALES = Array.from({ length: 5 }, (_, i) => ({
  sale_date: '2026-05-23', // Friday
  sale_time: `${10 + i}:00:00`,
  sold_at: null as string | null,
  total_price: '200',
}));

const wrapper = ({ children }: { children: React.ReactNode }) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <MemoryRouter>
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    </MemoryRouter>
  );
};

describe('<StaffingOverlay> timezone wiring (Task 8)', () => {
  beforeEach(() => {
    aggregateSpy.mockClear();
    vi.clearAllMocks();

    mockUseQuery.mockImplementation((opts: { queryKey: string[] }) => {
      const key = opts.queryKey[0];
      if (key === 'hourly-sales-all') return { data: FAKE_SALES, isLoading: false, error: null };
      if (key === 'staffing-time-punches') return { data: [], isLoading: false, error: null };
      return { data: undefined, isLoading: false, error: null };
    });
  });

  it('passes the restaurant timezone from useRestaurantContext to aggregateHourlySales', () => {
    // Use a non-Chicago timezone so the test is unambiguous
    mockRestaurantContext.mockReturnValue({
      selectedRestaurant: { restaurant: { timezone: 'America/New_York' } },
    });

    render(<StaffingOverlay restaurantId="r1" weekDays={WEEK_DAYS} />, { wrapper });

    // aggregateHourlySales should have been called at least once (once per day with matching DOW)
    // and every call should receive 'America/New_York' as the second argument.
    expect(aggregateSpy).toHaveBeenCalled();
    const tzArgs = aggregateSpy.mock.calls.map((c: unknown[]) => c[1]);
    expect(tzArgs.every((tz: unknown) => tz === 'America/New_York')).toBe(true);
  });

  it('falls back to America/Chicago when selectedRestaurant has no timezone', () => {
    mockRestaurantContext.mockReturnValue({
      selectedRestaurant: { restaurant: {} }, // no timezone field
    });

    render(<StaffingOverlay restaurantId="r1" weekDays={WEEK_DAYS} />, { wrapper });

    expect(aggregateSpy).toHaveBeenCalled();
    const tzArgs = aggregateSpy.mock.calls.map((c: unknown[]) => c[1]);
    expect(tzArgs.every((tz: unknown) => tz === 'America/Chicago')).toBe(true);
  });

  it('falls back to America/Chicago when selectedRestaurant is null', () => {
    mockRestaurantContext.mockReturnValue({
      selectedRestaurant: null,
    });

    render(<StaffingOverlay restaurantId="r1" weekDays={WEEK_DAYS} />, { wrapper });

    // With no restaurant, aggregateHourlySales still runs (sales still aggregate)
    // and must use the default timezone
    expect(aggregateSpy).toHaveBeenCalled();
    const tzArgs = aggregateSpy.mock.calls.map((c: unknown[]) => c[1]);
    expect(tzArgs.every((tz: unknown) => tz === 'America/Chicago')).toBe(true);
  });
});
