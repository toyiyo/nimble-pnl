import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useOffsitePunchAlerts } from '@/hooks/useOffsitePunchAlerts';

const toastMock = vi.fn();

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: toastMock }),
}));

vi.mock('@/hooks/useRestaurantClock', () => ({
  useRestaurantClock: () => ({
    today: '2026-09-28',
    tz: 'America/Chicago',
    tzAbbrev: 'CDT',
    viewerTzDiffers: false,
    formatInstant: () => '3:58 PM',
    toBusinessDay: (value: string) => value,
    toWallClockInput: (value: string) => value,
    parseWallClock: () => '2026-09-28T05:00:00.000Z',
  }),
}));

// The hook chains `.select().eq().gte().eq().order()`, so the mock builder
// must stay chainable for any call sequence and resolve `then` from a queue
// the test fills before each refetch — see useTimePunches.stability.test.tsx
// for the pattern this follows.
const responseQueue: Array<{ data: unknown[]; error: null }> = [];

function makeQueryBuilder() {
  const builder: Record<string, unknown> = {};
  const self = () => builder;
  builder.select = self;
  builder.eq = self;
  builder.gte = self;
  builder.lte = self;
  builder.order = self;
  builder.then = (resolve: (value: { data: unknown[]; error: null }) => void) => {
    resolve(responseQueue.shift() ?? { data: [], error: null });
  };
  return builder;
}

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(() => makeQueryBuilder()),
  },
}));

function makeRow(overrides: Partial<{
  id: string;
  punch_type: string;
  punch_time: string;
  distance_meters: number;
  employeeName: string;
}> = {}) {
  return {
    id: overrides.id ?? 'punch-1',
    punch_type: overrides.punch_type ?? 'clock_in',
    punch_time: overrides.punch_time ?? '2026-09-28T20:58:00Z',
    location: { within_geofence: false, distance_meters: overrides.distance_meters ?? 1200 },
    employee: { name: overrides.employeeName ?? 'Maria Lopez' },
  };
}

describe('useOffsitePunchAlerts', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    toastMock.mockClear();
    responseQueue.length = 0;
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    React.createElement(QueryClientProvider, { client: queryClient }, children)
  );

  it('shows no toast when the first result has 2 rows', async () => {
    responseQueue.push({ data: [makeRow({ id: 'p1' }), makeRow({ id: 'p2' })], error: null });

    const { result } = renderHook(
      () => useOffsitePunchAlerts('rest-1', vi.fn()),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(toastMock).not.toHaveBeenCalled();
  });

  it('shows one toast, titled "Maria Lopez clocked in off-site", for a new row', async () => {
    responseQueue.push({ data: [makeRow({ id: 'p1' }), makeRow({ id: 'p2' })], error: null });

    const { result } = renderHook(
      () => useOffsitePunchAlerts('rest-1', vi.fn()),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(toastMock).not.toHaveBeenCalled();

    responseQueue.push({
      data: [makeRow({ id: 'p1' }), makeRow({ id: 'p2' }), makeRow({ id: 'p3', employeeName: 'Maria Lopez' })],
      error: null,
    });

    await act(async () => {
      await result.current.refetch();
    });
    await waitFor(() => expect(result.current.data?.length).toBe(3));

    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(toastMock.mock.calls[0][0]).toMatchObject({
      title: 'Maria Lopez clocked in off-site',
    });
  });

  it('shows no new toast when the same rows come back again', async () => {
    responseQueue.push({ data: [makeRow({ id: 'p1' })], error: null });

    const { result } = renderHook(
      () => useOffsitePunchAlerts('rest-1', vi.fn()),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    responseQueue.push({ data: [makeRow({ id: 'p1' })], error: null });

    await act(async () => {
      await result.current.refetch();
    });

    expect(toastMock).not.toHaveBeenCalled();
  });

  it('gives no toast for the first result of a new restaurant', async () => {
    responseQueue.push({ data: [makeRow({ id: 'p1' })], error: null });

    const { result, rerender } = renderHook(
      ({ restaurantId }: { restaurantId: string }) => useOffsitePunchAlerts(restaurantId, vi.fn()),
      { wrapper, initialProps: { restaurantId: 'rest-1' } },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(toastMock).not.toHaveBeenCalled();

    responseQueue.push({ data: [makeRow({ id: 'p1-rest2' })], error: null });

    rerender({ restaurantId: 'rest-2' });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(toastMock).not.toHaveBeenCalled();
  });

  it('titles a clock-out row "... clocked out off-site"', async () => {
    responseQueue.push({ data: [makeRow({ id: 'p1' })], error: null });

    const { result } = renderHook(
      () => useOffsitePunchAlerts('rest-1', vi.fn()),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    responseQueue.push({
      data: [makeRow({ id: 'p1' }), makeRow({ id: 'p2', punch_type: 'clock_out', employeeName: 'Maria Lopez' })],
      error: null,
    });

    await act(async () => {
      await result.current.refetch();
    });
    await waitFor(() => expect(result.current.data?.length).toBe(2));

    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(toastMock.mock.calls[0][0]).toMatchObject({
      title: 'Maria Lopez clocked out off-site',
    });
  });
});
