/**
 * Pins the `onPeriodChange` prop thread from
 * src/components/banking/BankingIntelligenceDashboard.tsx down to
 * `CashFlowTab`, on the default-active Cash Flow tab.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { BankingIntelligenceDashboard } from '@/components/banking/BankingIntelligenceDashboard';
import type { Period } from '@/components/PeriodSelector';

vi.mock('@/components/banking/CashFlowTab', () => ({
  CashFlowTab: ({ onPeriodChange }: { onPeriodChange: (period: Period) => void }) =>
    React.createElement(
      'button',
      { onClick: () => onPeriodChange({ type: 'custom', from: new Date(), to: new Date(), label: 'Custom' }) },
      'cashflow-tab-stub'
    ),
}));

vi.mock('@/components/banking/FinancialPulseHero', () => ({ FinancialPulseHero: () => null }));
vi.mock('@/components/banking/RevenueHealthTab', () => ({ RevenueHealthTab: () => null }));
vi.mock('@/components/banking/SpendingAnalysisTab', () => ({ SpendingAnalysisTab: () => null }));
vi.mock('@/components/banking/LiquidityTab', () => ({ LiquidityTab: () => null }));
vi.mock('@/components/banking/PredictionsTab', () => ({ PredictionsTab: () => null }));

const period: Period = { type: 'month', from: new Date(2026, 0, 1), to: new Date(2026, 0, 31), label: 'January' };

// The dashboard reads and writes the URL tab param, so it needs a router.
function renderDashboard(ui: React.ReactElement, initialEntries: string[] = ['/']) {
  return render(<MemoryRouter initialEntries={initialEntries}>{ui}</MemoryRouter>);
}

describe('BankingIntelligenceDashboard cash flow thread', () => {
  it('forwards onPeriodChange to CashFlowTab', () => {
    const onPeriodChange = vi.fn();
    renderDashboard(
      <BankingIntelligenceDashboard
        selectedPeriod={period}
        selectedBankAccount="all"
        onPeriodChange={onPeriodChange}
      />
    );
    screen.getByText('cashflow-tab-stub').click();
    expect(onPeriodChange).toHaveBeenCalledTimes(1);
  });

  it('restores the active tab from the URL tab param', () => {
    renderDashboard(
      <BankingIntelligenceDashboard
        selectedPeriod={period}
        selectedBankAccount="all"
        onPeriodChange={vi.fn()}
      />,
      ['/?tab=revenue']
    );
    expect(screen.getByRole('tab', { name: /revenue/i })).toHaveAttribute('aria-selected', 'true');
  });
});
