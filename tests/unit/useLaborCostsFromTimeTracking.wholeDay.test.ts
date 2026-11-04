/**
 * useLaborCostsFromTimeTracking works on whole restaurant days (single labor
 * engine design, "Behavior changes"). The hook turns dateFrom / dateTo into
 * calendar days (their local fields) and the loader reads whole days:
 *
 * - A dateTo at midnight of a Sunday (src/pages/Index.tsx builds the
 *   previous period this way) now counts that whole Sunday. Before, the
 *   fetch ended at that midnight + 18 h, and a Sunday-night shift that clocks
 *   out on Monday was lost.
 * - A dateFrom in the middle of a day (subDays(now, 30)) now counts the
 *   whole first day in dailyCosts. Before, the punches before dateFrom were
 *   dropped from the daily series.
 *
 * The dates use local-field constructors, so the calendar day is the same on
 * every host. The punches are fixed UTC instants. The restaurant is Chicago.
 */
import React, { type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { makeLaborStubClient, type Row, type StubClient } from './helpers/laborStubClient';
import { loadPeriodLaborCost } from '../../supabase/functions/_shared/labor/periodLaborCost';

const REST = 'rest-1';

const { employees } = vi.hoisted(() => ({
  employees: [
    {
      id: 'e1',
      restaurant_id: 'rest-1',
      name: 'E1',
      position: 'Cook',
      status: 'active',
      is_active: true,
      compensation_type: 'hourly',
      hourly_rate: 1000, // $10.00 an hour
    },
  ],
}));

vi.mock('@/hooks/useEmployees', () => ({
  useEmployees: () => ({ employees, loading: false }),
}));

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: { restaurant: { timezone: 'America/Chicago' } },
  }),
}));

let stub: StubClient = makeLaborStubClient({});
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: (table: string) => stub.from(table) },
}));

function punch(id: string, time: string, type: string): Row {
  return {
    id,
    employee_id: 'e1',
    restaurant_id: REST,
    punch_time: time,
    punch_type: type,
    created_at: time,
    updated_at: time,
    shift_id: null,
    notes: null,
    photo_path: null,
    device_info: null,
    location: null,
    created_by: null,
    modified_by: null,
  };
}

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
};

describe('useLaborCostsFromTimeTracking whole restaurant days', () => {
  beforeEach(() => {
    stub = makeLaborStubClient({});
  });

  it('counts a Sunday-night shift that clocks out on Monday when dateTo is Sunday midnight', async () => {
    // Sun Jul 26 20:00 CDT to Mon Jul 27 02:00 CDT: 6 h at $10.
    stub = makeLaborStubClient({
      time_punches: [
        punch('p1', '2026-07-27T01:00:00.000Z', 'clock_in'),
        punch('p2', '2026-07-27T07:00:00.000Z', 'clock_out'),
      ],
    });
    const { useLaborCostsFromTimeTracking } = await import('@/hooks/useLaborCostsFromTimeTracking');

    const dateFrom = new Date(2026, 6, 20); // Mon Jul 20
    const dateTo = new Date(2026, 6, 26); // Sun Jul 26, 00:00 local

    const { result } = renderHook(
      () => useLaborCostsFromTimeTracking(REST, dateFrom, dateTo),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const sunday = result.current.dailyCosts.find((d) => d.date === '2026-07-26');
    expect(sunday).toEqual(expect.objectContaining({ hourly_wages: 60, total_hours: 6 }));
    expect(result.current.totalCost).toBeCloseTo(60, 6);
    expect(result.current.wageCost).toBeCloseTo(60, 6);
  });

  it('counts the whole first day in dailyCosts when dateFrom is in the middle of the day', async () => {
    // Wed Jul 22 09:00 to 13:00 CDT: 4 h at $10, before the 15:00 dateFrom.
    stub = makeLaborStubClient({
      time_punches: [
        punch('p1', '2026-07-22T14:00:00.000Z', 'clock_in'),
        punch('p2', '2026-07-22T18:00:00.000Z', 'clock_out'),
      ],
    });
    const { useLaborCostsFromTimeTracking } = await import('@/hooks/useLaborCostsFromTimeTracking');

    const dateFrom = new Date(2026, 6, 22, 15, 0, 0, 0);
    const dateTo = new Date(2026, 6, 22, 23, 59, 59, 999);

    const { result } = renderHook(
      () => useLaborCostsFromTimeTracking(REST, dateFrom, dateTo),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.dailyCosts).toEqual([
      expect.objectContaining({ date: '2026-07-22', hourly_wages: 40, total_hours: 4 }),
    ]);
    expect(result.current.totalCost).toBeCloseTo(40, 6);
  });

  it('returns the loader result for the same input', async () => {
    const rows = {
      time_punches: [
        punch('p1', '2026-07-21T14:00:00.000Z', 'clock_in'),
        punch('p2', '2026-07-21T23:30:00.000Z', 'clock_out'),
        punch('p3', '2026-07-22T14:00:00.000Z', 'clock_in'),
        punch('p4', '2026-07-22T18:00:00.000Z', 'clock_out'),
      ],
      tip_split_items: [
        { id: 't1', amount: 700, employee_id: 'e1', tip_splits: { restaurant_id: REST, split_date: '2026-07-21' } },
      ],
    };
    stub = makeLaborStubClient(rows);
    const { useLaborCostsFromTimeTracking } = await import('@/hooks/useLaborCostsFromTimeTracking');

    const { result } = renderHook(
      () => useLaborCostsFromTimeTracking(REST, new Date(2026, 6, 20), new Date(2026, 6, 26, 23, 59, 59, 999)),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const loaded = await loadPeriodLaborCost(makeLaborStubClient(rows), {
      restaurantId: REST,
      startDay: '2026-07-20',
      endDay: '2026-07-26',
      timeZone: 'America/Chicago',
      employees: employees as never,
      throughNow: false,
      now: new Date('2026-07-27T12:00:00.000Z'),
    });

    expect(result.current.dailyCosts).toEqual(loaded.dailyCosts);
    expect(result.current.totalCost).toBe(loaded.totalCost);
    expect(result.current.wageCost).toBe(loaded.wageCost);
    expect(result.current.capped).toBe(loaded.capped);
    // 9.5 h + 4 h at $10, plus $7 of tips owed.
    expect(loaded.totalCost).toBeCloseTo(142, 6);
  });
});
