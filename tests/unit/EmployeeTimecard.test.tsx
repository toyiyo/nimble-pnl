/**
 * Behavioral tests for src/pages/EmployeeTimecard.tsx
 *
 * Design spec: docs/superpowers/specs/2026-07-09-overnight-shift-punch-windowing-design.md (§4)
 * Plan: docs/superpowers/plans/2026-07-09-overnight-shift-punch-windowing.md (Task 4, Step 5)
 *
 * Pins the overnight-shift windowing fix at the component level:
 *   - `useTimePunches` is called with a BUFFERED range (bufferPunchFetchRange),
 *     not the raw startDate/endDate, and now includes an endDate bound.
 *   - The "Net Hours" summary (weeklyTotals, sourced from hoursByClockInDay)
 *     attributes an overnight shift's hours ENTIRELY to its clock-in day, even
 *     though the clock-out punch is only present because of the buffer.
 *   - The per-day card for the clock-in day shows the full shift hours; the
 *     next day's card shows none of it (no double count, no split).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import EmployeeTimecard from '@/pages/EmployeeTimecard';
import { bufferPunchFetchRange } from '@/utils/punchWindow';
import { businessDayRangeToInstants } from '@/lib/restaurantClock';
import { toDateOnlyString } from '@/lib/dateOnly';
import type { TimePunch } from '@/types/timeTracking';

const { useTimePunchesMock, useCurrentEmployeeMock, usePeriodNavigationMock } = vi.hoisted(() => ({
  useTimePunchesMock: vi.fn(),
  useCurrentEmployeeMock: vi.fn(),
  usePeriodNavigationMock: vi.fn(),
}));

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: { restaurant_id: 'r1', restaurant: { name: 'Test Cafe' } },
  }),
}));

vi.mock('@/hooks/useCurrentEmployee', () => ({
  useCurrentEmployee: (...args: unknown[]) => useCurrentEmployeeMock(...args),
}));

vi.mock('@/hooks/useTimePunches', () => ({
  useTimePunches: (...args: unknown[]) => useTimePunchesMock(...args),
}));

vi.mock('@/hooks/usePeriodNavigation', () => ({
  usePeriodNavigation: (...args: unknown[]) => usePeriodNavigationMock(...args),
}));

// Mon 2026-07-06 .. Sun 2026-07-12 (matches WEEK_STARTS_ON = Mon)
const startDate = new Date(2026, 6, 6, 0, 0, 0, 0);
const endDate = new Date(2026, 6, 12, 23, 59, 59, 999);

const punch = (id: string, type: TimePunch['punch_type'], date: Date): TimePunch =>
  ({
    id,
    employee_id: 'e1',
    restaurant_id: 'r1',
    punch_type: type,
    punch_time: date.toISOString(),
  }) as TimePunch;

describe('EmployeeTimecard overnight windowing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useCurrentEmployeeMock.mockReturnValue({
      currentEmployee: { id: 'e1', name: 'Night Owl', position: 'Cook' },
      loading: false,
    });
    usePeriodNavigationMock.mockReturnValue({
      periodType: 'current_week',
      setPeriodType: vi.fn(),
      startDate,
      endDate,
      handlePreviousWeek: vi.fn(),
      handleNextWeek: vi.fn(),
      handleToday: vi.fn(),
    });
  });

  it('fetches time punches with the ±18h buffered range, not the raw period', () => {
    useTimePunchesMock.mockReturnValue({ punches: [], loading: false });

    render(<EmployeeTimecard />);

    expect(useTimePunchesMock).toHaveBeenCalledTimes(1);
    const [restaurantId, employeeId, fetchStartArg, fetchEndArg] = useTimePunchesMock.mock.calls[0];
    // The buffer is applied to the RESTAURANT's day bounds (the mocked
    // restaurant carries no timezone, so this falls back to the DB default,
    // America/Chicago), not to startDate/endDate's own host-local instant
    // values -- see the fetchStart/fetchEnd comment in EmployeeTimecard.tsx.
    const { start: dayStart, end: dayEnd } = businessDayRangeToInstants(
      toDateOnlyString(startDate),
      toDateOnlyString(endDate),
      'America/Chicago',
    );
    const { fetchStart, fetchEnd } = bufferPunchFetchRange(dayStart, dayEnd);

    expect(restaurantId).toBe('r1');
    expect(employeeId).toBe('e1');
    expect((fetchStartArg as Date).getTime()).toBe(fetchStart.getTime());
    expect((fetchEndArg as Date).getTime()).toBe(fetchEnd.getTime());
  });

  it('attributes an overnight shift entirely to the clock-in day (no drop, no split)', () => {
    // Sat 2026-07-11 23:00 -> Sun 2026-07-12 07:00 (8h). The clock-out punch is
    // only fetched because of the look-ahead buffer past `endDate`.
    const clockIn = new Date(2026, 6, 11, 23, 0, 0, 0);
    const clockOut = new Date(2026, 6, 12, 7, 0, 0, 0);
    useTimePunchesMock.mockReturnValue({
      punches: [punch('in', 'clock_in', clockIn), punch('out', 'clock_out', clockOut)],
      loading: false,
    });

    render(<EmployeeTimecard />);

    // Weekly Net Hours summary reflects the full 8h shift exactly once.
    expect(screen.getAllByText('8h 0m').length).toBeGreaterThan(0);

    // Saturday's day card shows the full 8h; Sunday's shows none.
    const satHeading = screen.getByText('Jul 11');
    const satCard = satHeading.closest('div.p-4');
    expect(satCard).not.toBeNull();
    expect(satCard!.textContent).toContain('8h 0m');

    const sunHeading = screen.getByText('Jul 12');
    const sunCard = sunHeading.closest('div.p-4');
    expect(sunCard).not.toBeNull();
    expect(sunCard!.textContent).toContain('0h 0m');
  });

  // The restaurant mock carries no `timezone`, so useRestaurantClock falls back
  // to the DB default (America/Chicago) regardless of the host's TZ. Both punch
  // instants land on Wed Jul 8 in Chicago but on Thu Jul 9 in UTC (CI) and in
  // Pacific/Auckland -- so bucketing by the host's calendar fields fails this.
  it('buckets punches by the restaurant day, not the viewer local day', () => {
    const clockIn = new Date('2026-07-08T19:00:00Z'); // Jul 8 2:00 PM CDT
    const clockOut = new Date('2026-07-09T02:30:00Z'); // Jul 8 9:30 PM CDT
    useTimePunchesMock.mockReturnValue({
      punches: [punch('in', 'clock_in', clockIn), punch('out', 'clock_out', clockOut)],
      loading: false,
    });

    render(<EmployeeTimecard />);

    const wedCard = screen.getByText('Jul 8').closest('div.p-4');
    expect(wedCard).not.toBeNull();
    // Punch chips render in the restaurant's zone too, not the browser's.
    expect(wedCard!.textContent).toContain('2:00 PM');
    expect(wedCard!.textContent).toContain('9:30 PM');

    const thuCard = screen.getByText('Jul 9').closest('div.p-4');
    expect(thuCard).not.toBeNull();
    expect(thuCard!.textContent).toContain('No punches recorded');
  });

  // Regression: `periodPunches` (the display list feeding punchesByDay) must
  // filter by RESTAURANT business-day membership, not by comparing punch_time
  // instants to startDate/endDate directly. startDate/endDate here are
  // host-local instants (see the fixture comment above); on a host west of
  // America/Chicago (UTC, Pacific/Auckland -- both in this suite's TZ
  // matrix), endDate's instant lands hours BEFORE the restaurant's actual
  // Jul-12 day boundary. A punch late in the restaurant's Jul 12 evening
  // would previously fall after that early endDate and vanish from this
  // card's chip list (and from `punchesByDay`) even though `dayHours` --
  // sourced from the unfiltered buffered punches -- still counted its hours,
  // producing a card with nonzero net hours and "No punches recorded".
  it('includes a punch late in the restaurant business day even when it falls after the viewer-local endDate instant', () => {
    // 2026-07-13T01:00:00Z = 2026-07-12 20:00 CDT -- restaurant business day
    // Jul 12, the last day of the period, but AFTER `endDate`'s instant
    // (2026-07-12T23:59:59.999Z under TZ=UTC, and earlier still under
    // TZ=Pacific/Auckland) once read literally.
    const clockIn = new Date('2026-07-13T01:00:00Z');
    useTimePunchesMock.mockReturnValue({
      punches: [punch('in', 'clock_in', clockIn)],
      loading: false,
    });

    render(<EmployeeTimecard />);

    const sunCard = screen.getByText('Jul 12').closest('div.p-4');
    expect(sunCard).not.toBeNull();
    expect(sunCard!.textContent).not.toContain('No punches recorded');
    // Rendered in the restaurant's zone: 2026-07-13T01:00:00Z is 8:00 PM CDT.
    expect(sunCard!.textContent).toContain('8:00 PM');
  });
});
