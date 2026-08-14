import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ShiftRow } from '@/components/employee/ShiftRow';
import { Shift } from '@/types/scheduling';

/** Far enough out that `isFuture` stays true whatever day the suite runs. */
const FUTURE = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
const futureAt = (hoursOffset: number) =>
  new Date(FUTURE.getTime() + hoursOffset * 60 * 60 * 1000).toISOString();

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

describe('ShiftRow draft treatment', () => {
  it('labels an unpublished shift as an unconfirmed draft', () => {
    render(<ShiftRow shift={makeShift({ is_published: false })} />);

    // The badge text is the signal that survives a screen reader, a
    // colour-blind viewer and a greyscale phone -- the dashed border alone
    // would not.
    expect(screen.getByText('Draft — not confirmed')).toBeInTheDocument();
  });

  it('offers a Trade button on a draft shift and marks the row as a draft', async () => {
    const onTrade = vi.fn();
    render(<ShiftRow shift={makeShift({ is_published: false })} onTrade={onTrade} />);

    // The draft-trade design allows a trade before publication. The row
    // must still read as a draft next to the button.
    expect(screen.getByText('Draft — not confirmed')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /trade/i }));
    expect(onTrade).toHaveBeenCalledTimes(1);
  });

  it('shows the normal status badge and Trade button once published', async () => {
    const onTrade = vi.fn();
    render(<ShiftRow shift={makeShift()} onTrade={onTrade} />);

    expect(screen.queryByText('Draft — not confirmed')).not.toBeInTheDocument();
    expect(screen.getByText('Upcoming')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /trade/i }));
    expect(onTrade).toHaveBeenCalledTimes(1);
  });

  it('keeps a cancelled shift reading as cancelled, not as a draft', () => {
    render(<ShiftRow shift={makeShift({ status: 'cancelled' })} onTrade={vi.fn()} />);

    expect(screen.getByText('Cancelled')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /trade/i })).not.toBeInTheDocument();
  });

  it('takes the same draft branch in the Upcoming card as in the day grid', () => {
    render(<ShiftRow shift={makeShift({ is_published: false })} variant="upcoming" />);

    // The Upcoming card is the one an employee reads first on mobile; a draft
    // that looked confirmed there is the exact reported confusion.
    expect(screen.getByText('Draft — not confirmed')).toBeInTheDocument();
  });
});
