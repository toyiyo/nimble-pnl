import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

import { ShiftRow } from '@/components/employee/ShiftRow';
import { Shift } from '@/types/scheduling';
import { makeClock } from '../helpers/restaurantClock';

/**
 * Regression guard: `ShiftRow` must read every wall-clock date from the
 * restaurant clock, not from the host browser clock. Pin the host to
 * America/Phoenix (fixed UTC-7, no DST) and the restaurant to
 * Pacific/Auckland (UTC+13 in January, NZDT). The two zones name a
 * different calendar day and a different hour for the same instant, so a
 * host-clock leak shows up as the wrong string on screen.
 *
 * The `process.env.TZ` assignment can fail SILENTLY. A Node worker caches
 * the host offset table on first `Date` use, so an earlier `Date` call in
 * the same worker can freeze it. Assert the offset instead of trusting the
 * assignment (copied from tests/unit/useShiftsRecurringCreateTz.test.ts:92).
 */
function pinHostTzToPhoenix(): void {
  process.env.TZ = 'America/Phoenix';
  expect(new Date('2026-01-31T12:00:00Z').getTimezoneOffset()).toBe(420);
}

/**
 * `2026-01-31T20:00:00Z`: Phoenix reads Sat, Jan 31, 1:00 PM. Auckland reads
 * Sun, Feb 1, 9:00 AM. Different weekday, day, month and hour in one instant.
 */
function makeShift(overrides: Partial<Shift> = {}): Shift {
  return {
    id: 'shift-1',
    restaurant_id: 'r1',
    employee_id: 'e1',
    start_time: '2026-01-31T20:00:00Z',
    end_time: '2026-02-01T04:00:00Z',
    position: 'Server',
    status: 'scheduled',
    break_duration: 30,
    is_published: true,
    locked: false,
    source: 'manual',
    created_at: '2020-01-01T00:00:00Z',
    updated_at: '2020-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('ShiftRow reads the restaurant clock, not the host clock', () => {
  const originalTz = process.env.TZ;

  beforeEach(() => {
    pinHostTzToPhoenix();
    // Fixed well before every shift in this file, so `isPast`/`isFuture`
    // land on the same branch in every case. Only the clock decides `Today`.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2020-01-01T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it('day variant shows the restaurant wall-clock time, not the host wall-clock time', () => {
    const clock = makeClock('Pacific/Auckland', '2026-02-01');
    const { container } = render(<ShiftRow shift={makeShift()} clock={clock} />);

    expect(container.textContent).toContain('9:00 AM');
    expect(container.textContent).not.toContain('1:00 PM');
  });

  it('upcoming variant shows the restaurant weekday, day and month, not the host ones', () => {
    const clock = makeClock('Pacific/Auckland', '2026-02-01');
    render(<ShiftRow shift={makeShift()} clock={clock} variant="upcoming" />);

    expect(screen.getByText('Sun')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('Feb')).toBeInTheDocument();
    expect(screen.queryByText('Sat')).not.toBeInTheDocument();
    expect(screen.queryByText('31')).not.toBeInTheDocument();
    expect(screen.queryByText('Jan')).not.toBeInTheDocument();
  });

  it('a shift that is today in Auckland shows the Today badge', () => {
    const clock = makeClock('Pacific/Auckland', '2026-02-01');
    const { container } = render(<ShiftRow shift={makeShift()} clock={clock} />);

    expect(screen.getByText('Today')).toBeInTheDocument();
    expect(container.textContent).not.toContain('1:00 PM');
  });

  it('a shift that is not today in Auckland does not show the Today badge', () => {
    const clock = makeClock('Pacific/Auckland', '2026-02-01');
    const { container } = render(
      <ShiftRow
        shift={makeShift({
          start_time: '2026-01-31T09:00:00Z',
          end_time: '2026-01-31T17:00:00Z',
        })}
        clock={clock}
      />
    );

    expect(screen.queryByText('Today')).not.toBeInTheDocument();
    expect(screen.getByText('Upcoming')).toBeInTheDocument();
    expect(container.textContent).toContain('10:00 PM');
    expect(container.textContent).not.toContain('2:00 AM');
  });
});
