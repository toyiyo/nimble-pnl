import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { DashboardTodayCard } from '@/components/dashboard/DashboardTodayCard';

const baseProps = {
  todaySales: 4880,
  profitMargin: 12.5,
  availableCash: 18000,
  cashRunway: 45,
  todayFoodCost: 1200,
  todayLaborCost: 1400,
  monthToDateSales: 62000,
  primeCostPercentage: 53.3,
  breakEvenData: {
    dailyBreakEven: 3640,
    todayStatus: 'above' as const,
    todayDelta: 1240,
    daysAbove: 9,
    daysBelow: 5,
    historyDays: 14,
  },
  breakEvenLoading: false,
};

describe('DashboardTodayCard', () => {
  it('shows the visible headline sentence for a day above break-even', () => {
    render(<DashboardTodayCard {...baseProps} />);
    expect(screen.getByText('Today is $1,240 above break-even.')).toBeInTheDocument();
  });

  it('shows the headline for a day below break-even', () => {
    render(
      <DashboardTodayCard
        {...baseProps}
        breakEvenData={{ ...baseProps.breakEvenData, todayStatus: 'below', todayDelta: -860 }}
      />
    );
    expect(screen.getByText('You need $860 more today to break even.')).toBeInTheDocument();
  });

  it('shows the headline when today is at break-even', () => {
    render(
      <DashboardTodayCard
        {...baseProps}
        breakEvenData={{ ...baseProps.breakEvenData, todayStatus: 'at', todayDelta: 0 }}
      />
    );
    expect(screen.getByText('Today is at break-even.')).toBeInTheDocument();
  });

  it('shows a progressbar with the sales-to-break-even value', () => {
    render(<DashboardTodayCard {...baseProps} />);
    const bar = screen.getByRole('progressbar', { name: "Progress to today's break-even" });
    expect(bar).toHaveAttribute('value', '100');
    expect(bar).toHaveAttribute('max', '100');
  });

  it('does not show a below-break-even headline in red while the day is open', () => {
    render(
      <DashboardTodayCard
        {...baseProps}
        breakEvenData={{ ...baseProps.breakEvenData, todayStatus: 'below', todayDelta: -860 }}
      />
    );
    const headline = screen.getByText('You need $860 more today to break even.');
    expect(headline.className).not.toContain('text-destructive');
  });

  it('shows skeletons, not fake values, while cash and runway load', () => {
    render(<DashboardTodayCard {...baseProps} cashLoading runwayLoading />);
    expect(screen.queryByText('$18,000')).not.toBeInTheDocument();
    expect(screen.queryByText('45d')).not.toBeInTheDocument();
  });

  it('shows the four core values', () => {
    render(<DashboardTodayCard {...baseProps} />);
    expect(screen.getByText('$4,880')).toBeInTheDocument();
    expect(screen.getByText('12.5%')).toBeInTheDocument();
    expect(screen.getByText('$1,200')).toBeInTheDocument();
    expect(screen.getByText('$1,400')).toBeInTheDocument();
  });

  it('shows a KPI list with cash, runway, prime cost and month to date', () => {
    render(<DashboardTodayCard {...baseProps} />);
    const dl = document.querySelector('dl');
    expect(dl).toBeInTheDocument();
    expect(screen.getByText('Cash in bank')).toBeInTheDocument();
    expect(screen.getByText('Runway')).toBeInTheDocument();
    expect(screen.getByText('45d')).toBeInTheDocument();
    expect(screen.getByText('Prime cost')).toBeInTheDocument();
    expect(screen.getByText('Month to date')).toBeInTheDocument();
    expect(screen.getByText('$62,000')).toBeInTheDocument();
  });

  it('shows the last 14 days above/below line', () => {
    render(<DashboardTodayCard {...baseProps} />);
    expect(screen.getByText(/Last 14d:/)).toBeInTheDocument();
  });

  it('shows a skeleton while breakEvenLoading is true', () => {
    render(<DashboardTodayCard {...baseProps} breakEvenLoading />);
    expect(document.querySelector('.animate-pulse')).toBeInTheDocument();
  });

  it('shows the break-even error text when breakEvenData is an error', () => {
    render(<DashboardTodayCard {...baseProps} breakEvenData={null} breakEvenError />);
    expect(screen.getByText('Break-even is not available right now.')).toBeInTheDocument();
  });

  it('does not show a fabricated $0 for month to date while break-even is loading', () => {
    render(<DashboardTodayCard {...baseProps} breakEvenLoading monthToDateSales={0} />);
    expect(screen.getByText('Month to date')).toBeInTheDocument();
    expect(screen.queryByText('$0')).not.toBeInTheDocument();
  });

  it('does not show a fabricated $0 for month to date on a break-even error', () => {
    render(
      <DashboardTodayCard {...baseProps} breakEvenData={null} breakEvenError monthToDateSales={0} />
    );
    expect(screen.getByText('Month to date')).toBeInTheDocument();
    expect(screen.queryByText('$0')).not.toBeInTheDocument();
  });

  it('shows the "Set operating costs" link when dailyBreakEven is 0 on a truthy breakEvenData object', () => {
    render(
      <MemoryRouter>
        <DashboardTodayCard
          {...baseProps}
          breakEvenData={{ ...baseProps.breakEvenData, dailyBreakEven: 0, todayStatus: 'above', todayDelta: 0 }}
        />
      </MemoryRouter>
    );
    expect(screen.getByText('Set your operating costs to see break-even.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Set operating costs' })).toBeInTheDocument();
  });
});
