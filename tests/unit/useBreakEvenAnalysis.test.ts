import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { useBreakEvenAnalysis } from '../../src/hooks/useBreakEvenAnalysis';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockSupabase = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: mockSupabase,
}));

vi.mock('@/hooks/useOperatingCosts', () => ({
  useOperatingCosts: () => ({
    costs: [],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// ---------------------------------------------------------------------------
// Date mock: freeze new Date() without freezing timers
// ---------------------------------------------------------------------------

// Use midday UTC so startOfDay resolves to Jan 20 in all timezones (UTC-12 to UTC+14)
const FAKE_NOW = new Date('2024-01-20T12:00:00.000Z').getTime();
const RealDate = globalThis.Date;

beforeEach(() => {
  // Override Date constructor so new Date() returns our fixed date,
  // but leave setTimeout/setInterval working normally.
  class MockDate extends RealDate {
    constructor(...args: any[]) {
      if (args.length === 0) {
        super(FAKE_NOW);
      } else {
        // @ts-expect-error spread constructor
        super(...args);
      }
    }

    static override now() {
      return FAKE_NOW;
    }
  }

  globalThis.Date = MockDate as DateConstructor;
});

afterEach(() => {
  globalThis.Date = RealDate;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0 },
      mutations: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useBreakEvenAnalysis', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: bank_transactions query for auto utility costs returns empty
    const mockFromChain: Record<string, any> = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lt: vi.fn().mockReturnThis(),
    };
    mockFromChain.lt.mockResolvedValue({ data: [], error: null });
    mockSupabase.from.mockReturnValue(mockFromChain);
  });

  it('calls RPC with correct parameters', async () => {
    mockSupabase.rpc.mockResolvedValue({
      data: [],
      error: null,
    });

    renderHook(() => useBreakEvenAnalysis('rest-123', 3), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(mockSupabase.rpc).toHaveBeenCalledWith('get_daily_sales_totals', {
        p_restaurant_id: 'rest-123',
        p_date_from: '2024-01-18', // today (Jan 20) minus (3-1) = Jan 18
        p_date_to: '2024-01-20',
      });
    });
  });

  it('returns daily sales data from RPC response', async () => {
    mockSupabase.rpc.mockResolvedValue({
      data: [
        { sale_date: '2024-01-20', total_revenue: 1500, transaction_count: 45 },
      ],
      error: null,
    });

    const { result } = renderHook(() => useBreakEvenAnalysis('rest-123', 1), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // With 0 operating costs, break-even is 0, so todaySales = 1500
    expect(result.current.data).not.toBeNull();
    expect(result.current.data!.todaySales).toBe(1500);
    expect(result.current.data!.history).toHaveLength(1);
    expect(result.current.data!.history[0]).toEqual(
      expect.objectContaining({
        date: '2024-01-20',
        sales: 1500,
      }),
    );
  });

  it('fills in missing dates with zero revenue', async () => {
    // historyDays=3 means dates: Jan 18, Jan 19, Jan 20
    // Only return data for Jan 19
    mockSupabase.rpc.mockResolvedValue({
      data: [
        { sale_date: '2024-01-19', total_revenue: 800, transaction_count: 20 },
      ],
      error: null,
    });

    const { result } = renderHook(() => useBreakEvenAnalysis('rest-123', 3), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data).not.toBeNull();
    const history = result.current.data!.history;
    expect(history).toHaveLength(3);

    // Jan 18 - missing, should be 0
    expect(history[0]).toEqual(
      expect.objectContaining({ date: '2024-01-18', sales: 0 }),
    );
    // Jan 19 - has data
    expect(history[1]).toEqual(
      expect.objectContaining({ date: '2024-01-19', sales: 800 }),
    );
    // Jan 20 - missing, should be 0
    expect(history[2]).toEqual(
      expect.objectContaining({ date: '2024-01-20', sales: 0 }),
    );
  });

  it('handles RPC error', async () => {
    mockSupabase.rpc.mockResolvedValue({
      data: null,
      error: new Error('RPC failed'),
    });

    const { result } = renderHook(() => useBreakEvenAnalysis('rest-123', 3), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBeTruthy();
    expect(result.current.data).toBeNull();
  });

  it('does not call RPC when restaurantId is null', async () => {
    mockSupabase.rpc.mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(() => useBreakEvenAnalysis(null), {
      wrapper: createWrapper(),
    });

    // Allow any pending microtasks to flush
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // The RPC for get_daily_sales_totals should NOT have been called
    const salesCalls = mockSupabase.rpc.mock.calls.filter(
      (call: any[]) => call[0] === 'get_daily_sales_totals',
    );
    expect(salesCalls).toHaveLength(0);
  });

  it('handles empty RPC response with all-zero revenue', async () => {
    mockSupabase.rpc.mockResolvedValue({
      data: [],
      error: null,
    });

    const { result } = renderHook(() => useBreakEvenAnalysis('rest-123', 3), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data).not.toBeNull();
    const history = result.current.data!.history;
    expect(history).toHaveLength(3);
    for (const entry of history) {
      expect(entry.sales).toBe(0);
    }
  });
});
