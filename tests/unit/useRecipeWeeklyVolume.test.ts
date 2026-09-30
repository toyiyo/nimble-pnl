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
  mockFromChain.gte.mockResolvedValue({ data, error });
}

beforeEach(() => {
  vi.clearAllMocks();

  mockFromChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gte: vi.fn(),
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
});
