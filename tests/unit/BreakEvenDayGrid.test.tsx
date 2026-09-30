import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import type { BreakEvenData } from '@/types/operatingCosts';
import { BreakEvenDayGrid } from '@/components/dashboard/BreakEvenDayGrid';

type HistoryRow = BreakEvenData['history'][number];

function makeRow(overrides: Partial<HistoryRow>): HistoryRow {
  return {
    date: '2026-09-15',
    sales: 1000,
    breakEven: 1000,
    delta: 0,
    status: 'at',
    isPartial: false,
    ...overrides,
  };
}

describe('BreakEvenDayGrid', () => {
  it('shows the empty state text when there is no history', () => {
    render(<BreakEvenDayGrid history={[]} />);
    expect(screen.getByText('No break-even history yet.')).toBeInTheDocument();
  });

  it('renders one focusable button per day', () => {
    const history = [
      makeRow({ date: '2026-09-13' }),
      makeRow({ date: '2026-09-14' }),
      makeRow({ date: '2026-09-15' }),
    ];

    render(<BreakEvenDayGrid history={history} />);

    expect(screen.getAllByRole('button')).toHaveLength(3);
  });

  it('sets the aria-label from the day grid cell', () => {
    const history = [
      makeRow({ date: '2026-09-28', sales: 2000, status: 'below', isPartial: false, delta: -150 }),
    ];

    render(<BreakEvenDayGrid history={history} />);

    expect(
      screen.getByRole('button', { name: 'Sep 28: $2,000 sales, $150 below break-even' })
    ).toBeInTheDocument();
  });

  it('shows the partial-day "so far" text for the current day', () => {
    const history = [
      makeRow({ date: '2026-09-30', sales: 800, isPartial: true }),
    ];

    render(<BreakEvenDayGrid history={history} />);

    expect(
      screen.getByRole('button', { name: 'Sep 30: $800 sales so far' })
    ).toBeInTheDocument();
  });

  it('shows the day number visibly on each cell, not only in the aria-label', () => {
    const history = [makeRow({ date: '2026-09-28' })];

    render(<BreakEvenDayGrid history={history} />);

    expect(screen.getByRole('button', { name: /Sep 28/ })).toHaveTextContent('28');
  });

  it('sets a visible tooltip from the same text as the aria-label', () => {
    const history = [makeRow({ date: '2026-09-28' })];

    render(<BreakEvenDayGrid history={history} />);

    const button = screen.getByRole('button', { name: /Sep 28/ });
    expect(button).toHaveAttribute('title', button.getAttribute('aria-label') ?? '');
  });

  it('shows a loading state instead of the empty-history text while loading', () => {
    render(<BreakEvenDayGrid history={[]} isLoading />);

    expect(screen.queryByText('No break-even history yet.')).not.toBeInTheDocument();
    expect(document.querySelector('.animate-pulse')).toBeInTheDocument();
  });

  it('shows an error message instead of the empty-history text on error', () => {
    render(<BreakEvenDayGrid history={[]} error />);

    expect(screen.queryByText('No break-even history yet.')).not.toBeInTheDocument();
    expect(screen.getByText('Break-even history is not available right now.')).toBeInTheDocument();
  });
});
