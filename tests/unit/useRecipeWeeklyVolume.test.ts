import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { useRecipeWeeklyVolume } from '../../src/hooks/useRecipeWeeklyVolume';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockSupabase = vi.hoisted(() => ({
  from: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: mockSupabase,
}));

const mockRestaurant = vi.hoisted(() => ({ timezone: 'America/Chicago' as string | null }));

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: { restaurant: { timezone: mockRestaurant.timezone } },
  }),
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0 },
    },
  });

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

let mockFromChain: Record<string, ReturnType<typeof vi.fn>>;

function setupChain(data: unknown[] | null, error: Error | null = null) {
  mockFromChain.range.mockResolvedValue({ data, error });
}

/** Queues one response per call to `.range()`, for a multi-page fetch. */
function setupPages(...pages: unknown[][]) {
  for (const page of pages) {
    mockFromChain.range.mockResolvedValueOnce({ data: page, error: null });
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRestaurant.timezone = 'America/Chicago';

  mockFromChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    range: vi.fn(),
  };

  mockSupabase.from.mockReturnValue(mockFromChain);

  setupChain([]);
});

describe('useRecipeWeeklyVolume', () => {
  it('sums quantity from unified_sales for the item over the last 7 days', async () => {
    setupChain([{ quantity: 200 }, { quantity: 330 }]);

    const { result } = renderHook(() => useRecipeWeeklyVolume('rest-123', 'Cheeseburger'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.weeklyVolume).toBe(530);
    expect(mockSupabase.from).toHaveBeenCalledWith('unified_sales');
    expect(mockFromChain.select).toHaveBeenCalledWith('quantity');
    expect(mockFromChain.eq).toHaveBeenCalledWith('restaurant_id', 'rest-123');
    expect(mockFromChain.eq).toHaveBeenCalledWith('item_name', 'Cheeseburger');
    expect(mockFromChain.order).toHaveBeenCalledWith('id', { ascending: true });
  });

  it('sums quantity across pages, neither skipping nor repeating a row', async () => {
    const pageOne = Array.from({ length: 1000 }, () => ({ quantity: 1 }));
    const pageTwo = [{ quantity: 5 }, { quantity: 7 }];
    setupPages(pageOne, pageTwo);

    const { result } = renderHook(() => useRecipeWeeklyVolume('rest-123', 'Cheeseburger'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.weeklyVolume).toBe(1012);
    expect(mockFromChain.range).toHaveBeenCalledTimes(2);
    expect(mockFromChain.order).toHaveBeenCalledWith('id', { ascending: true });
  });

  it('returns zero when there are no sales in the window', async () => {
    setupChain([]);

    const { result } = renderHook(() => useRecipeWeeklyVolume('rest-123', 'Cheeseburger'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.weeklyVolume).toBe(0);
  });

  it('does not query when restaurantId is null', async () => {
    const { result } = renderHook(() => useRecipeWeeklyVolume(null, 'Cheeseburger'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(mockSupabase.from).not.toHaveBeenCalled();
    expect(result.current.weeklyVolume).toBe(0);
  });

  it('does not query when posItemName is null', async () => {
    const { result } = renderHook(() => useRecipeWeeklyVolume('rest-123', null), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(mockSupabase.from).not.toHaveBeenCalled();
    expect(result.current.weeklyVolume).toBe(0);
  });

  it('surfaces query errors', async () => {
    setupChain(null, new Error('Database error'));

    const { result } = renderHook(() => useRecipeWeeklyVolume('rest-123', 'Cheeseburger'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.weeklyVolume).toBe(0);
  });

  it('starts the window 6 days before today in the restaurant timezone', async () => {
    // 2026-10-01 03:00 UTC is still 2026-09-30 in Chicago. A browser at UTC
    // would start the window one day late, at 2026-09-25.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-01T03:00:00Z'));
    try {
      mockRestaurant.timezone = 'America/Chicago';
      const { result } = renderHook(() => useRecipeWeeklyVolume('rest-123', 'Cheeseburger'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(mockFromChain.gte).toHaveBeenCalledWith('sale_date', '2026-09-24');
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses the restaurant timezone for a zone ahead of UTC', async () => {
    // 2026-09-30 20:00 UTC is already 2026-10-01 in Auckland.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-30T20:00:00Z'));
    try {
      mockRestaurant.timezone = 'Pacific/Auckland';
      const { result } = renderHook(() => useRecipeWeeklyVolume('rest-123', 'Cheeseburger'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(mockFromChain.gte).toHaveBeenCalledWith('sale_date', '2026-09-25');
    } finally {
      vi.useRealTimers();
    }
  });
});
