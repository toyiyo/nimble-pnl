import React, { ReactNode } from 'react';
import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { buildIntradayFinancialSeries } from '@/lib/laborPnlAnalytics';
import { normalizePunches, identifyWorkSessions } from '@/utils/timePunchProcessing';
import { appendOpenShiftClockOuts } from '@/utils/openShiftPunches';
import { computeAvgHourlyRateCents } from '@/lib/staffingCalculator';
import type { SplhSaleRow } from '@/lib/splhAnalytics';
import type { TimePunch } from '@/types/timeTracking';

const { mockUseEmployees, mockGetToday, fromMock } = vi.hoisted(() => ({
  mockUseEmployees: vi.fn(),
  mockGetToday: vi.fn(() => '2026-07-14'),
  fromMock: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: fromMock } }));
vi.mock('@/hooks/useEmployees', () => ({ useEmployees: mockUseEmployees }));
vi.mock('@/lib/timezone', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/timezone')>()),
  getTodayInTimezone: mockGetToday,
}));

import { useLaborIntradaySeries } from '@/hooks/useLaborIntradaySeries';

const SALES: SplhSaleRow[] = [
  { sale_date: '2026-07-06', sale_time: '12:00:00', sold_at: '2026-07-06T12:00:00Z', total_price: 200 },
  { sale_date: '2026-07-06', sale_time: '13:00:00', sold_at: '2026-07-06T13:00:00Z', total_price: 100 },
];
const PUNCHES: TimePunch[] = [
  { id: 'p1', restaurant_id: 'rest-1', employee_id: 'emp-1', punch_type: 'clock_in', punch_time: '2026-07-06T12:00:00Z' } as TimePunch,
  { id: 'p2', restaurant_id: 'rest-1', employee_id: 'emp-1', punch_type: 'clock_out', punch_time: '2026-07-06T14:00:00Z' } as TimePunch,
];
const EMPLOYEES = [{ id: 'emp-1', hourly_rate: 20 }];

// A thenable fake query-builder: every chained filter returns `this`; awaiting
// it resolves to { data, error } keyed by the table passed to `.from()`.
function makeBuilder(rows: unknown[]) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const m of ['select', 'eq', 'is', 'gte', 'lte', 'order']) builder[m] = vi.fn(chain);
  builder.then = (resolve: (v: { data: unknown[]; error: null }) => void) =>
    resolve({ data: rows, error: null });
  return builder;
}

const createWrapper = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
};

describe('useLaborIntradaySeries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetToday.mockReturnValue('2026-07-14'); // dateStr below is a PAST day -> no cap
    mockUseEmployees.mockReturnValue({ employees: EMPLOYEES, loading: false, error: null });
    fromMock.mockImplementation((table: string) =>
      table === 'unified_sales' ? makeBuilder(SALES) : makeBuilder(PUNCHES));
  });

  it('builds the intraday series from the single-day fetch (real transforms)', async () => {
    const { result } = renderHook(
      () => useLaborIntradaySeries('rest-1', 'UTC', '2026-07-06', 22, true),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const avg = computeAvgHourlyRateCents(EMPLOYEES as never);
    const sessions = identifyWorkSessions(normalizePunches(appendOpenShiftClockOuts(PUNCHES, new Date())));
    const expected = buildIntradayFinancialSeries(SALES, sessions, 'UTC', '2026-07-06', avg, 22, undefined);
    expect(result.current.series).toEqual(expected);
  });

  it('does not fetch when disabled', () => {
    const { result } = renderHook(
      () => useLaborIntradaySeries('rest-1', 'UTC', '2026-07-06', 22, false),
      { wrapper: createWrapper() },
    );
    expect(result.current.series).toEqual([]);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('does not fetch when restaurantId is null', () => {
    const { result } = renderHook(
      () => useLaborIntradaySeries(null, 'UTC', '2026-07-06', 22, true),
      { wrapper: createWrapper() },
    );
    expect(result.current.series).toEqual([]);
    expect(fromMock).not.toHaveBeenCalled();
  });
});

describe('useLaborIntradaySeries — open shift "now" tick', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  // Regression test: the `series` memo used to depend only on `data` (plus
  // dateStr/tz/rate/target), so an open shift's synthetic clock-out froze at
  // the first compute. React Query keeps `data.punches` reference-stable
  // across content-identical refetches (structural sharing), so this only
  // shows up when time passes with NO new fetch — exactly what this test
  // does via `useNowTick`, not a refetch.
  it('keeps advancing the open-shift labor hours as real time passes, with no new fetch', async () => {
    // `shouldAdvanceTime` keeps the fake clock ticking at real-world pace so
    // Testing Library's `waitFor` (which polls via real `setTimeout`) still
    // works, while `setSystemTime`/`advanceTimersByTime` can still jump it.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-07-06T14:00:00Z'));
    mockGetToday.mockReturnValue('2026-07-06'); // dateStr below IS "today" -> capHour applies
    const openShiftPunch: TimePunch = {
      id: 'p1',
      restaurant_id: 'rest-1',
      employee_id: 'emp-1',
      punch_type: 'clock_in',
      punch_time: '2026-07-06T12:00:00Z',
    } as TimePunch;
    fromMock.mockImplementation((table: string) =>
      table === 'unified_sales' ? makeBuilder(SALES) : makeBuilder([openShiftPunch]));

    const { result } = renderHook(
      () => useLaborIntradaySeries('rest-1', 'UTC', '2026-07-06', 22, true),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(fromMock).toHaveBeenCalledTimes(2); // one fetch for sales, one for punches

    const sumHours = () => result.current.series.reduce((total, p) => total + p.laborHours, 0);
    const hoursAt14 = sumHours();
    expect(hoursAt14).toBeGreaterThan(0); // clocked in at 12:00, ~2h worked so far

    // Advance 2 real hours. No refetch: the queryKey is unchanged, so React
    // Query serves the same `data` object — only the `useNowTick` ticker moves.
    act(() => {
      vi.setSystemTime(new Date('2026-07-06T16:00:00Z'));
      vi.advanceTimersByTime(2 * 60 * 60 * 1000);
    });

    expect(fromMock).toHaveBeenCalledTimes(2); // still no new fetch
    const hoursAt16 = sumHours();
    expect(hoursAt16).toBeGreaterThan(hoursAt14); // the open shift kept accruing hours
  });
});
