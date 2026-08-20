import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ShiftRow } from '@/components/employee/ShiftRow';
import { Shift } from '@/types/scheduling';
import { makeClock } from '../helpers/restaurantClock';
import { pinHostTzToPhoenix } from '../helpers/timezone';

/** Far enough out that `isFuture` stays true whatever day the suite runs. */
const FUTURE = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
const futureAt = (hoursOffset: number) =>
  new Date(FUTURE.getTime() + hoursOffset * 60 * 60 * 1000).toISOString();
const nowAt = (hoursOffset: number) =>
  new Date(Date.now() + hoursOffset * 60 * 60 * 1000).toISOString();

function makeShift(overrides: Partial<Shift> = {}): Shift {
  return {
    id: 'shift-1',
    restaurant_id: 'r1',
    employee_id: 'e1',
    start_time: futureAt(0),
    end_time: futureAt(8),
    position: 'Server',
    status: 'scheduled',
    break_duration: 30,
    is_published: true,
    locked: false,
    source: 'manual',
    created_at: futureAt(-100),
    updated_at: futureAt(-100),
    ...overrides,
  };
}

/**
 * `Completed` and `In Progress` compare instants (`isPast`, `now >= start &&
 * now <= end`), so the host zone must not change the result. Both cases run
 * once under the suite's default zone and once with the host pinned to
 * `America/Phoenix`.
 */
function assertCompletedAndInProgressBadges(): void {
  const completedShift = makeShift({ start_time: nowAt(-3), end_time: nowAt(-1) });
  render(<ShiftRow shift={completedShift} clock={makeClock()} />);
  expect(screen.getByText('Completed')).toBeInTheDocument();
  cleanup();

  const inProgressShift = makeShift({ start_time: nowAt(-1), end_time: nowAt(1) });
  render(<ShiftRow shift={inProgressShift} clock={makeClock()} />);
  expect(screen.getByText('In Progress')).toBeInTheDocument();
  cleanup();
}

describe('ShiftRow draft treatment', () => {
  it('shows no explanatory draft copy on an unpublished shift', () => {
    render(<ShiftRow shift={makeShift({ is_published: false })} clock={makeClock()} />);

    // Many restaurants never publish. Words like "not confirmed" on a real
    // shift caused a no-show. The draft state is a hue, not a warning.
    expect(screen.queryByText('Draft — not confirmed')).not.toBeInTheDocument();
    expect(screen.getByText('Upcoming')).toBeInTheDocument();
  });

  it('keeps a screen-reader-only Draft label on an unpublished shift', () => {
    render(<ShiftRow shift={makeShift({ is_published: false })} clock={makeClock()} />);

    // The hue alone would fail a screen reader and WCAG 1.4.1. The label is
    // sr-only, so sighted users see no extra copy.
    const label = screen.getByText('Draft');
    expect(label).toHaveClass('sr-only');
  });

  it('offers a Trade button on a draft shift', async () => {
    const onTrade = vi.fn();
    render(
      <ShiftRow shift={makeShift({ is_published: false })} onTrade={onTrade} clock={makeClock()} />
    );

    // The draft-trade design allows a trade before publication.
    await userEvent.click(screen.getByRole('button', { name: /trade/i }));
    expect(onTrade).toHaveBeenCalledTimes(1);
  });

  it('shows the normal status badge and no Draft label once published', async () => {
    const onTrade = vi.fn();
    render(<ShiftRow shift={makeShift()} onTrade={onTrade} clock={makeClock()} />);

    expect(screen.queryByText('Draft')).not.toBeInTheDocument();
    expect(screen.getByText('Upcoming')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /trade/i }));
    expect(onTrade).toHaveBeenCalledTimes(1);
  });

  it('keeps a cancelled shift reading as cancelled, not as a draft', () => {
    render(
      <ShiftRow
        shift={makeShift({ status: 'cancelled', is_published: false })}
        onTrade={vi.fn()}
        clock={makeClock()}
      />
    );

    expect(screen.getByText('Cancelled')).toBeInTheDocument();
    // "It's cancelled" is the fact the employee has to leave with.
    expect(screen.queryByText('Draft')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /trade/i })).not.toBeInTheDocument();
  });

  it('takes the same draft branch in the Upcoming card as in the day grid', () => {
    render(
      <ShiftRow shift={makeShift({ is_published: false })} variant="upcoming" clock={makeClock()} />
    );

    expect(screen.queryByText('Draft — not confirmed')).not.toBeInTheDocument();
    expect(screen.getByText('Draft')).toHaveClass('sr-only');
  });

  it('shows Completed on a shift that ended one hour ago', () => {
    const shift = makeShift({ start_time: nowAt(-3), end_time: nowAt(-1) });
    render(<ShiftRow shift={shift} clock={makeClock()} />);

    expect(screen.getByText('Completed')).toBeInTheDocument();
  });

  it('shows In Progress on a shift that is happening now', () => {
    const shift = makeShift({ start_time: nowAt(-1), end_time: nowAt(1) });
    render(<ShiftRow shift={shift} clock={makeClock()} />);

    expect(screen.getByText('In Progress')).toBeInTheDocument();
  });

  it('keeps the Completed and In Progress badges unchanged under the default host zone', () => {
    assertCompletedAndInProgressBadges();
  });

  it('keeps the Completed and In Progress badges unchanged with the host zone pinned to America/Phoenix', () => {
    const originalTz = process.env.TZ;

    pinHostTzToPhoenix();

    try {
      assertCompletedAndInProgressBadges();
    } finally {
      if (originalTz === undefined) delete process.env.TZ;
      else process.env.TZ = originalTz;
    }
  });
});
