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

// --- Mock the Supabase client query builder ---
const { mockSupabase } = vi.hoisted(() => ({
  mockSupabase: { from: vi.fn() },
}));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: mockSupabase,
}));

import { useWeekStaffingSuggestions } from '@/hooks/useWeekStaffingSuggestions';

const PAGE_SIZE = 1000;

// A Friday — its day-of-week (5) is the only one in weekDays, so ONLY sales
// landing on this DOW ever aggregate into daySuggestions/hasHourlyBreakdown.
const FRIDAY = '2026-07-24';
// A Wednesday (DOW 3), deliberately NOT in weekDays — page-1 filler rows land
// here so they can never account for hasHourlyBreakdown being true.
const WEDNESDAY = '2026-07-01';

let salesRangeCalls: Array<[number, number]>;

type QueryResult = { data: unknown; error: unknown };
type MockBuilder = {
  __range?: [number, number];
  then: (
    onFulfilled: (value: QueryResult) => unknown,
    onRejected?: (reason: unknown) => unknown,
  ) => Promise<unknown>;
  [method: string]: unknown;
};

// Chainable builder: every method returns the builder; awaiting resolves via
// `resolver`. `.range` offsets are captured (per table) for assertions.
function makeBuilder(
  resolver: (b: MockBuilder) => QueryResult,
  rangeSink?: Array<[number, number]>,
) {
  const builder = {} as MockBuilder;
  for (const m of ['select', 'eq', 'is', 'gte', 'lte', 'in', 'order']) {
    builder[m] = vi.fn(() => builder);
  }
  builder.range = vi.fn((from: number, to: number) => {
    builder.__range = [from, to];
    rangeSink?.push([from, to]);
    return builder;
  });
  builder.then = (onFulfilled, onRejected) =>
    Promise.resolve(resolver(builder)).then(onFulfilled, onRejected);
  return builder;
}

function saleRow(id: number, sale_date: string) {
  return {
    sale_date,
    sale_time: '18:00:00',
    sold_at: null,
    total_price: 100,
    id: `s-${id}`,
    created_at: '2026-07-01T18:00:00Z',
  };
}

// unified_sales: page 0 is a FULL page of Wednesday filler (forces a second
// fetch); page 1 holds the lone Friday sale. A non-paginated query stops after
// page 0 and drops Friday entirely — reproducing the "No sales history" bug.
function salesPageFor(from: number) {
  if (from === 0) {
    return Array.from({ length: PAGE_SIZE }, (_, i) => saleRow(i, WEDNESDAY));
  }
  if (from === PAGE_SIZE) {
    return [saleRow(PAGE_SIZE, FRIDAY)];
  }
  return [];
}

function setup() {
  salesRangeCalls = [];
  mockSupabase.from.mockImplementation((table: string) => {
    if (table === 'unified_sales') {
      return makeBuilder((b) => {
        const [from] = b.__range as [number, number];
        return { data: salesPageFor(from), error: null };
      }, salesRangeCalls);
    }
    // time_punches (unused by these assertions): always an empty page.
    return makeBuilder(() => ({ data: [], error: null }));
  });
}

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
};

describe('useWeekStaffingSuggestions sales pagination', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('pages past the first 1000 rows so recent days are not dropped', async () => {
    setup();

    const { result } = renderHook(
      () => useWeekStaffingSuggestions('rest-1', [FRIDAY], null),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // The second page must be fetched at offset 1000, not left truncated.
    expect(salesRangeCalls[0]).toEqual([0, PAGE_SIZE - 1]);
    expect(salesRangeCalls[1]).toEqual([PAGE_SIZE, PAGE_SIZE * 2 - 1]);

    // Friday's only sale lives in page 2. If pagination stopped after page 1,
    // this DOW would aggregate to nothing and hasHourlyBreakdown stays false.
    expect(result.current.hasHourlyBreakdown).toBe(true);
    const friday = result.current.daySuggestions.get(FRIDAY);
    expect(friday?.recommendations.some((r) => (r.projectedSales ?? 0) > 0)).toBe(true);
  });

  it('stops paging when a page is short (no dead-end extra fetch)', async () => {
    // First page short → no second range call.
    salesRangeCalls = [];
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'unified_sales') {
        return makeBuilder((b) => {
          const [from] = b.__range as [number, number];
          return {
            data: from === 0 ? [saleRow(0, FRIDAY)] : [],
            error: null,
          };
        }, salesRangeCalls);
      }
      return makeBuilder(() => ({ data: [], error: null }));
    });

    const { result } = renderHook(
      () => useWeekStaffingSuggestions('rest-1', [FRIDAY], null),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(salesRangeCalls).toHaveLength(1);
    expect(salesRangeCalls[0]).toEqual([0, PAGE_SIZE - 1]);
  });
});
