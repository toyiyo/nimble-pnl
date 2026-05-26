import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MonthlyBreakEvenProgressCard } from '@/components/budget/MonthlyBreakEvenProgressCard';
import type { MonthlyProgress } from '@/lib/monthlyBreakEvenProgress';

function makeProgress(partial: Partial<MonthlyProgress> = {}): MonthlyProgress {
  return {
    monthLabel: 'May 2026',
    daysInMonth: 31,
    dayOfMonth: 16,
    mtdSales: 30000,
    monthlyBreakEven: 60000,
    progressPercent: 50,
    expectedPercent: (16 / 31) * 100,
    paceDelta: 50 - (16 / 31) * 100,
    status: 'on_pace',
    amountRemaining: 30000,
    daysRemaining: 16,
    dailyNeeded: 1875,
    dailyActual: 1875,
    projectedMonthly: 58125,
    projectedDelta: -1875,
    ...partial,
  };
}

describe('MonthlyBreakEvenProgressCard', () => {
  it('renders loading skeleton when isLoading is true', () => {
    const { container } = render(
      <MonthlyBreakEvenProgressCard progress={null} isLoading={true} />,
    );
    // No title in loading state; only skeleton elements
    expect(screen.queryByText(/Monthly Break-Even Progress/)).toBeNull();
    expect(container.querySelectorAll('[class*="skeleton"], .animate-pulse').length).toBeGreaterThan(0);
  });

  it('renders no-target empty state when progress.status is no_target', () => {
    render(
      <MonthlyBreakEvenProgressCard
        progress={makeProgress({ status: 'no_target', monthlyBreakEven: 0, progressPercent: 0 })}
        isLoading={false}
      />,
    );
    expect(screen.getByText('Monthly Break-Even Progress')).toBeDefined();
    expect(screen.getByText(/Add your fixed and variable costs/)).toBeDefined();
  });

  it('renders no-target empty state when progress is null and not loading', () => {
    render(<MonthlyBreakEvenProgressCard progress={null} isLoading={false} />);
    expect(screen.getByText(/Add your fixed and variable costs/)).toBeDefined();
  });

  it('renders ahead state with progress meter, projection above target, and badge', () => {
    render(
      <MonthlyBreakEvenProgressCard
        progress={makeProgress({
          status: 'ahead',
          progressPercent: 70,
          expectedPercent: 50,
          paceDelta: 20,
          mtdSales: 42000,
          amountRemaining: 18000,
          daysRemaining: 15,
          dailyNeeded: 1200,
          dailyActual: 2625,
          projectedMonthly: 81375,
          projectedDelta: 21375,
        })}
        isLoading={false}
      />,
    );
    // Meter has correct ARIA wiring
    const meter = screen.getByRole('meter');
    expect(meter.getAttribute('aria-valuenow')).toBe('70');
    expect(meter.getAttribute('aria-valuemin')).toBe('0');
    expect(meter.getAttribute('aria-valuemax')).toBe('100');
    expect(meter.getAttribute('aria-label')).toMatch(/Ahead of pace/);
    expect(meter.getAttribute('aria-label')).toMatch(/Expected by today: 50%/);

    // Status badge text
    expect(screen.getByText('Ahead of pace')).toBeDefined();

    // Headline numbers
    expect(screen.getByText(/of \$60,000 needed/)).toBeDefined();

    // Three-stat row
    expect(screen.getByText('Still needed')).toBeDefined();
    expect(screen.getByText('Days left')).toBeDefined();
    expect(screen.getByText('Per day to hit')).toBeDefined();

    // Projection sentence — "above target" branch
    expect(screen.getByText(/above target/)).toBeDefined();
  });

  it('renders behind state with below-target projection sentence', () => {
    render(
      <MonthlyBreakEvenProgressCard
        progress={makeProgress({
          status: 'behind',
          progressPercent: 20,
          expectedPercent: 50,
          paceDelta: -30,
          mtdSales: 12000,
          amountRemaining: 48000,
          daysRemaining: 15,
          dailyNeeded: 3200,
          dailyActual: 750,
          projectedMonthly: 23250,
          projectedDelta: -36750,
        })}
        isLoading={false}
      />,
    );
    expect(screen.getByText('Behind pace')).toBeDefined();
    expect(screen.getByText(/below target/)).toBeDefined();
    expect(screen.getByRole('status').textContent).toMatch(/Behind pace/);
  });

  it('renders singular "Day left" when daysRemaining is 1', () => {
    render(
      <MonthlyBreakEvenProgressCard
        progress={makeProgress({ status: 'ahead', daysRemaining: 1 })}
        isLoading={false}
      />,
    );
    expect(screen.getByText('Day left')).toBeDefined();
    expect(screen.queryByText('Days left')).toBeNull();
  });
});
