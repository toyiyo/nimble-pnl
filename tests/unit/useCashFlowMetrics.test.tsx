import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { useCashFlowMetrics } from '@/hooks/useCashFlowMetrics';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockSupabase = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: mockSupabase,
}));

const mockRestaurantContext = vi.hoisted(() => ({
  selectedRestaurant: { restaurant_id: 'rest-123' } as { restaurant_id: string } | null,
}));

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => mockRestaurantContext,
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

beforeEach(() => {
  mockSupabase.rpc.mockReset();
  mockRestaurantContext.selectedRestaurant = { restaurant_id: 'rest-123' };
});

describe('useCashFlowMetrics', () => {
  it('calls get_cash_flow_metrics with the restaurant, dates, and a null account id for "all"', async () => {
    mockSupabase.rpc.mockResolvedValue({
      data: { daily: [], comparison: { inflow: 0, outflow: 0 } },
      error: null,
    });

    const startDate = new Date(2026, 7, 1);
    const endDate = new Date(2026, 7, 10);

    const { result } = renderHook(() => useCashFlowMetrics(startDate, endDate, 'all'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockSupabase.rpc).toHaveBeenCalledWith('get_cash_flow_metrics', {
      p_restaurant_id: 'rest-123',
      p_start_date: '2026-08-01',
      p_end_date: '2026-08-10',
      p_bank_account_id: null,
    });
  });

  it('passes a specific bank account id through unchanged', async () => {
    mockSupabase.rpc.mockResolvedValue({
      data: { daily: [], comparison: { inflow: 0, outflow: 0 } },
      error: null,
    });

    const startDate = new Date(2026, 7, 1);
    const endDate = new Date(2026, 7, 10);

    const { result } = renderHook(
      () => useCashFlowMetrics(startDate, endDate, 'bank-456'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockSupabase.rpc).toHaveBeenCalledWith('get_cash_flow_metrics', {
      p_restaurant_id: 'rest-123',
      p_start_date: '2026-08-01',
      p_end_date: '2026-08-10',
      p_bank_account_id: 'bank-456',
    });
  });

  it('derives metrics from the RPC daily rows and comparison inflow', async () => {
    mockSupabase.rpc.mockResolvedValue({
      data: {
        daily: [
          { day: '2026-08-10', inflow: 100, outflow: 40 },
        ],
        comparison: { inflow: 50, outflow: 0 },
      },
      error: null,
    });

    const startDate = new Date(2026, 7, 10);
    const endDate = new Date(2026, 7, 10);

    const { result } = renderHook(() => useCashFlowMetrics(startDate, endDate, 'all'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.totalInflows).toBe(100);
    expect(result.current.data?.totalOutflows).toBe(40);
    expect(result.current.data?.netCashFlow).toBe(60);
    // (100 - 50) / 50 * 100 = 100
    expect(result.current.data?.trailingTrendPercentage).toBe(100);
  });

  it('throws when the RPC returns an error', async () => {
    mockSupabase.rpc.mockResolvedValue({
      data: null,
      error: new Error('boom'),
    });

    const startDate = new Date(2026, 7, 1);
    const endDate = new Date(2026, 7, 10);

    const { result } = renderHook(() => useCashFlowMetrics(startDate, endDate, 'all'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('does not call the RPC when no restaurant is selected', async () => {
    mockRestaurantContext.selectedRestaurant = null;

    const { result } = renderHook(
      () => useCashFlowMetrics(new Date(2026, 7, 1), new Date(2026, 7, 10), 'all'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.fetchStatus).toBe('idle'));
    expect(mockSupabase.rpc).not.toHaveBeenCalled();
  });
});
