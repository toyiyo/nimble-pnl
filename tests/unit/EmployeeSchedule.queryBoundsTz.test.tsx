/**
 * Regression guard for a bug found in PR #764 review: `EmployeeSchedule.tsx`
 * passed `currentWeekStart`/`weekEnd` -- host-local calendar `Date`s -- straight
 * into `useMyShifts`, which serializes them with `.toISOString()` for the
 * `gte`/`lte` query bounds. That works only when the host and restaurant sit
 * in the same zone. For a Phoenix viewer and an Auckland restaurant the two
 * windows are ~19h apart, so most of Auckland's Monday shifts would fall
 * outside the query and never load -- the wrong day row shows "No shifts
 * scheduled" not because the shift is missing, but because it was never
 * fetched.
 *
 * The fix derives the query instants from `businessDayRangeToInstants`,
 * which resolves restaurant-local midnight, not host-local midnight. This
 * test asserts `useMyShifts` receives those restaurant-zoned instants.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Shift } from '@/types/scheduling';
import { pinHostTzToPhoenix } from '../helpers/timezone';

const RESTAURANT_TZ = 'Pacific/Auckland';

/**
 * Same pinned moment as `EmployeeSchedule.weekBoundaryTz.test.tsx`:
 *   America/Phoenix   -> Sun 2026-07-26 23:30 (host week: Jul 20 - Jul 26)
 *   Pacific/Auckland  -> Mon 2026-07-27 18:30 (restaurant week: Jul 27 - Aug 2)
 */
const NOW_UTC = '2026-07-27T06:30:00.000Z';

/** The restaurant-zoned instant bounds `businessDayRangeToInstants` must produce. */
const EXPECTED_QUERY_START = '2026-07-26T12:00:00.000Z'; // Auckland Mon Jul 27 00:00:00.000
const EXPECTED_QUERY_END = '2026-08-02T11:59:59.999Z'; // Auckland Sun Aug 2 23:59:59.999

/**
 * The bug's bounds: host-local (Phoenix, fixed UTC-7) midnight of the SAME
 * calendar-day strings, run through `.toISOString()`. If `useMyShifts` ever
 * receives these instead, the fix has regressed.
 */
const BUGGY_HOST_QUERY_START = '2026-07-27T07:00:00.000Z';
const BUGGY_HOST_QUERY_END = '2026-08-03T06:59:59.999Z';

const useMyShiftsMock = vi.fn().mockReturnValue({
  shifts: [] as Shift[],
  loading: false,
  error: null,
  refetch: vi.fn(),
});

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: {
      restaurant_id: 'r1',
      role: 'staff',
      restaurant: { name: 'Test Cafe', timezone: RESTAURANT_TZ },
    },
  }),
}));

vi.mock('@/hooks/useCurrentEmployee', () => ({
  useCurrentEmployee: () => ({
    currentEmployee: { id: 'e1', name: 'Sam Rivera', position: 'Line Cook' },
    loading: false,
  }),
}));

vi.mock('@/hooks/useShifts', () => ({
  useMyShifts: (...args: unknown[]) => useMyShiftsMock(...args),
}));

vi.mock('@/hooks/useSchedulePublish', () => ({
  useWeekScheduleStatus: () => ({
    state: 'published',
    publication: null,
    loading: false,
  }),
}));

vi.mock('@/components/schedule/MyShiftTradesCard', () => ({
  MyShiftTradesCard: () => null,
}));
vi.mock('@/components/schedule/TradeRequestDialog', () => ({
  TradeRequestDialog: () => null,
}));

import EmployeeSchedule from '@/pages/EmployeeSchedule';

function renderPage() {
  return render(
    <MemoryRouter>
      <EmployeeSchedule />
    </MemoryRouter>
  );
}

describe('EmployeeSchedule — the shift query is bounded by the restaurant clock, not the host', () => {
  const originalTz = process.env.TZ;

  beforeEach(() => {
    useMyShiftsMock.mockClear();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(NOW_UTC));
    pinHostTzToPhoenix();
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it('calls useMyShifts with restaurant-local week-start/end instants', () => {
    renderPage();

    expect(useMyShiftsMock).toHaveBeenCalled();
    const [, , startDate, endDate] = useMyShiftsMock.mock.calls[0] as [
      string,
      string,
      Date,
      Date,
    ];

    expect(startDate.toISOString()).toBe(EXPECTED_QUERY_START);
    expect(endDate.toISOString()).toBe(EXPECTED_QUERY_END);
  });

  it('does not fall back to the host-local instants the bug used to send', () => {
    renderPage();

    const [, , startDate, endDate] = useMyShiftsMock.mock.calls[0] as [
      string,
      string,
      Date,
      Date,
    ];

    expect(startDate.toISOString()).not.toBe(BUGGY_HOST_QUERY_START);
    expect(endDate.toISOString()).not.toBe(BUGGY_HOST_QUERY_END);
  });
});
