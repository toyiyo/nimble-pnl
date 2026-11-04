import React, { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// --- Mock the hook's dependencies (settings, employees, restaurant context) ---
vi.mock('@/hooks/useStaffingSettings', () => ({
  useStaffingSettings: () => ({
    effectiveSettings: {
      lookback_weeks: 4,
      target_splh: 200,
      min_crew: 1,
      min_staff: 1,
      target_labor_pct: 25,
    },
    isLoading: false,
    updateSettings: vi.fn(),
    isSaving: false,
  }),
}));
vi.mock('@/hooks/useEmployees', () => ({
  useEmployees: () => ({ employees: [] }),
}));
vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: { restaurant: { timezone: 'America/Chicago' } },
  }),
}));

// --- Mock the Supabase client: `rpc` for the hourly-sales pattern, `from`
// only for the (unrelated) time-punches query. ---
const { mockSupabase } = vi.hoisted(() => ({
  mockSupabase: { from: vi.fn(), rpc: vi.fn() },
}));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: mockSupabase,
}));

import { useWeekStaffingSuggestions } from '@/hooks/useWeekStaffingSuggestions';

const FRIDAY = '2026-07-24';

type QueryResult = { data: unknown; error: unknown };
type MockBuilder = {
  then: (
    onFulfilled: (value: QueryResult) => unknown,
    onRejected?: (reason: unknown) => unknown,
  ) => Promise<unknown>;
  [method: string]: unknown;
};

function makeBuilder(resolver: () => QueryResult) {
  const builder = {} as MockBuilder;
  for (const m of ['select', 'eq', 'is', 'gte', 'lte', 'in', 'order', 'range']) {
    builder[m] = vi.fn(() => builder);
  }
  builder.then = (onFulfilled, onRejected) =>
    Promise.resolve(resolver()).then(onFulfilled, onRejected);
  return builder;
}

function setup() {
  mockSupabase.rpc.mockResolvedValue({
    data: {
      total_sales: 100,
      days: [{ day_of_week: 5, has_hourly_breakdown: true, slots: [{ start_minute: 1080, sales: 100, sample_count: 1 }] }],
    },
    error: null,
  });
  // time_punches (unused by these assertions): always an empty page.
  mockSupabase.from.mockImplementation(() => makeBuilder(() => ({ data: [], error: null })));
}

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
};

describe('useWeekStaffingSuggestions hourly sales source', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls get_hourly_sales_pattern once and never queries unified_sales directly', async () => {
    setup();

    const { result } = renderHook(
      () => useWeekStaffingSuggestions('rest-1', [FRIDAY], null),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(mockSupabase.rpc).toHaveBeenCalledTimes(1);
    expect(mockSupabase.rpc).toHaveBeenCalledWith(
      'get_hourly_sales_pattern',
      expect.objectContaining({ p_restaurant_id: 'rest-1', p_interval_minutes: 60, p_view: 'weekday' }),
    );
    expect(mockSupabase.from).not.toHaveBeenCalledWith('unified_sales');

    expect(result.current.hasHourlyBreakdown).toBe(true);
    const friday = result.current.daySuggestions.get(FRIDAY);
    expect(friday?.recommendations.some((r) => (r.projectedSales ?? 0) > 0)).toBe(true);
  });
});
