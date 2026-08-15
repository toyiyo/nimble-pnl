import React, { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
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

import {
  invokeScheduleNotification,
  notificationToast,
  usePublishSchedule,
  useUnpublishSchedule,
} from '@/hooks/useSchedulePublish';

function makeWeek() {
  const weekStart = new Date(2026, 6, 27);
  return { weekStart, weekEnd: endOfWeek(weekStart, { weekStartsOn: 1 }) };
}

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return React.createElement(QueryClientProvider, { client }, children);
  };
}

/**
 * supabase-js turns a non-2xx into an `error` carrying the raw `Response` on
 * `error.context`, which is the only place the response body survives. A 502
 * carries the per-recipient counts ({ sent, failed }); a 500 carries only an
 * engineering `error` string. The client must read both.
 */
function invokeFailure(body: { error?: string; sent?: number; failed?: number }) {
  return {
    data: null,
    error: {
      message: 'Edge Function returned a non-2xx status code',
      context: { json: () => Promise.resolve(body) },
    },
  };
}

const lastToast = () => mockToast.mock.calls[mockToast.mock.calls.length - 1][0];

describe('publish notification outcomes', () => {
  beforeEach(() => {
    mockSupabase.from.mockReset();
    mockSupabase.rpc.mockReset();
    mockSupabase.functions.invoke.mockReset();
    mockToast.mockReset();
    mockSupabase.rpc.mockResolvedValue({ data: 'pub-1', error: null });
  });

  it('reports plain success when every recipient was reached', async () => {
    mockSupabase.functions.invoke.mockResolvedValue({ data: { sent: 11, failed: 0 }, error: null });
    const { weekStart, weekEnd } = makeWeek();

    const { result } = renderHook(() => usePublishSchedule(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({ restaurantId: 'r1', weekStart, weekEnd });
    });

    expect(lastToast()).toEqual({
      title: 'Schedule Published',
      description: expect.stringContaining('Employees have been notified'),
    });
    expect(lastToast().variant).toBeUndefined();
  });

  it('names the shortfall when only some recipients were reached', async () => {
    mockSupabase.functions.invoke.mockResolvedValue(invokeFailure({ sent: 8, failed: 3 }));
    const { weekStart, weekEnd } = makeWeek();

    const { result } = renderHook(() => usePublishSchedule(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({ restaurantId: 'r1', weekStart, weekEnd });
    });

    const toasted = lastToast();
    expect(toasted.variant).toBe('destructive');
    expect(toasted.title).toContain('some employees not notified');
    expect(toasted.description).toContain('8 notified, 3 could not be reached');
  });

  it('says nobody was notified when the whole fan-out failed', async () => {
    mockSupabase.functions.invoke.mockResolvedValue(invokeFailure({ sent: 0, failed: 11 }));
    const { weekStart, weekEnd } = makeWeek();

    const { result } = renderHook(() => usePublishSchedule(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({ restaurantId: 'r1', weekStart, weekEnd });
    });

    const toasted = lastToast();
    expect(toasted.variant).toBe('destructive');
    expect(toasted.title).toContain('nobody was notified');
    expect(toasted.description).toContain('All 11 notifications failed');
  });

  it('confirms the publish and says to tell the team when the fan-out errors server-side', async () => {
    // The failing case: the function returns a 500 with an engineering-only body
    // ({ error: 'Failed to fetch employees' }), which supabase-js further masks
    // as "Edge Function returned a non-2xx status code". Neither string helps a
    // manager. The toast must instead confirm the publish and say to tell the
    // team directly.
    mockSupabase.functions.invoke.mockResolvedValue(
      invokeFailure({ error: 'Failed to fetch employees' })
    );
    const { weekStart, weekEnd } = makeWeek();

    const { result } = renderHook(() => usePublishSchedule(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({ restaurantId: 'r1', weekStart, weekEnd });
    });

    const toasted = lastToast();
    expect(toasted.variant).toBe('destructive');
    expect(toasted.title).toContain('notifications may not be sent');
    expect(toasted.description).toContain('tell your team directly');
    // The engineering strings must never reach the manager.
    expect(toasted.description).not.toContain('Edge Function returned a non-2xx status code');
    expect(toasted.description).not.toContain('Failed to fetch employees');
    // The publish RPC already committed; a failed fan-out is not a failed publish.
    expect(result.current.isError).toBe(false);
  });

  it('admits it cannot confirm delivery when the invoke never reached the function', async () => {
    // No `context` — the invoke never reached the function (offline, DNS,
    // cold-start). The raw SDK message must be replaced with a curated one.
    mockSupabase.functions.invoke.mockResolvedValue({
      data: null,
      error: { message: 'Failed to fetch' },
    });
    const { weekStart, weekEnd } = makeWeek();

    const { result } = renderHook(() => usePublishSchedule(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({ restaurantId: 'r1', weekStart, weekEnd });
    });

    const toasted = lastToast();
    expect(toasted.variant).toBe('destructive');
    expect(toasted.title).toContain('notifications unconfirmed');
    expect(toasted.description).toContain('We could not reach the notification service');
    // The raw fetch/SDK string must never reach the manager.
    expect(toasted.description).not.toContain('Failed to fetch');
  });

  it('still reports the publish itself as done when notifications fail', async () => {
    mockSupabase.functions.invoke.mockResolvedValue(invokeFailure({ sent: 0, failed: 4 }));
    const { weekStart, weekEnd } = makeWeek();

    const { result } = renderHook(() => usePublishSchedule(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({ restaurantId: 'r1', weekStart, weekEnd });
    });

    // The RPC already committed; a failed fan-out must not read as a failed
    // publish, or the manager will publish again and re-notify everyone who did
    // get through.
    expect(result.current.isError).toBe(false);
    expect(lastToast().title).toMatch(/^Schedule Published/);
  });

  it('skips the notification invoke when notify is false', async () => {
    const { weekStart, weekEnd } = makeWeek();

    const { result } = renderHook(() => usePublishSchedule(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({ restaurantId: 'r1', weekStart, weekEnd, notify: false });
    });

    expect(mockSupabase.functions.invoke).not.toHaveBeenCalled();
    expect(result.current.isError).toBe(false);
    expect(lastToast().description).toBe('No notifications were sent.');
  });

  it('calls the notification invoke once when notify is true', async () => {
    mockSupabase.functions.invoke.mockResolvedValue({ data: { sent: 11, failed: 0 }, error: null });
    const { weekStart, weekEnd } = makeWeek();

    const { result } = renderHook(() => usePublishSchedule(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({ restaurantId: 'r1', weekStart, weekEnd, notify: true });
    });

    expect(mockSupabase.functions.invoke).toHaveBeenCalledTimes(1);
  });

  it('defaults notify to true when the param is absent', async () => {
    mockSupabase.functions.invoke.mockResolvedValue({ data: { sent: 11, failed: 0 }, error: null });
    const { weekStart, weekEnd } = makeWeek();

    const { result } = renderHook(() => usePublishSchedule(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({ restaurantId: 'r1', weekStart, weekEnd });
    });

    expect(mockSupabase.functions.invoke).toHaveBeenCalledTimes(1);
  });
});

describe('notificationToast copy per outcome', () => {
  it('reports no notifications were sent for a skipped outcome', () => {
    const toasted = notificationToast(
      { status: 'skipped' },
      { title: 'Schedule Published', successDescription: 'The schedule has been published.' },
    );

    // Title stays the plain success title -- 'skipped' is not a failure, so it
    // must not read like the '-- some/nobody notified' destructive branches.
    expect(toasted.title).toBe('Schedule Published');
    expect(toasted.description).toBe('No notifications were sent.');
    expect(toasted.variant).toBeUndefined();
  });
});

describe('unpublish notification outcomes', () => {
  beforeEach(() => {
    mockSupabase.from.mockReset();
    mockSupabase.rpc.mockReset();
    mockSupabase.functions.invoke.mockReset();
    mockToast.mockReset();
  });

  it('tells the retracted employees and says so', async () => {
    mockSupabase.rpc.mockResolvedValue({ data: 63, error: null });
    mockSupabase.functions.invoke.mockResolvedValue({ data: { sent: 12, failed: 0 }, error: null });
    const { weekStart, weekEnd } = makeWeek();

    const { result } = renderHook(() => useUnpublishSchedule(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({ restaurantId: 'r1', weekStart, weekEnd });
    });

    expect(mockSupabase.functions.invoke).toHaveBeenCalledWith('notify-schedule-unpublished', {
      body: { restaurantId: 'r1', weekStart: '2026-07-27' },
    });
    expect(lastToast()).toEqual({
      title: 'Schedule Unpublished',
      description: expect.stringContaining('63 shifts have been unlocked'),
    });
  });

  it('skips the notification entirely when nothing was actually retracted', async () => {
    mockSupabase.rpc.mockResolvedValue({ data: 0, error: null });
    const { weekStart, weekEnd } = makeWeek();

    const { result } = renderHook(() => useUnpublishSchedule(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({ restaurantId: 'r1', weekStart, weekEnd });
    });

    // A double-tap on Unpublish has nobody to tell, and invoking anyway would
    // surface a scary "unconfirmed" toast for a no-op.
    expect(mockSupabase.functions.invoke).not.toHaveBeenCalled();
    expect(lastToast().variant).toBeUndefined();
  });

  it('warns the manager when the retracted employees were not all reached', async () => {
    mockSupabase.rpc.mockResolvedValue({ data: 63, error: null });
    mockSupabase.functions.invoke.mockResolvedValue(invokeFailure({ sent: 0, failed: 12 }));
    const { weekStart, weekEnd } = makeWeek();

    const { result } = renderHook(() => useUnpublishSchedule(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({ restaurantId: 'r1', weekStart, weekEnd });
    });

    const toasted = lastToast();
    expect(toasted.variant).toBe('destructive');
    expect(toasted.title).toContain('nobody was notified');
  });
});

describe('notification timeout', () => {
  beforeEach(() => {
    mockSupabase.functions.invoke.mockReset();
  });

  it('gives up on a fan-out that never answers instead of waiting forever', async () => {
    // A hung edge function used to leave the publish dialog with both Publish
    // and Cancel disabled, recoverable only by reloading the page.
    mockSupabase.functions.invoke.mockReturnValue(new Promise(() => {}));

    const outcome = await invokeScheduleNotification('notify-schedule-published', {}, 20);

    expect(outcome.status).toBe('unknown');
    // 'unknown', not 'failed': the request is still in flight and may well be
    // succeeding, so the manager is told we could not confirm -- not that it
    // went wrong.
    expect(outcome).toMatchObject({ message: expect.stringContaining('may still be sending') });
  });

  it('does not time out a fan-out that answers in time', async () => {
    mockSupabase.functions.invoke.mockResolvedValue({ data: { sent: 4 }, error: null });

    await expect(invokeScheduleNotification('notify-schedule-published', {}, 5000)).resolves.toEqual(
      { status: 'sent', sent: 4 }
    );
  });
});
