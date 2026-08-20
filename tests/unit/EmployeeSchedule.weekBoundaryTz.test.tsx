/**
 * Regression guard for a bug in the restaurant-clock fix itself: the week
 * grid used to anchor on `startOfWeek(new Date(), ...)` -- the HOST clock --
 * while `shiftsByDay` bucketed each shift by `clock.toBusinessDay` -- the
 * RESTAURANT clock. The two clocks agree on which week "now" falls in almost
 * always, so `tests/unit/EmployeeSchedule.restaurantTz.test.tsx` (which picks
 * an instant deliberately inside one shared week) could not catch it.
 *
 * This file pins an instant where the host (America/Phoenix, fixed UTC-7)
 * reads Sunday of one week and the restaurant (Pacific/Auckland, ~19h ahead
 * in July) already reads Monday of the next. A host-anchored week grid does
 * not contain the restaurant's current day at all, so a shift scheduled for
 * that day matches no column and silently disappears -- the exact "matched
 * no column and vanished" defect class this fix (EmployeeSchedule.tsx) is
 * meant to close, reintroduced from the opposite direction.
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
 *   America/Phoenix   -> Sun 2026-07-26 23:30  (host: last day of the
 *                        Mon 2026-07-20 - Sun 2026-07-26 week)
 *   Pacific/Auckland  -> Mon 2026-07-27 18:30  (restaurant: first day of the
 *                        Mon 2026-07-27 - Sun 2026-08-02 week)
 * The two clocks disagree about which WEEK "now" falls in, not just which
 * day -- the case the sibling `EmployeeSchedule.restaurantTz.test.tsx`
 * deliberately does not exercise.
 */
const NOW_UTC = '2026-07-27T06:30:00.000Z';

/** 30 minutes after "now", still Monday 2026-07-27 in Auckland. */
const SHIFT_START_UTC = '2026-07-27T07:00:00.000Z';
const SHIFT_END_UTC = '2026-07-27T11:00:00.000Z';

const RESTAURANT_WEEK_MONDAY = '2026-07-27';
const RESTAURANT_WEEK_SUNDAY = '2026-08-02';
const HOST_WEEK_SUNDAY = '2026-07-26';

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

describe('EmployeeSchedule — the week grid follows the restaurant clock across a week boundary', () => {
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

  it('proves the two clocks disagree about which WEEK "now" falls in', () => {
    // Host: Sunday, last day of the Jul 20 week. Restaurant: Monday, first
    // day of the Jul 27 week. A host-anchored `startOfWeek(new Date())`
    // and a restaurant-anchored one therefore pick DIFFERENT weeks.
    expect(new Date(NOW_UTC).getDay()).toBe(0); // host: Sunday
    expect(
      new Intl.DateTimeFormat('en-CA', { timeZone: RESTAURANT_TZ }).format(new Date(NOW_UTC))
    ).toBe(RESTAURANT_WEEK_MONDAY); // restaurant: Monday, the next week
  });

  it('renders the restaurant week (Mon Jul 27 - Sun Aug 2), not the host week', () => {
    renderPage();

    expect(screen.getByTestId(`schedule-day-${RESTAURANT_WEEK_MONDAY}`)).toBeInTheDocument();
    expect(screen.getByTestId(`schedule-day-${RESTAURANT_WEEK_SUNDAY}`)).toBeInTheDocument();
    // The host's week never appears -- a host-anchored grid would show this
    // day instead of Jul 27, and the shift below would have no column.
    expect(screen.queryByTestId(`schedule-day-${HOST_WEEK_SUNDAY}`)).not.toBeInTheDocument();
  });

  it('does not drop the shift scheduled for the restaurant current day', () => {
    renderPage();

    const restaurantTodayRow = screen.getByTestId(`schedule-day-${RESTAURANT_WEEK_MONDAY}`);
    expect(within(restaurantTodayRow).getByText('Line Cook')).toBeInTheDocument();
    expect(within(dayHeader(RESTAURANT_WEEK_MONDAY)).getByText('Today')).toBeInTheDocument();
  });
});
