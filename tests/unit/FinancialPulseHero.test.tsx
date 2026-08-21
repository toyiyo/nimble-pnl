import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

const hookMock = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/useCashFlowMetrics', () => ({
  useCashFlowMetrics: hookMock,
}));

import { FinancialPulseHero } from '@/components/banking/FinancialPulseHero';

const selectedPeriod = {
  from: new Date('2026-08-01'),
  to: new Date('2026-08-07'),
  label: 'This week',
} as unknown as import('@/components/PeriodSelector').Period;

describe('FinancialPulseHero', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows a muted error line and no metric grid on hook error', () => {
    hookMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('RPC failed'),
    });

    render(<FinancialPulseHero selectedPeriod={selectedPeriod} selectedBankAccount="all" />);

    expect(screen.getByText('Cannot load cash flow data')).toBeInTheDocument();
    expect(screen.queryByText('Net Cash Flow')).not.toBeInTheDocument();
    expect(screen.queryByText('Volatility')).not.toBeInTheDocument();
  });

  it('shows the period net and period label, not a fixed 7-day window', () => {
    vi.useFakeTimers();

    hookMock.mockReturnValue({
      data: {
        totalInflows: 10000,
        totalOutflows: 3081,
        netCashFlow: 6919,
        avgDailyCashFlow: 691.9,
        volatility: 100,
        trend: [],
        trailingTrendPercentage: 5,
      },
      isLoading: false,
      error: null,
    });

    const quarterPeriod = {
      from: new Date('2026-06-01'),
      to: new Date('2026-06-10'),
      label: 'This Quarter',
    } as unknown as import('@/components/PeriodSelector').Period;

    render(<FinancialPulseHero selectedPeriod={quarterPeriod} selectedBankAccount="all" />);

    act(() => {
      vi.advanceTimersByTime(1100);
    });

    expect(screen.getByText('$6919')).toBeInTheDocument();
    expect(screen.getAllByText('This Quarter').length).toBeGreaterThan(0);
    expect(screen.queryByText('(7 days)')).not.toBeInTheDocument();

    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });
});
