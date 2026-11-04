import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { DailyLaborPercentBadge } from '@/components/scheduling/DailyLaborPercentBadge';

import type { DailyLaborPercent, DailyLaborPercentView } from '@/lib/dailyLaborPercent';

const DAY = '2026-09-28';

function labor(value?: DailyLaborPercent, overrides: Partial<DailyLaborPercentView> = {}): DailyLaborPercentView {
  return {
    byDay: new Map(value ? [[DAY, value]] : []),
    isLoading: false,
    hasError: false,
    targetLaborPct: 22,
    lookbackWeeks: 4,
    ...overrides,
  };
}

const PROPS = { day: DAY, dayLabel: 'Mon, Sep 28' };

describe('DailyLaborPercentBadge', () => {
  it('shows a span skeleton while the data loads', () => {
    render(<DailyLaborPercentBadge {...PROPS} labor={labor(undefined, { isLoading: true })} />);
    const skeleton = screen.getByTestId('daily-labor-percent-loading');
    expect(skeleton.tagName).toBe('SPAN');
    expect(screen.queryByText(/Labor/)).not.toBeInTheDocument();
  });

  it('shows the rounded percent with a full aria-label', () => {
    render(
      <DailyLaborPercentBadge
        {...PROPS}
        labor={labor({ laborCost: 212.4, projectedSales: 1000, percent: 21.24, overTarget: false })}
      />,
    );
    const badge = screen.getByLabelText(
      'Mon, Sep 28 labor cost: 21% of projected sales. $212 scheduled, $1,000 projected sales, target 22%.',
    );
    expect(badge).toHaveTextContent('Labor 21%');
    expect(badge).toHaveClass('text-muted-foreground');
    expect(badge).toHaveAttribute('tabindex', '0');
  });

  it('uses the destructive color when the percent is over target', () => {
    render(
      <DailyLaborPercentBadge
        {...PROPS}
        labor={labor({ laborCost: 300, projectedSales: 1000, percent: 30, overTarget: true })}
      />,
    );
    const badge = screen.getByText('Labor 30%');
    expect(badge).toHaveClass('text-destructive');
    expect(badge).toHaveAccessibleName(/over the 22% target/);
  });

  it('shows a dash when the day has no projected sales', () => {
    render(
      <DailyLaborPercentBadge
        {...PROPS}
        labor={labor({ laborCost: 120, projectedSales: 0, percent: null, overTarget: false })}
      />,
    );
    expect(screen.getByText('Labor —')).toHaveAccessibleName(
      'Mon, Sep 28 labor cost: no projected sales. No sales history for this weekday in the last 4 weeks.',
    );
  });

  it('does not claim "no sales history" when the sales query fails', () => {
    render(
      <DailyLaborPercentBadge
        {...PROPS}
        labor={labor({ laborCost: 250, projectedSales: 1000, percent: 25, overTarget: true }, { hasError: true })}
      />,
    );
    const badge = screen.getByText('Labor —');
    expect(badge).toHaveAccessibleName('Mon, Sep 28 labor cost: could not load projected sales.');
    expect(badge).toHaveClass('text-muted-foreground');
  });

  it('renders plain text with no focus stop in the plain variant', () => {
    render(
      <DailyLaborPercentBadge
        {...PROPS}
        variant="plain"
        labor={labor({ laborCost: 250, projectedSales: 1000, percent: 25, overTarget: true })}
      />,
    );
    const badge = screen.getByText('Labor 25%');
    expect(badge).not.toHaveAttribute('tabindex');
    expect(badge).toHaveClass('text-destructive');
  });

  it('uses the inverse text color under the target', () => {
    render(
      <DailyLaborPercentBadge
        {...PROPS}
        variant="plain"
        inverse
        labor={labor({ laborCost: 100, projectedSales: 1000, percent: 10, overTarget: false })}
      />,
    );
    expect(screen.getByText('Labor 10%')).toHaveClass('text-background/80');
  });
});
