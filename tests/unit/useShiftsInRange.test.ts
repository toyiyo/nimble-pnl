import React, { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useShiftsInRange } from '@/hooks/useShiftsInRange';

// Mock Supabase client
const mockSelect = vi.fn();
const mockEq = vi.fn();
const mockGte = vi.fn();
const mockLte = vi.fn();

const mockSupabase = vi.hoisted(() => ({
  from: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: mockSupabase,
}));

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  const Wrapper = ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);

  return Wrapper;
};

function setupChain(resolvedValue: { data: any; error: any }) {
  mockLte.mockResolvedValue(resolvedValue);
  mockGte.mockReturnValue({ lte: mockLte });
  mockEq.mockReturnValue({ gte: mockGte });
  mockSelect.mockReturnValue({ eq: mockEq });
  mockSupabase.from.mockReturnValue({ select: mockSelect });
}

describe('useShiftsInRange', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is disabled when dateRange is null', () => {
    const { result } = renderHook(
      () => useShiftsInRange('rest-1', null),
      { wrapper: createWrapper() },
    );

    expect(result.current.fetchStatus).toBe('idle');
    expect(result.current.data).toBeUndefined();
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });

  it('fetches shifts for the given date range', async () => {
    const mockShifts = [
      { id: 's1', restaurant_id: 'rest-1', employee_id: 'e1', start_time: '2026-03-02T10:00:00', end_time: '2026-03-02T18:00:00', break_duration: 0, position: 'Server', status: 'scheduled', is_published: false, locked: false, created_at: '', updated_at: '' },
    ];

    setupChain({ data: mockShifts, error: null });

    const { result } = renderHook(
      () => useShiftsInRange('rest-1', { start: '2026-03-02T00:00:00', end: '2026-03-03T23:59:59' }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(mockShifts);
    expect(mockSupabase.from).toHaveBeenCalledWith('shifts');
    expect(mockSelect).toHaveBeenCalledWith(
      'id, restaurant_id, employee_id, start_time, end_time, break_duration, position, status, is_published, locked, created_at, updated_at',
    );
    expect(mockEq).toHaveBeenCalledWith('restaurant_id', 'rest-1');
    expect(mockGte).toHaveBeenCalledWith('start_time', '2026-03-02T00:00:00');
    expect(mockLte).toHaveBeenCalledWith('start_time', '2026-03-03T23:59:59');
  });

  it('returns empty array when data is null', async () => {
    setupChain({ data: null, error: null });

    const { result } = renderHook(
      () => useShiftsInRange('rest-1', { start: '2026-03-02T00:00:00', end: '2026-03-03T23:59:59' }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it('throws on Supabase error', async () => {
    setupChain({ data: null, error: { message: 'permission denied' } });

    const { result } = renderHook(
      () => useShiftsInRange('rest-1', { start: '2026-03-02T00:00:00', end: '2026-03-03T23:59:59' }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toEqual({ message: 'permission denied' });
  });
});
