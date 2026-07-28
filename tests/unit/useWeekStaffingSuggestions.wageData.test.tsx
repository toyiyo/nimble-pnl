import React, { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import type { Employee } from '@/types/scheduling';

// --- Mock the hook's dependencies (settings, employees, restaurant context) ---
// Mirrors tests/unit/useWeekStaffingSuggestions.pagination.test.ts's mocking
// scaffold, with useEmployees made per-test-controllable via mockEmployees().
const { mockUseEmployees } = vi.hoisted(() => ({
  mockUseEmployees: vi.fn(),
}));

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
  useEmployees: () => mockUseEmployees(),
}));
vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: { restaurant: { timezone: 'America/Chicago' } },
  }),
}));

// --- Mock the Supabase client query builder: every query resolves to an
// empty page. These tests only assert on the wage-derived fields, which come
// straight from `employees` and don't depend on sales/punch data. ---
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(() => {
      const builder: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'is', 'gte', 'lte', 'in', 'order']) {
        builder[m] = vi.fn(() => builder);
      }
      builder.range = vi.fn(() => builder);
      builder.then = (onFulfilled: (v: { data: unknown[]; error: null }) => unknown) =>
        Promise.resolve({ data: [], error: null }).then(onFulfilled);
      return builder;
    }),
  },
}));

import { useWeekStaffingSuggestions } from '@/hooks/useWeekStaffingSuggestions';

function mockEmployees(employees: Partial<Employee>[]) {
  mockUseEmployees.mockReturnValue({ employees: employees as Employee[] });
}

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
};

describe('useWeekStaffingSuggestions wage data', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should expose the blended wage and flag it as real for an hourly roster', async () => {
    mockEmployees([
      { compensation_type: 'hourly', is_active: true, hourly_rate: 1000 },
      { compensation_type: 'hourly', is_active: true, hourly_rate: 2000 },
    ]);

    const { result } = renderHook(
      () => useWeekStaffingSuggestions('r1', ['2026-07-27'], null),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.avgHourlyRateCents).toBe(1500);
    expect(result.current.hasWageData).toBe(true);
  });

  it('should flag the fallback wage as not real for an empty roster', async () => {
    mockEmployees([]);

    const { result } = renderHook(
      () => useWeekStaffingSuggestions('r1', ['2026-07-27'], null),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.avgHourlyRateCents).toBe(1500); // the $15 default
    expect(result.current.hasWageData).toBe(false); // …but not real data
  });
});
