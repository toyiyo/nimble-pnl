import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useTipServerEarnings, TIP_SERVER_EARNINGS_SELECT } from '@/hooks/useTipServerEarnings';
import { supabase } from '@/integrations/supabase/client';
import React, { type ReactNode } from 'react';

// Mock the Supabase client. The read path is from().select().eq().
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(),
  },
}));

// Mock the toast hook. The mutation path calls it, the read path does not.
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

describe('useTipServerEarnings', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    vi.clearAllMocks();
  });

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  /** Build a from().select().eq() chain that resolves to the given result. */
  function mockReadChain(result: { data: unknown; error: unknown }) {
    const eq = vi.fn().mockResolvedValue(result);
    const select = vi.fn().mockReturnValue({ eq });
    vi.mocked(supabase.from).mockReturnValue({ select } as never);
    return { select, eq };
  }

  it('reads the single name column, not first_name / last_name', () => {
    expect(TIP_SERVER_EARNINGS_SELECT).toBe('*, employees(name)');
  });

  it('maps employee_name from the single employees.name column', async () => {
    const { select, eq } = mockReadChain({
      data: [
        {
          id: 'earn-1',
          tip_split_id: 'split-123',
          employee_id: 'emp-1',
          earned_amount: 100,
          retained_amount: 10,
          refunded_amount: 0,
          created_at: '2026-01-03T10:00:00Z',
          employees: { name: 'Jane Doe' },
        },
      ],
      error: null,
    });

    const { result } = renderHook(() => useTipServerEarnings('split-123'), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // The select must name only columns that exist on employees.
    expect(select).toHaveBeenCalledWith('*, employees(name)');
    expect(eq).toHaveBeenCalledWith('tip_split_id', 'split-123');
    expect(result.current.earnings).toHaveLength(1);
    expect(result.current.earnings[0]).toMatchObject({
      id: 'earn-1',
      employee_id: 'emp-1',
      earned_amount: 100,
      employee_name: 'Jane Doe',
    });
  });

  it('leaves employee_name undefined when the employees embed is null', async () => {
    mockReadChain({
      data: [
        {
          id: 'earn-2',
          tip_split_id: 'split-123',
          employee_id: 'emp-2',
          earned_amount: 50,
          retained_amount: 5,
          refunded_amount: 0,
          created_at: '2026-01-03T11:00:00Z',
          employees: null,
        },
      ],
      error: null,
    });

    const { result } = renderHook(() => useTipServerEarnings('split-123'), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.earnings).toHaveLength(1);
    expect(result.current.earnings[0].employee_name).toBeUndefined();
  });

  it('does not query when splitId is null', async () => {
    const { result } = renderHook(() => useTipServerEarnings(null), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.earnings).toEqual([]);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('surfaces a read error', async () => {
    mockReadChain({ data: null, error: { message: 'boom' } });

    const { result } = renderHook(() => useTipServerEarnings('split-123'), { wrapper });

    await waitFor(() => expect(result.current.error).toBeTruthy());

    expect(result.current.earnings).toEqual([]);
  });
});
