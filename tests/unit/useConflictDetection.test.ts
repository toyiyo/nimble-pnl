/**
 * Unit tests: useConflictDetection — `fetchConflicts` (shared by `useCheckConflicts` and
 * `checkConflictsImperative`) should overlap the two conflict RPCs via `Promise.all` rather
 * than awaiting them sequentially.
 *
 * Design: docs/superpowers/specs/2026-07-24-conflict-check-perf-design.md
 * Plan:   docs/superpowers/plans/2026-07-24-conflict-check-perf-plan.md (Task 2)
 *
 * Exercises `checkConflictsImperative` directly (no React Query wrapper needed) so the
 * concurrency assertion isn't muddied by query scheduling.
 */
import React, { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockRpc = vi.hoisted(() => vi.fn());

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: mockRpc },
}));

import {
  checkConflictsImperative,
  useCheckConflicts,
  type ConflictCheckParams,
} from '@/hooks/useConflictDetection';

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  const Wrapper = ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);

  return Wrapper;
};

const PARAMS: ConflictCheckParams = {
  employeeId: 'emp-1',
  restaurantId: 'rest-1',
  startTime: '2026-02-01T15:00:00.000Z',
  endTime: '2026-02-01T23:00:00.000Z',
};

// Shared fixture: one time-off conflict + one recurring-availability conflict, used by both
// the imperative-path merge/order test and the reactive-hook parity test below so the two
// stay in lockstep instead of drifting copies of the same RPC response shapes.
const mockOneConflictFromEachRpc = () => {
  mockRpc.mockImplementation((fnName: string) => {
    if (fnName === 'check_timeoff_conflict') {
      return Promise.resolve({
        data: [
          {
            has_conflict: true,
            time_off_id: 'to-1',
            start_date: '2026-02-01',
            end_date: '2026-02-03',
            status: 'approved',
          },
        ],
        error: null,
      });
    }
    return Promise.resolve({
      data: [
        {
          has_conflict: true,
          conflict_type: 'recurring',
          message: 'Outside recurring availability',
          available_start: '09:00:00',
          available_end: '17:00:00',
        },
      ],
      error: null,
    });
  });
};

const EXPECTED_MERGED_CONFLICTS = [
  {
    has_conflict: true,
    conflict_type: 'time-off',
    message: 'Employee has approved time-off from 2026-02-01 to 2026-02-03',
    time_off_id: 'to-1',
    start_date: '2026-02-01',
    end_date: '2026-02-03',
    status: 'approved',
  },
  {
    has_conflict: true,
    conflict_type: 'recurring',
    message: 'Outside recurring availability',
    available_start: '09:00:00',
    available_end: '17:00:00',
  },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useConflictDetection — fetchConflicts concurrency', () => {
  it('invokes both RPCs concurrently, not sequentially (RPC #2 fires before RPC #1 resolves)', async () => {
    const callOrder: string[] = [];
    let resolveTimeOff!: (v: { data: unknown[]; error: null }) => void;
    const timeOffPromise = new Promise<{ data: unknown[]; error: null }>((resolve) => {
      resolveTimeOff = resolve;
    });

    mockRpc.mockImplementation((fnName: string) => {
      callOrder.push(fnName);
      if (fnName === 'check_timeoff_conflict') {
        return timeOffPromise;
      }
      return Promise.resolve({ data: [], error: null });
    });

    const resultPromise = checkConflictsImperative(PARAMS);

    // Flush a few microtask turns without ever resolving the time-off RPC. If fetchConflicts
    // awaits the first RPC before invoking the second (sequential/current behavior), the
    // availability RPC will never be called here and this assertion fails (RED).
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(callOrder).toEqual(['check_timeoff_conflict', 'check_availability_conflict']);

    resolveTimeOff({ data: [], error: null });
    await resultPromise;
  });

  it('calls both RPCs exactly once each per fetchConflicts invocation', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });

    await checkConflictsImperative(PARAMS);

    expect(mockRpc).toHaveBeenCalledTimes(2);
    expect(mockRpc).toHaveBeenCalledWith('check_timeoff_conflict', {
      p_employee_id: PARAMS.employeeId,
      p_start_time: PARAMS.startTime,
      p_end_time: PARAMS.endTime,
    });
    expect(mockRpc).toHaveBeenCalledWith('check_availability_conflict', {
      p_employee_id: PARAMS.employeeId,
      p_restaurant_id: PARAMS.restaurantId,
      p_start_time: PARAMS.startTime,
      p_end_time: PARAMS.endTime,
    });
  });
});

describe('useConflictDetection — fetchConflicts merge/order', () => {
  it('preserves conflict ordering: time-off conflicts first, then availability conflicts, with mapped shapes', async () => {
    mockOneConflictFromEachRpc();

    const result = await checkConflictsImperative(PARAMS);

    expect(result.hasConflicts).toBe(true);
    expect(result.conflicts).toEqual(EXPECTED_MERGED_CONFLICTS);
  });

  it('returns no conflicts and hasConflicts:false when neither RPC reports a conflict', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });

    const result = await checkConflictsImperative(PARAMS);

    expect(result).toEqual({ conflicts: [], hasConflicts: false });
  });
});

describe('useConflictDetection — fetchConflicts error paths', () => {
  it('rejects when the time-off RPC returns an error', async () => {
    const timeOffError = { message: 'permission denied', code: '42501' };
    mockRpc.mockImplementation((fnName: string) => {
      if (fnName === 'check_timeoff_conflict') {
        return Promise.resolve({ data: null, error: timeOffError });
      }
      return Promise.resolve({ data: [], error: null });
    });

    await expect(checkConflictsImperative(PARAMS)).rejects.toEqual(timeOffError);
  });

  it('rejects when the availability RPC returns an error', async () => {
    const availError = { message: 'function not found', code: '42883' };
    mockRpc.mockImplementation((fnName: string) => {
      if (fnName === 'check_availability_conflict') {
        return Promise.resolve({ data: null, error: availError });
      }
      return Promise.resolve({ data: [], error: null });
    });

    await expect(checkConflictsImperative(PARAMS)).rejects.toEqual(availError);
  });
});

describe('useConflictDetection — reactive hook shares fetchConflicts (no duplication)', () => {
  it('useCheckConflicts issues exactly the same two RPCs as checkConflictsImperative, once each', async () => {
    mockOneConflictFromEachRpc();

    const { result } = renderHook(() => useCheckConflicts(PARAMS), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.loading).toBe(false));

    // Exactly 2 RPC calls total. If the reactive hook duplicated the RPC-calling logic
    // instead of routing through the shared `fetchConflicts`, this would be 4 (or the
    // merge/order/error semantics below would drift from the imperative path).
    expect(mockRpc).toHaveBeenCalledTimes(2);
    expect(mockRpc).toHaveBeenCalledWith('check_timeoff_conflict', {
      p_employee_id: PARAMS.employeeId,
      p_start_time: PARAMS.startTime,
      p_end_time: PARAMS.endTime,
    });
    expect(mockRpc).toHaveBeenCalledWith('check_availability_conflict', {
      p_employee_id: PARAMS.employeeId,
      p_restaurant_id: PARAMS.restaurantId,
      p_start_time: PARAMS.startTime,
      p_end_time: PARAMS.endTime,
    });

    // Same merge/order semantics as the imperative path (time-off before availability).
    expect(result.current.hasConflicts).toBe(true);
    expect(result.current.conflicts).toEqual(EXPECTED_MERGED_CONFLICTS);
  });

  it('stays disabled (fires no RPC) when restaurantId is missing, since the availability RPC requires it', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });

    // employeeId/startTime/endTime present but restaurantId blank — the query key and the
    // availability RPC both need restaurantId, so the `enabled` guard must keep it off rather
    // than call check_availability_conflict with an empty (invalid-UUID) restaurant id.
    const paramsWithoutRestaurant: ConflictCheckParams = { ...PARAMS, restaurantId: '' };

    const { result } = renderHook(() => useCheckConflicts(paramsWithoutRestaurant), {
      wrapper: createWrapper(),
    });

    // Give React Query a few turns; a disabled query never leaves the idle/non-loading state
    // and never invokes the mocked rpc.
    await waitFor(() => expect(result.current.loading).toBe(false));
    await Promise.resolve();

    expect(mockRpc).not.toHaveBeenCalled();
    expect(result.current.conflicts).toEqual([]);
    expect(result.current.hasConflicts).toBe(false);
  });

  it('useCheckConflicts surfaces the same rejection semantics (error propagates, not swallowed by a duplicated path)', async () => {
    const availError = { message: 'function not found', code: '42883' };
    mockRpc.mockImplementation((fnName: string) => {
      if (fnName === 'check_availability_conflict') {
        return Promise.resolve({ data: null, error: availError });
      }
      return Promise.resolve({ data: [], error: null });
    });

    const { result } = renderHook(() => useCheckConflicts(PARAMS), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toEqual(availError);
    expect(result.current.conflicts).toEqual([]);
    expect(result.current.hasConflicts).toBe(false);
  });
});
