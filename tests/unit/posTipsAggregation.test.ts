import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React, { ReactNode } from 'react';
import { usePOSTips } from '@/hooks/usePOSTips';

const mockSupabase = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: mockSupabase,
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

function mockEmployeeQuery(data: unknown[] | null, error: { message: string } | null = null) {
  const chain = {
    eq: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data, error }),
  };
  mockSupabase.from.mockReturnValue({ select: vi.fn().mockReturnValue(chain) });
}

function mockPosRpc(data: unknown[] | null, error: { message: string } | null = null) {
  mockSupabase.rpc.mockResolvedValue({ data, error });
}

describe('usePOSTips', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should merge employee tips and POS tips by date', async () => {
    mockEmployeeQuery([
      { recorded_at: '2024-01-15T10:00:00Z', tip_amount: 5000, tip_source: 'cash' },
      { recorded_at: '2024-01-15T14:00:00Z', tip_amount: 3000, tip_source: 'cash' },
    ]);
    mockPosRpc([
      { tip_date: '2024-01-15', total_amount_cents: 15000, transaction_count: 12, pos_source: 'square' },
      { tip_date: '2024-01-16', total_amount_cents: 18500, transaction_count: 15, pos_source: 'toast' },
    ]);

    const { result } = renderHook(
      () => usePOSTips('test-restaurant-id', '2024-01-15', '2024-01-16'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.data).toHaveLength(2);

    const jan15 = result.current.data?.find(d => d.date === '2024-01-15');
    expect(jan15?.totalTipsCents).toBe(23000); // 5000 + 3000 + 15000
    expect(jan15?.transactionCount).toBe(14); // 2 + 12
    expect(jan15?.source).toBe('combined');

    const jan16 = result.current.data?.find(d => d.date === '2024-01-16');
    expect(jan16?.totalTipsCents).toBe(18500);
    expect(jan16?.transactionCount).toBe(15);
    expect(jan16?.source).toBe('toast');
  });

  it('should handle empty employee tips gracefully', async () => {
    mockEmployeeQuery([]);
    mockPosRpc([
      { tip_date: '2024-01-15', total_amount_cents: 10000, transaction_count: 5, pos_source: 'square' },
    ]);

    const { result } = renderHook(
      () => usePOSTips('test-restaurant-id', '2024-01-15', '2024-01-15'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].totalTipsCents).toBe(10000);
    expect(result.current.data?.[0].source).toBe('square');
  });

  it('should handle empty POS tips gracefully', async () => {
    mockEmployeeQuery([
      { recorded_at: '2024-01-15T10:00:00Z', tip_amount: 5000, tip_source: 'cash' },
    ]);
    mockPosRpc([]);

    const { result } = renderHook(
      () => usePOSTips('test-restaurant-id', '2024-01-15', '2024-01-15'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].totalTipsCents).toBe(5000);
    expect(result.current.data?.[0].source).toBe('cash');
  });

  it('should handle employee tips error and still return POS tips', async () => {
    mockEmployeeQuery(null, { message: 'Database error' });
    mockPosRpc([
      { tip_date: '2024-01-15', total_amount_cents: 10000, transaction_count: 5, pos_source: 'square' },
    ]);

    const { result } = renderHook(
      () => usePOSTips('test-restaurant-id', '2024-01-15', '2024-01-15'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].totalTipsCents).toBe(10000);
  });

  it('should handle POS tips error and still return employee tips', async () => {
    mockEmployeeQuery([
      { recorded_at: '2024-01-15T10:00:00Z', tip_amount: 5000, tip_source: 'cash' },
    ]);
    mockPosRpc(null, { message: 'RPC error' });

    const { result } = renderHook(
      () => usePOSTips('test-restaurant-id', '2024-01-15', '2024-01-15'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].totalTipsCents).toBe(5000);
  });

  it('should return empty array when both sources fail', async () => {
    mockEmployeeQuery(null, { message: 'Error' });
    mockPosRpc(null, { message: 'Error' });

    const { result } = renderHook(
      () => usePOSTips('test-restaurant-id', '2024-01-15', '2024-01-15'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.data).toEqual([]);
  });

  it('should not fetch when restaurantId is null', async () => {
    const { result } = renderHook(
      () => usePOSTips(null, '2024-01-15', '2024-01-15'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.data).toBeUndefined();
    expect(mockSupabase.from).not.toHaveBeenCalled();
    expect(mockSupabase.rpc).not.toHaveBeenCalled();
  });

  it('should preserve source when only one source contributes to a date', async () => {
    mockEmployeeQuery([
      { recorded_at: '2024-01-15T10:00:00Z', tip_amount: 5000, tip_source: 'cash' },
    ]);
    mockPosRpc([
      { tip_date: '2024-01-16', total_amount_cents: 10000, transaction_count: 5, pos_source: 'square' },
    ]);

    const { result } = renderHook(
      () => usePOSTips('test-restaurant-id', '2024-01-15', '2024-01-16'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.data).toHaveLength(2);

    const jan15 = result.current.data?.find(d => d.date === '2024-01-15');
    expect(jan15?.source).toBe('cash');

    const jan16 = result.current.data?.find(d => d.date === '2024-01-16');
    expect(jan16?.source).toBe('square');
  });
});
