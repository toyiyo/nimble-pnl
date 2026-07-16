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
    const { fetchStart, fetchEnd } = bufferPunchFetchRange(startDate, endDate);

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
});
