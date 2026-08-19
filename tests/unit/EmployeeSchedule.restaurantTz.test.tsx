/**
 * `EmployeeSchedule.tsx` used to bucket a shift with
 *   format(parseISO(shift.start_time), 'yyyy-MM-dd')
 * and to mark a column with date-fns `isToday(day)`. Both read the HOST
 * browser's clock. The page shows the RESTAURANT's week, so a viewer in
 * another zone saw shifts in the wrong day row, and the "Today" badge on the
 * wrong day. The fix routes both through the restaurant clock:
 *   toBusinessDay(shift.start_time, restaurantTimezone)
 *   dayKey === clock.today
 *
 * The test mounts the real page. The host runs at America/Phoenix (fixed
 * UTC-7, no DST) and the restaurant at Pacific/Auckland (UTC+12 in July), so
 * the two calendars disagree by one day at the pinned instant. A host-anchored
 * implementation and a restaurant-anchored one therefore CANNOT produce the
 * same output, and a silent host-timezone coincidence cannot make this pass.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Shift } from '@/types/scheduling';
import { pinHostTzToPhoenix } from '../helpers/timezone';

const RESTAURANT_TZ = 'Pacific/Auckland';

/**
 * The pinned moment. Read it two ways:
 *   America/Phoenix   -> Mon 2026-07-27 21:00  (the host's "today")
 *   Pacific/Auckland  -> Tue 2026-07-28 16:00  (the restaurant's "today")
 * Both days sit inside the same Monday-start week, so the week the page
 * renders is identical under either clock and only the DAY differs.
 */
const NOW_UTC = '2026-07-28T04:00:00.000Z';

/**
 * One shift, 30 minutes after "now":
 *   America/Phoenix   -> Mon 2026-07-27 21:30
 *   Pacific/Auckland  -> Tue 2026-07-28 16:30
 */
const SHIFT_START_UTC = '2026-07-28T04:30:00.000Z';
const SHIFT_END_UTC = '2026-07-28T08:30:00.000Z';

const HOST_DAY = '2026-07-27'; // Monday
const RESTAURANT_DAY = '2026-07-28'; // Tuesday

const shift: Shift = {
  id: 'shift-1',
  restaurant_id: 'r1',
  employee_id: 'e1',
  start_time: SHIFT_START_UTC,
  end_time: SHIFT_END_UTC,
  break_duration: 0,
  position: 'Line Cook',
  status: 'scheduled',
  is_published: true,
  locked: false,
  source: 'manual',
  created_at: NOW_UTC,
  updated_at: NOW_UTC,
};

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
  useMyShifts: () => ({
    shifts: [shift],
    loading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock('@/hooks/useSchedulePublish', () => ({
  useWeekScheduleStatus: () => ({
    state: 'published',
    publication: null,
    loading: false,
  }),
}));

// PR #761 added this hook to the page. It runs its own React Query query, and
// these tests render without a QueryClientProvider. It has no part in day
// bucketing or in the query bounds.
vi.mock('@/hooks/useRestaurantPublishes', () => ({
  useRestaurantPublishes: () => ({ publishes: true, isLoading: false }),
}));

// Both pull their own Supabase data and neither takes part in day bucketing.
vi.mock('@/components/schedule/MyShiftTradesCard', () => ({
  MyShiftTradesCard: () => null,
}));
vi.mock('@/components/schedule/TradeRequestDialog', () => ({
  TradeRequestDialog: () => null,
}));

import EmployeeSchedule from '@/pages/EmployeeSchedule';

/**
 * The day row's header strip -- the row's first child, which holds the weekday
 * name, the date and the "Today" badge.
 *
 * The badge query must stay inside this strip. `ShiftRow` now reads the same
 * restaurant clock as this page (see ShiftRow.tsx), so it renders its own
 * "Today" badge on a shift that falls on the restaurant's current business
 * day. On the restaurant day row, that badge is correct and expected, not a
 * defect -- it sits next to the header's "Today" badge in the same row. A
 * row-wide query would find both and fail with "multiple elements", so the
 * query must stay scoped to the header strip.
 */
function dayHeader(dayKey: string): HTMLElement {
  const row = screen.getByTestId(`schedule-day-${dayKey}`);
  const header = row.firstElementChild;
  if (!(header instanceof HTMLElement)) {
    throw new Error(`day row ${dayKey} has no header strip`);
  }
  return header;
}

function renderPage() {
  return render(
    <MemoryRouter>
      <EmployeeSchedule />
    </MemoryRouter>
  );
}

describe('EmployeeSchedule — day rows follow the restaurant timezone, not the host', () => {
  const originalTz = process.env.TZ;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(NOW_UTC));
    pinHostTzToPhoenix();
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it('proves the two clocks disagree at the pinned instant', () => {
    // Without this the two assertions below could both hold for a
    // host-anchored implementation.
    expect(new Date(NOW_UTC).getDate()).toBe(27); // host: Monday
    expect(
      new Intl.DateTimeFormat('en-CA', { timeZone: RESTAURANT_TZ }).format(new Date(NOW_UTC))
    ).toBe(RESTAURANT_DAY); // restaurant: Tuesday
  });

  it('puts the shift in the restaurant Tuesday row, not the host Monday row', () => {
    renderPage();

    const restaurantRow = screen.getByTestId(`schedule-day-${RESTAURANT_DAY}`);
    const hostRow = screen.getByTestId(`schedule-day-${HOST_DAY}`);

    expect(within(restaurantRow).getByText('Line Cook')).toBeInTheDocument();
    expect(within(hostRow).getByText('No shifts scheduled')).toBeInTheDocument();
  });

  it('marks the restaurant business day as Today, not the host day', () => {
    renderPage();

    expect(within(dayHeader(RESTAURANT_DAY)).getByText('Today')).toBeInTheDocument();
    expect(within(dayHeader(HOST_DAY)).queryByText('Today')).not.toBeInTheDocument();
  });
});
