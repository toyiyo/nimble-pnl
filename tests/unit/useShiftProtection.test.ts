/**
 * Unit tests: the Shift Protection read hooks.
 *
 * Contracts pinned here:
 * - useShiftProtection merges the RPC result over the everything-off
 *   defaults and fails open (defaults) while disabled or on error.
 * - useTimeoffDayCounts gates on complete, ordered inputs and passes the
 *   four RPC parameters through.
 * - useTimeoffCoverageImpact maps the jsonb shape and defaults the empty
 *   payload.
 * - useInvalidateShiftProtection invalidates the shared query key.
 */

import React, { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import {
  shiftProtectionQueryKey,
  useInvalidateShiftProtection,
  useShiftProtection,
  useTimeoffCoverageImpact,
  useTimeoffDayCounts,
} from '@/hooks/useShiftProtection';
import { SHIFT_PROTECTION_DEFAULTS } from '@/lib/shiftProtection';

const mockSupabase = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({ supabase: mockSupabase }));

const createWrapper = (queryClient?: QueryClient) => {
  const client =
    queryClient ??
    new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
  return function Wrapper({ children }: { children: ReactNode }) {
    return React.createElement(QueryClientProvider, { client }, children);
  };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useShiftProtection', () => {
  it('merges the RPC result over the defaults', async () => {
    mockSupabase.rpc.mockResolvedValue({
      data: { timeoff_notice_mode: 'warn', timeoff_notice_days: 10 },
      error: null,
    });

    const { result } = renderHook(() => useShiftProtection('rest-1'), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(mockSupabase.rpc).toHaveBeenCalledWith('get_shift_protection_settings', {
      p_restaurant_id: 'rest-1',
    });
    expect(result.current.protection.timeoff_notice_mode).toBe('warn');
    expect(result.current.protection.timeoff_notice_days).toBe(10);
    // Untouched knobs keep the defaults.
    expect(result.current.protection.trade_deadline_mode).toBe('off');
  });

  it('returns the defaults while disabled (no restaurant)', () => {
    const { result } = renderHook(() => useShiftProtection(null), {
      wrapper: createWrapper(),
    });
    expect(result.current.protection).toEqual(SHIFT_PROTECTION_DEFAULTS);
    expect(mockSupabase.rpc).not.toHaveBeenCalled();
  });

  it('fails open to the defaults on an RPC error', async () => {
    mockSupabase.rpc.mockResolvedValue({ data: null, error: new Error('denied') });

    const { result } = renderHook(() => useShiftProtection('rest-1'), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.protection).toEqual(SHIFT_PROTECTION_DEFAULTS);
  });
});

describe('useTimeoffDayCounts', () => {
  it('passes the four parameters through and returns the rows', async () => {
    mockSupabase.rpc.mockResolvedValue({
      data: [{ day: '2026-10-10', approved_count: 2 }],
      error: null,
    });

    const { result } = renderHook(
      () => useTimeoffDayCounts('rest-1', 'emp-1', '2026-10-10', '2026-10-12'),
      { wrapper: createWrapper() }
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(mockSupabase.rpc).toHaveBeenCalledWith('get_timeoff_day_counts', {
      p_restaurant_id: 'rest-1',
      p_employee_id: 'emp-1',
      p_start: '2026-10-10',
      p_end: '2026-10-12',
    });
    expect(result.current.data).toEqual([{ day: '2026-10-10', approved_count: 2 }]);
  });

  it.each([
    ['no restaurant', null, 'emp-1', '2026-10-10', '2026-10-12'],
    ['no employee', 'rest-1', null, '2026-10-10', '2026-10-12'],
    ['no start', 'rest-1', 'emp-1', null, '2026-10-12'],
    ['inverted range', 'rest-1', 'emp-1', '2026-10-12', '2026-10-10'],
  ])('stays disabled with %s', (_label, rest, emp, start, end) => {
    renderHook(() => useTimeoffDayCounts(rest, emp, start, end), {
      wrapper: createWrapper(),
    });
    expect(mockSupabase.rpc).not.toHaveBeenCalled();
  });
});

describe('useTimeoffCoverageImpact', () => {
  it('maps the jsonb payload', async () => {
    mockSupabase.rpc.mockResolvedValue({
      data: {
        success: true,
        shifts: [{ shift_id: 's1', required: 2, current_count: 2, after_count: 1 }],
        overlapping_approved: 3,
      },
      error: null,
    });

    const { result } = renderHook(() => useTimeoffCoverageImpact('req-1'), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(mockSupabase.rpc).toHaveBeenCalledWith('get_timeoff_coverage_impact', {
      p_request_id: 'req-1',
    });
    expect(result.current.data?.shifts).toHaveLength(1);
    expect(result.current.data?.overlapping_approved).toBe(3);
  });

  it('defaults an empty payload and stays disabled without an id', async () => {
    mockSupabase.rpc.mockResolvedValue({ data: {}, error: null });

    const { result } = renderHook(() => useTimeoffCoverageImpact('req-2'), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toEqual({ shifts: [], overlapping_approved: 0 });

    vi.clearAllMocks();
    renderHook(() => useTimeoffCoverageImpact(null), { wrapper: createWrapper() });
    expect(mockSupabase.rpc).not.toHaveBeenCalled();
  });
});

describe('useInvalidateShiftProtection', () => {
  it('invalidates the shared query key', () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const spy = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useInvalidateShiftProtection(), {
      wrapper: createWrapper(client),
    });
    result.current('rest-1');

    expect(spy).toHaveBeenCalledWith({ queryKey: shiftProtectionQueryKey('rest-1') });
  });
});
