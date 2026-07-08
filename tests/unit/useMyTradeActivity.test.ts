/**
 * Unit tests: useMyTradeActivity + invalidateShiftTradeQueries
 *
 * The activity query is the data source for the "My shift trades" card on
 * EmployeeSchedule. Critical contracts pinned here:
 * - TWO SEPARATE .or() groups (PostgREST ANDs sibling or= params). Merging
 *   them into one comma-joined .or() would silently flip AND → OR.
 * - Resolved-window cutoff is computed INSIDE queryFn (fresh per refetch),
 *   while the query key stays stable.
 * - invalidateShiftTradeQueries fans out to all three trade query keys.
 */

import React, { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useMyTradeActivity,
  invalidateShiftTradeQueries,
  type ShiftTrade,
} from '@/hooks/useShiftTrades';

const mockSupabase = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  functions: { invoke: vi.fn() },
}));

vi.mock('@/integrations/supabase/client', () => ({ supabase: mockSupabase }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

type QueryBuilder = {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  in: ReturnType<typeof vi.fn>;
  or: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
};

const createSelectQueryBuilder = (
  mockData: Partial<ShiftTrade>[] | null,
  error: Error | null = null,
): QueryBuilder => ({
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  in: vi.fn().mockReturnThis(),
  or: vi.fn().mockReturnThis(),
  order: vi.fn().mockResolvedValue({ data: mockData, error }),
});

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
};

const makeTrade = (overrides: Partial<ShiftTrade>): Partial<ShiftTrade> => ({
  id: 'trade-1',
  restaurant_id: 'rest-123',
  offered_by_employee_id: 'emp-1',
  accepted_by_employee_id: null,
  status: 'open',
  reviewed_at: null,
  created_at: '2026-07-01T00:00:00Z',
  offered_shift: {
    id: 'shift-1',
    start_time: '2026-07-10T17:00:00Z',
    end_time: '2026-07-10T23:00:00Z',
    position: 'Server',
    break_duration: 0,
  },
  offered_by: { id: 'emp-1', name: 'Mia', email: null, position: 'Server', area: null },
  ...overrides,
});

describe('useMyTradeActivity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds the query with restaurant eq, TWO sibling or-groups, status IN, and created_at desc order', async () => {
    const builder = createSelectQueryBuilder([makeTrade({})]);
    mockSupabase.from.mockReturnValue(builder);

    const { result } = renderHook(() => useMyTradeActivity('rest-123', 'emp-1'), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockSupabase.from).toHaveBeenCalledWith('shift_trades');
    expect(builder.eq).toHaveBeenCalledWith('restaurant_id', 'rest-123');
    expect(builder.in).toHaveBeenCalledWith('status', [
      'open',
      'pending_approval',
      'approved',
      'rejected',
    ]);
    expect(builder.order).toHaveBeenCalledWith('created_at', { ascending: false });

    // The two or-groups MUST be separate sibling calls (AND-ed by PostgREST).
    expect(builder.or).toHaveBeenCalledTimes(2);
    const orArgs = builder.or.mock.calls.map((c) => c[0] as string);
    expect(orArgs[0]).toBe('offered_by_employee_id.eq.emp-1,accepted_by_employee_id.eq.emp-1');
    expect(orArgs[1]).toMatch(/^reviewed_at\.is\.null,reviewed_at\.gte\./);
  });

  it('computes the resolved-window cutoff ~7 days back, inside queryFn', async () => {
    const builder = createSelectQueryBuilder([]);
    mockSupabase.from.mockReturnValue(builder);

    const before = Date.now();
    const { result } = renderHook(() => useMyTradeActivity('rest-123', 'emp-1'), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    const after = Date.now();

    const windowArg = builder.or.mock.calls.map((c) => c[0] as string)[1];
    const iso = windowArg.replace('reviewed_at.is.null,reviewed_at.gte.', '');
    const cutoff = new Date(iso).getTime();
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    expect(cutoff).toBeGreaterThanOrEqual(before - sevenDays - 5000);
    expect(cutoff).toBeLessThanOrEqual(after - sevenDays + 5000);
  });

  it('filters out trades with null joined offered_by / offered_shift', async () => {
    const builder = createSelectQueryBuilder([
      makeTrade({ id: 'good' }),
      makeTrade({ id: 'no-shift', offered_shift: undefined }),
      makeTrade({ id: 'no-poster', offered_by: undefined }),
    ]);
    mockSupabase.from.mockReturnValue(builder);

    const { result } = renderHook(() => useMyTradeActivity('rest-123', 'emp-1'), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.trades.map((t) => t.id)).toEqual(['good']);
  });

  it('is disabled (no fetch) without a restaurantId or employeeId', async () => {
    const { result: r1 } = renderHook(() => useMyTradeActivity(null, 'emp-1'), {
      wrapper: createWrapper(),
    });
    const { result: r2 } = renderHook(() => useMyTradeActivity('rest-123', null), {
      wrapper: createWrapper(),
    });
    await waitFor(() => {
      expect(r1.current.trades).toEqual([]);
      expect(r2.current.trades).toEqual([]);
    });
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });
});

describe('invalidateShiftTradeQueries', () => {
  it('invalidates all three trade query keys', () => {
    const queryClient = { invalidateQueries: vi.fn() };
    invalidateShiftTradeQueries(queryClient as never);
    const keys = queryClient.invalidateQueries.mock.calls.map(
      (c) => (c[0] as { queryKey: string[] }).queryKey[0],
    );
    expect(keys).toContain('shift_trades');
    expect(keys).toContain('marketplace_trades');
    expect(keys).toContain('my_trade_activity');
    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(3);
  });
});
