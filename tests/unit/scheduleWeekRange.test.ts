import React, { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { endOfWeek } from 'date-fns';

const mockSupabase = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  functions: { invoke: vi.fn() },
}));

vi.mock('@/integrations/supabase/client', () => ({ supabase: mockSupabase }));

const mockToast = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mockToast }) }));

import { useOpenShifts } from '@/hooks/useOpenShifts';
import { usePublishSchedule, useUnpublishSchedule } from '@/hooks/useSchedulePublish';

/**
 * The week of Mon 2026-07-27. `new Date(y, m, d)` yields local midnight on that
 * calendar day in ANY process TZ, so these fixtures are TZ-portable — which is
 * the whole point: the bug is invisible under TZ=UTC.
 */
function makeWeek() {
  const weekStart = new Date(2026, 6, 27);
  const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 });
  return { weekStart, weekEnd };
}

function createWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return React.createElement(QueryClientProvider, { client }, children);
  };
}

describe('week range serialization', () => {
  beforeEach(() => {
    mockSupabase.from.mockReset();
    mockSupabase.rpc.mockReset();
    mockSupabase.functions.invoke.mockReset();
    mockToast.mockReset();
  });

  it('useOpenShifts sends a Mon..Sun range, not Mon..Mon', async () => {
    mockSupabase.rpc.mockResolvedValue({ data: [], error: null });
    const { weekStart, weekEnd } = makeWeek();

    renderHook(() => useOpenShifts('r1', weekStart, weekEnd), { wrapper: createWrapper() });

    await waitFor(() => expect(mockSupabase.rpc).toHaveBeenCalled());

    expect(mockSupabase.rpc).toHaveBeenCalledWith('get_open_shifts', {
      p_restaurant_id: 'r1',
      p_week_start: '2026-07-27',
      p_week_end: '2026-08-02',
    });

    // Explicit regression guard: the reported bug produced the following Monday.
    const { p_week_end } = mockSupabase.rpc.mock.calls[0][1];
    expect(p_week_end).not.toBe('2026-08-03');
  });

  it('usePublishSchedule sends a Mon..Sun range, not Mon..Mon', async () => {
    mockSupabase.rpc.mockResolvedValue({ data: 'pub-1', error: null });
    mockSupabase.functions.invoke.mockResolvedValue({ data: {}, error: null });
    const { weekStart, weekEnd } = makeWeek();

    const { result } = renderHook(() => usePublishSchedule(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.mutateAsync({ restaurantId: 'r1', weekStart, weekEnd });
    });

    expect(mockSupabase.rpc).toHaveBeenCalledWith('publish_schedule', {
      p_restaurant_id: 'r1',
      p_week_start: '2026-07-27',
      p_week_end: '2026-08-02',
      p_notes: null,
    });

    // The notification payload must carry the same corrected range — the edge
    // function re-derives its own shift boundary from it (see Task 5).
    expect(mockSupabase.functions.invoke).toHaveBeenCalledWith(
      'notify-schedule-published',
      expect.objectContaining({
        body: expect.objectContaining({ weekStart: '2026-07-27', weekEnd: '2026-08-02' }),
      }),
    );
  });

  it('useUnpublishSchedule sends a Mon..Sun range, not Mon..Mon', async () => {
    mockSupabase.rpc.mockResolvedValue({ data: 3, error: null });
    const { weekStart, weekEnd } = makeWeek();

    const { result } = renderHook(() => useUnpublishSchedule(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.mutateAsync({ restaurantId: 'r1', weekStart, weekEnd });
    });

    expect(mockSupabase.rpc).toHaveBeenCalledWith('unpublish_schedule', {
      p_restaurant_id: 'r1',
      p_week_start: '2026-07-27',
      p_week_end: '2026-08-02',
      p_reason: null,
    });
  });
});
