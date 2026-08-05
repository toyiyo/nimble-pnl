import React, { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// The punches queryFn resolves its window through `fromZonedTime(..., tz)`,
// which throws `RangeError: Invalid time value` on an unrecognized zone. Before
// `safeTz`, a restaurant row carrying a junk timezone string sent that value
// straight in, so the whole staffing-suggestions query died. These tests pin
// both halves of the guard: the query survives, and the window it computes is
// the *restaurant's* midnight, not the viewer's.
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

const mockRestaurantContext = vi.hoisted(() => ({
  selectedRestaurant: null as { restaurant: { timezone?: string | null } } | null,
}));
vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => mockRestaurantContext,
}));

const { mockSupabase } = vi.hoisted(() => ({ mockSupabase: { from: vi.fn() } }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: mockSupabase }));

import { useWeekStaffingSuggestions } from '@/hooks/useWeekStaffingSuggestions';

type QueryResult = { data: unknown; error: unknown };
type MockBuilder = Record<string, unknown> & {
  then: (onFulfilled: (v: QueryResult) => unknown, onRejected?: (r: unknown) => unknown) => Promise<unknown>;
};

/** Chainable Supabase builder that always resolves to an empty page. */
function makeBuilder(gteSink?: string[]) {
  const builder = {} as MockBuilder;
  for (const m of ['select', 'eq', 'is', 'lte', 'in', 'order', 'range']) {
    builder[m] = vi.fn(() => builder);
  }
  builder.gte = vi.fn((_col: string, value: string) => {
    gteSink?.push(value);
    return builder;
  });
  builder.then = (onFulfilled, onRejected) =>
    Promise.resolve({ data: [], error: null }).then(onFulfilled, onRejected);
  return builder;
}

let punchGteBounds: string[];

function setup(timezone: string | null | undefined) {
  punchGteBounds = [];
  mockRestaurantContext.selectedRestaurant =
    timezone === undefined ? null : { restaurant: { timezone } };
  mockSupabase.from.mockImplementation((table: string) =>
    table === 'time_punches' ? makeBuilder(punchGteBounds) : makeBuilder()
  );
}

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
};

describe('useWeekStaffingSuggestions timezone handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not blow up the punches query when the restaurant timezone is invalid', async () => {
    setup('Not/AZone');

    const { result } = renderHook(() => useWeekStaffingSuggestions('rest-1', null, null), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(punchGteBounds.length).toBeGreaterThan(0));
    expect(result.current).toBeDefined();
    // Reached at all only because safeTz swapped the junk zone for the default.
    expect(new Date(punchGteBounds[0]).getTime()).not.toBeNaN();
  });

  it('anchors the punch window to the restaurant midnight, not the viewer midnight', async () => {
    setup('Not/AZone');

    renderHook(() => useWeekStaffingSuggestions('rest-1', null, null), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(punchGteBounds.length).toBeGreaterThan(0));
    // safeTz's fallback is America/Chicago, so local midnight is 05:00Z (CDT)
    // or 06:00Z (CST) depending on where the lookback window starts -- never
    // 00:00Z, which is what a UTC or naive-local window would produce. The
    // minutes/seconds pin it to an exact midnight boundary.
    const start = new Date(punchGteBounds[0]);
    expect([5, 6]).toContain(start.getUTCHours());
    expect(start.getUTCMinutes()).toBe(0);
    expect(start.getUTCSeconds()).toBe(0);
  });
});
