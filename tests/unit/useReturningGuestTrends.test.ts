import React, { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: rpcMock } }));

import { useReturningGuestTrends } from '@/hooks/useReturningGuestTrends';

const RPC = { weeks: [], summary: {}, source: 'toast', quality: 'good' };

const createWrapper = () => {
  const queryClient = new QueryClient();
  return ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
};

describe('useReturningGuestTrends', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls the RPC with the restaurant, start date and weeks', async () => {
    rpcMock.mockResolvedValue({ data: RPC, error: null });
    const { result } = renderHook(() => useReturningGuestTrends('rest-1', '2026-09-01', 8), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(rpcMock).toHaveBeenCalledWith('get_returning_guest_trends', {
      p_restaurant_id: 'rest-1',
      p_campaign_start: '2026-09-01',
      p_weeks: 8,
    });
    expect(result.current.data).toEqual(RPC);
  });

  it.each([
    ['no restaurant', null, '2026-09-01', 8],
    ['an empty restaurant ID', '', '2026-09-01', 8],
    ['no start date', 'rest-1', null, 8],
    ['an empty start date', 'rest-1', '', 8],
    ['negative weeks', 'rest-1', '2026-09-01', -4],
    ['bad start date', 'rest-1', '2026-13-45', 8],
    ['zero weeks', 'rest-1', '2026-09-01', 0],
    ['27 weeks', 'rest-1', '2026-09-01', 27],
    ['fractional weeks', 'rest-1', '2026-09-01', 2.5],
  ])('does not fetch with %s', (_label, id, start, weeks) => {
    rpcMock.mockResolvedValue({ data: RPC, error: null });
    const { result } = renderHook(
      () => useReturningGuestTrends(id as string | null, start as string | null, weeks as number),
      { wrapper: createWrapper() },
    );
    expect(result.current.fetchStatus).toBe('idle');
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('fetches at the weeks limits 1 and 26', async () => {
    rpcMock.mockResolvedValue({ data: RPC, error: null });
    const a = renderHook(() => useReturningGuestTrends('rest-1', '2026-09-01', 1), {
      wrapper: createWrapper(),
    });
    const b = renderHook(() => useReturningGuestTrends('rest-1', '2026-09-01', 26), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(a.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(b.result.current.isSuccess).toBe(true));
  });

  it('does not retry when the error code is 42501', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: '42501', message: 'denied' } });
    const { result } = renderHook(() => useReturningGuestTrends('rest-1', '2026-09-01', 8), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });
});
