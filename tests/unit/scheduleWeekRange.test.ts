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
import {
  usePublishSchedule,
  useUnpublishSchedule,
  useWeekPublicationStatus,
} from '@/hooks/useSchedulePublish';

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

/**
 * Postgrest-style chainable mock: every filter returns the same builder, and
 * the builder is thenable so `await query` resolves to `result`.
 */
function makeBuilder(result: { data?: unknown; error?: unknown; count?: number | null }) {
  const builder: Record<string, unknown> = { calls: [] as Array<[string, unknown, unknown]> };
  for (const m of ['select', 'eq', 'gte', 'lte', 'order', 'limit']) {
    builder[m] = vi.fn((...args: unknown[]) => {
      (builder.calls as Array<unknown[]>).push([m, ...args]);
      return builder;
    });
  }
  builder.maybeSingle = vi.fn(() => Promise.resolve(result));
  builder.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
    Promise.resolve(result).then(res, rej);
  return builder;
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

  it('useWeekPublicationStatus uses instants for start_time and dates for date columns', async () => {
    const shiftsBuilder = makeBuilder({ count: 2, error: null });
    const pubsBuilder = makeBuilder({ data: null, error: null });
    mockSupabase.from.mockImplementation((table: string) =>
      table === 'shifts' ? shiftsBuilder : pubsBuilder,
    );

    const { weekStart, weekEnd } = makeWeek();
    renderHook(() => useWeekPublicationStatus('r1', weekStart, weekEnd), { wrapper: createWrapper() });

    await waitFor(() => expect(pubsBuilder.maybeSingle).toHaveBeenCalled());

    // timestamptz column -> full instants, so no local wall-clock hours are lost.
    expect(shiftsBuilder.gte).toHaveBeenCalledWith('start_time', weekStart.toISOString());
    expect(shiftsBuilder.lte).toHaveBeenCalledWith('start_time', weekEnd.toISOString());

    // date columns -> local calendar days.
    expect(pubsBuilder.eq).toHaveBeenCalledWith('week_start_date', '2026-07-27');
    expect(pubsBuilder.eq).toHaveBeenCalledWith('week_end_date', '2026-08-02');
  });
});
