import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { DailyLaborPercentBadge } from '@/components/scheduling/DailyLaborPercentBadge';

const BASE = { targetLaborPct: 22, lookbackWeeks: 4, dayLabel: 'Monday, Sep 28' };

describe('DailyLaborPercentBadge', () => {
  it('shows a skeleton while projected sales load', () => {
    render(<DailyLaborPercentBadge {...BASE} value={undefined} isLoading />);
    expect(screen.getByTestId('daily-labor-percent-loading')).toBeInTheDocument();
    expect(screen.queryByText(/Labor/)).not.toBeInTheDocument();
  });

  it('shows the rounded percent with a full aria-label', () => {
    render(
      <DailyLaborPercentBadge
        {...BASE}
        isLoading={false}
        value={{ laborCost: 212.4, projectedSales: 1000, percent: 21.24, overTarget: false }}
      />,
    );
    const badge = screen.getByLabelText(
      'Monday, Sep 28 labor cost: 21% of projected sales. $212 scheduled, $1,000 projected sales, target 22%.',
    );
    expect(badge).toHaveTextContent('Labor 21%');
    expect(badge).toHaveClass('text-muted-foreground');
    expect(badge).toHaveAttribute('tabindex', '0');
  });

  it('uses the destructive color when the percent is over target', () => {
    render(
      <DailyLaborPercentBadge
        {...BASE}
        isLoading={false}
        value={{ laborCost: 300, projectedSales: 1000, percent: 30, overTarget: true }}
      />,
    );
    const badge = screen.getByText('Labor 30%');
    expect(badge).toHaveClass('text-destructive');
    expect(badge).toHaveAccessibleName(/over the 22% target/);
  });

  it('shows a dash when the day has no projected sales', () => {
    render(
      <DailyLaborPercentBadge
        {...BASE}
        isLoading={false}
        value={{ laborCost: 120, projectedSales: 0, percent: null, overTarget: false }}
      />,
    );
    const badge = screen.getByText('Labor —');
    expect(badge).toHaveAccessibleName(
      'Monday, Sep 28 labor cost: no projected sales. No sales history for this weekday in the last 4 weeks.',
    );
  });

  it('renders plain text with no focus stop in the plain variant', () => {
    render(
      <DailyLaborPercentBadge
        {...BASE}
        variant="plain"
        isLoading={false}
        value={{ laborCost: 250, projectedSales: 1000, percent: 25, overTarget: true }}
      />,
    );
    const badge = screen.getByText('Labor 25%');
    expect(badge).not.toHaveAttribute('tabindex');
    expect(badge).toHaveClass('text-destructive');
  });
});
