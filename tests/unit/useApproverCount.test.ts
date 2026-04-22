import React, { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockSupabase = vi.hoisted(() => ({
  from: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: mockSupabase,
}));

import { useApproverCount } from '@/hooks/useApproverCount';

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return React.createElement(QueryClientProvider, { client }, children);
  };
}

function makeCountStub(count: number | null, error: unknown = null) {
  return {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        in: vi.fn(async () => ({ count, error })),
      })),
    })),
  };
}

describe('useApproverCount', () => {
  beforeEach(() => {
    mockSupabase.from.mockReset();
  });

  it('returns 0 when restaurantId is undefined without hitting the client', async () => {
    const { result } = renderHook(() => useApproverCount(undefined), {
      wrapper: createWrapper(),
    });
    await waitFor(() => {
      expect(result.current.isFetching).toBe(false);
    });
    expect(result.current.data).toBe(0);
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });

  it('fetches count from user_restaurants with owner/manager roles', async () => {
    const stub = makeCountStub(3);
    mockSupabase.from.mockReturnValue(stub);

    const { result } = renderHook(() => useApproverCount('rest-1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.data).toBe(3));

    expect(mockSupabase.from).toHaveBeenCalledWith('user_restaurants');
    expect(stub.select).toHaveBeenCalledWith('*', { count: 'exact', head: true });
    const eqCall = stub.select.mock.results[0].value.eq;
    expect(eqCall).toHaveBeenCalledWith('restaurant_id', 'rest-1');
    const inCall = eqCall.mock.results[0].value.in;
    expect(inCall).toHaveBeenCalledWith('role', ['owner', 'manager']);
  });

  it('returns 0 when the count is null', async () => {
    mockSupabase.from.mockReturnValue(makeCountStub(null));
    const { result } = renderHook(() => useApproverCount('rest-1'), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe(0);
  });

  it('surfaces errors through React Query', async () => {
    mockSupabase.from.mockReturnValue(
      makeCountStub(null, { message: 'boom' })
    );
    const { result } = renderHook(() => useApproverCount('rest-1'), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as { message: string }).message).toBe('boom');
  });
});
