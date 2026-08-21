import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

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
});
