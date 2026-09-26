import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { useDepositMatch } from '@/hooks/useDepositMatch';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockSupabase = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: mockSupabase,
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

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

const emptyReport = {
  summary: {},
  streams: [],
  ledger: [],
  banks: [],
};

function refreshCallCount() {
  return mockSupabase.rpc.mock.calls.filter((call) => call[0] === 'refresh_deposit_matches').length;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSupabase.rpc.mockImplementation((fn: string) => {
    if (fn === 'refresh_deposit_matches') return Promise.resolve({ error: null });
    if (fn === 'get_deposit_match_report') return Promise.resolve({ data: emptyReport, error: null });
    return Promise.resolve({ data: null, error: null });
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useDepositMatch refreshNow', () => {
  it('fires the refresh RPC once on mount for a new (restaurant, range) key', async () => {
    renderHook(
      () => useDepositMatch({ restaurantId: 'rest-1', startDate: '2026-08-01', endDate: '2026-08-31' }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(refreshCallCount()).toBe(1);
    });
    expect(mockSupabase.rpc).toHaveBeenCalledWith(
      'refresh_deposit_matches',
      expect.objectContaining({
        p_restaurant_id: 'rest-1',
        p_start_date: '2026-08-01',
        p_end_date: '2026-08-31',
      })
    );
  });

  it('re-runs the refresh RPC on demand via refreshNow, bypassing the once-per-range gate', async () => {
    // Regression test: a rule create/update used to invalidate the read
    // query only, never re-run `refresh_deposit_matches`. Since
    // `deposit_match_items` rows are created only inside that RPC, a new
    // rule stayed empty until the (restaurantId, startDate, endDate) key
    // changed. `refreshNow` (returned by this hook, wired into
    // `SetupDialog`'s `onSaved`) lets a caller force a re-run without
    // waiting on the range to change.
    const { result } = renderHook(
      () => useDepositMatch({ restaurantId: 'rest-1', startDate: '2026-08-01', endDate: '2026-08-31' }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(refreshCallCount()).toBe(1);
    });

    act(() => {
      result.current.refreshNow();
    });

    await waitFor(() => {
      expect(refreshCallCount()).toBe(2);
    });
  });
});
