import React, { ReactNode } from 'react';
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  summarizeShiftResults,
  timeOffShiftToastText,
  tradeNote,
  useApplyTimeOffShiftAction,
} from '@/hooks/useTimeOffShiftAction';

const mockToast = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mockToast }) }));

const mockSupabase = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  functions: { invoke: vi.fn().mockResolvedValue({ data: null, error: null }) },
}));
vi.mock('@/integrations/supabase/client', () => ({ supabase: mockSupabase }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider
    client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}
  >
    {children}
  </QueryClientProvider>
);

// delete().eq(id).eq(restaurant_id).eq(employee_id).select('id')
function setupDelete(resultsById: Record<string, { data: { id: string }[] | null; error: { message: string } | null }>) {
  const eqCalls: Array<[string, string]> = [];
  mockSupabase.from.mockImplementation(() => {
    let id = '';
    const chain = {
      eq: vi.fn((col: string, val: string) => {
        eqCalls.push([col, val]);
        if (col === 'id') id = val;
        return chain;
      }),
      select: vi.fn(() => Promise.resolve(resultsById[id])),
    };
    return { delete: vi.fn(() => chain) };
  });
  return eqCalls;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('tradeNote', () => {
  it('trims the note', () => {
    expect(tradeNote('  Family trip  ')).toBe('Family trip');
  });
  it('uses Approved PTO for an empty note', () => {
    expect(tradeNote('   ')).toBe('Approved PTO');
  });
});

describe('summarizeShiftResults', () => {
  it('counts done, skipped, and failed', () => {
    const results: PromiseSettledResult<'done' | 'skipped'>[] = [
      { status: 'fulfilled', value: 'done' },
      { status: 'fulfilled', value: 'done' },
      { status: 'fulfilled', value: 'skipped' },
      { status: 'rejected', reason: new Error('x') },
    ];
    expect(summarizeShiftResults(results)).toEqual({ done: 2, skipped: 1, failed: 1 });
  });
});

describe('timeOffShiftToastText', () => {
  it('names the posted count for a trade', () => {
    expect(timeOffShiftToastText({ kind: 'trade', note: 'x' }, { done: 3, skipped: 0, failed: 0 })).toEqual({
      title: 'Shifts posted for trade',
      description: '3 shifts posted for trade.',
    });
  });
  it('uses the singular for one shift', () => {
    expect(timeOffShiftToastText({ kind: 'delete' }, { done: 1, skipped: 0, failed: 0 })).toEqual({
      title: 'Shifts deleted',
      description: '1 shift deleted.',
    });
  });
  it('names skipped and failed counts and uses the destructive variant', () => {
    expect(timeOffShiftToastText({ kind: 'trade', note: 'x' }, { done: 1, skipped: 1, failed: 1 })).toEqual({
      title: 'Some shifts were not posted',
      description:
        '1 shift posted for trade. 1 shift is already on the trade board. 1 shift failed. Post it from the schedule.',
      variant: 'destructive',
    });
  });
  it('names a skipped delete', () => {
    expect(timeOffShiftToastText({ kind: 'delete' }, { done: 0, skipped: 2, failed: 0 })).toEqual({
      title: 'No shifts changed',
      description: '0 shifts deleted. 2 shifts are already gone.',
    });
  });
});

describe('useApplyTimeOffShiftAction', () => {
  it('posts each shift with the trimmed note and sends the created email', async () => {
    mockSupabase.rpc.mockResolvedValueOnce({ data: 'trade-1', error: null }).mockResolvedValueOnce({ data: 'trade-2', error: null });
    const { result } = renderHook(() => useApplyTimeOffShiftAction(), { wrapper });

    let summary;
    await act(async () => {
      summary = await result.current.mutateAsync({
        restaurantId: 'r1',
        employeeId: 'e1',
        shiftIds: ['s1', 's2'],
        action: { kind: 'trade', note: '  ' },
      });
    });

    expect(summary).toEqual({ done: 2, skipped: 0, failed: 0 });
    expect(mockSupabase.rpc).toHaveBeenCalledWith('create_shift_trade_for_employee', {
      p_restaurant_id: 'r1',
      p_offered_shift_id: 's1',
      p_offered_by_employee_id: 'e1',
      p_target_employee_id: null,
      p_reason: 'Approved PTO',
    });
    expect(mockSupabase.functions.invoke).toHaveBeenCalledWith('send-shift-trade-notification', {
      body: { tradeId: 'trade-1', action: 'created' },
    });
    expect(mockToast).toHaveBeenCalledTimes(1);
  });

  it('counts an existing trade as skipped', async () => {
    mockSupabase.rpc
      .mockResolvedValueOnce({ data: 'trade-1', error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'This shift already has an active trade' } });
    const { result } = renderHook(() => useApplyTimeOffShiftAction(), { wrapper });

    let summary;
    await act(async () => {
      summary = await result.current.mutateAsync({
        restaurantId: 'r1', employeeId: 'e1', shiftIds: ['s1', 's2'], action: { kind: 'trade', note: 'PTO' },
      });
    });
    expect(summary).toEqual({ done: 1, skipped: 1, failed: 0 });
  });

  it('deletes with the restaurant and employee filters', async () => {
    const eqCalls = setupDelete({ s1: { data: [{ id: 's1' }], error: null } });
    const { result } = renderHook(() => useApplyTimeOffShiftAction(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ restaurantId: 'r1', employeeId: 'e1', shiftIds: ['s1'], action: { kind: 'delete' } });
    });
    expect(mockSupabase.from).toHaveBeenCalledWith('shifts');
    expect(eqCalls).toEqual([['id', 's1'], ['restaurant_id', 'r1'], ['employee_id', 'e1']]);
    expect(mockSupabase.functions.invoke).not.toHaveBeenCalled();
  });

  it('counts a zero-row delete as skipped and a delete error as failed', async () => {
    setupDelete({
      s1: { data: [], error: null },
      s2: { data: null, error: { message: 'boom' } },
      s3: { data: [{ id: 's3' }], error: null },
    });
    const { result } = renderHook(() => useApplyTimeOffShiftAction(), { wrapper });

    let summary;
    await act(async () => {
      summary = await result.current.mutateAsync({
        restaurantId: 'r1', employeeId: 'e1', shiftIds: ['s1', 's2', 's3'], action: { kind: 'delete' },
      });
    });
    expect(summary).toEqual({ done: 1, skipped: 1, failed: 1 });
  });
});
