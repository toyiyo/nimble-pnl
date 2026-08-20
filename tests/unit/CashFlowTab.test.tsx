/**
 * Behavioral tests for src/components/banking/CashFlowTab.tsx
 *
 * Pins the single-hook state gate (loading / error / empty / truncated /
 * success) and the prop thread from CashFlowTab down to each cashflow
 * child component, plus the onPeriodChange thread up from TimelineBrush.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { CashFlowTab } from '@/components/banking/CashFlowTab';
import type { Period } from '@/components/PeriodSelector';
import type { CashFlowInsightsData } from '@/hooks/useCashFlowInsights';

const mockUseCashFlowInsights = vi.hoisted(() => vi.fn());
const mockRefetch = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/useCashFlowInsights', () => ({
  useCashFlowInsights: mockUseCashFlowInsights,
}));

vi.mock('@/components/banking/cashflow/TimelineBrush', () => ({
  TimelineBrush: ({ onPeriodChange }: { onPeriodChange: (period: Period) => void }) =>
    React.createElement(
      'button',
      {
        onClick: () =>
          onPeriodChange({ type: 'custom', from: new Date(2026, 0, 1), to: new Date(2026, 0, 31), label: 'Custom' }),
      },
      'commit-brush'
    ),
}));

vi.mock('@/components/banking/cashflow/CashFlowHeadline', () => ({
  CashFlowHeadline: ({ totals }: { totals: { net: number } }) =>
    React.createElement('div', { 'data-testid': 'headline' }, `net:${totals.net}`),
}));

vi.mock('@/components/banking/cashflow/CashFlowNarrative', () => ({
  CashFlowNarrative: ({ insights }: { insights: unknown[] }) =>
    React.createElement('div', { 'data-testid': 'narrative' }, `insights:${insights.length}`),
}));

vi.mock('@/components/banking/cashflow/CashFlowChart', () => ({
  CashFlowChart: ({ rows }: { rows: unknown[] }) =>
    React.createElement('div', { 'data-testid': 'chart' }, `rows:${rows.length}`),
}));

vi.mock('@/components/banking/cashflow/MoneyBreakdownTable', () => ({
  MoneyBreakdownTable: ({ title, total, primaryTabLabel }: { title: string; total: number; primaryTabLabel: string }) =>
    React.createElement('div', { 'data-testid': `table-${title}` }, `${title}:${total}:${primaryTabLabel}`),
}));

const period: Period = { type: 'month', from: new Date(2026, 0, 1), to: new Date(2026, 0, 31), label: 'January' };

const EMPTY_DATA: CashFlowInsightsData = {
  rows: [],
  aggregates: { totals: { moneyIn: 0, moneyOut: 0, net: 0 }, series: [] },
  sources: [],
  recipients: [],
  categoryBreakdownIn: [],
  categoryBreakdownOut: [],
  insights: [],
  truncated: false,
};

function dataWithRows(overrides: Partial<CashFlowInsightsData> = {}): CashFlowInsightsData {
  return {
    ...EMPTY_DATA,
    rows: [
      {
        transaction_date: '2026-01-05',
        amount: 5000,
        is_transfer: false,
        normalized_payee: 'Client A',
        merchant_name: null,
        description: null,
        category: null,
      } as never,
    ],
    aggregates: { totals: { moneyIn: 5000, moneyOut: 2000, net: 3000 }, series: [] },
    sources: [{ name: 'Client A', amount: 5000, pctOfTotal: 1 } as never],
    recipients: [{ name: 'Vendor B', amount: 2000, pctOfTotal: 1 } as never],
    insights: [{ id: 'revenue-change', title: 'Revenue increased', body: 'Body' } as never],
    ...overrides,
  };
}

function renderTab(onPeriodChange = vi.fn()) {
  return { onPeriodChange, ...render(
    <CashFlowTab selectedPeriod={period} selectedBankAccount="all" onPeriodChange={onPeriodChange} />
  ) };
}

beforeEach(() => {
  mockUseCashFlowInsights.mockReset();
  mockRefetch.mockReset();
});

describe('CashFlowTab', () => {
  it('shows a loading affordance and no data while the hook is loading', () => {
    mockUseCashFlowInsights.mockReturnValue({ data: undefined, isLoading: true, error: null, refetch: mockRefetch });
    renderTab();
    expect(screen.getByRole('status', { name: /loading cash flow/i })).toBeInTheDocument();
    expect(screen.queryByTestId('headline')).not.toBeInTheDocument();
  });

  it('shows one retry card on error and calls refetch on click', () => {
    mockUseCashFlowInsights.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('network down'),
      refetch: mockRefetch,
    });
    renderTab();
    expect(screen.getByText('network down')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  it('shows one empty state when the period has zero rows', () => {
    mockUseCashFlowInsights.mockReturnValue({ data: EMPTY_DATA, isLoading: false, error: null, refetch: mockRefetch });
    renderTab();
    expect(screen.getByText(/no transactions/i)).toBeInTheDocument();
    expect(screen.queryByTestId('headline')).not.toBeInTheDocument();
  });

  it('shows one notice line when the hook reports truncated', () => {
    mockUseCashFlowInsights.mockReturnValue({
      data: dataWithRows({ truncated: true }),
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    });
    renderTab();
    expect(screen.getByText(/more transactions than we could load/i)).toBeInTheDocument();
  });

  it('does not show the truncated notice when the flag is false', () => {
    mockUseCashFlowInsights.mockReturnValue({
      data: dataWithRows({ truncated: false }),
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    });
    renderTab();
    expect(screen.queryByText(/more transactions than we could load/i)).not.toBeInTheDocument();
  });

  it('threads the hook data down to each child on success', () => {
    mockUseCashFlowInsights.mockReturnValue({
      data: dataWithRows(),
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    });
    renderTab();
    expect(screen.getByTestId('headline')).toHaveTextContent('net:3000');
    expect(screen.getByTestId('narrative')).toHaveTextContent('insights:1');
    expect(screen.getByTestId('chart')).toHaveTextContent('rows:1');
    expect(screen.getByTestId('table-Money in')).toHaveTextContent('Money in:5000:Source');
    expect(screen.getByTestId('table-Money out')).toHaveTextContent('Money out:2000:Recipient');
  });

  it('forwards a TimelineBrush commit to the onPeriodChange prop', () => {
    mockUseCashFlowInsights.mockReturnValue({
      data: dataWithRows(),
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    });
    const { onPeriodChange } = renderTab();
    fireEvent.click(screen.getByText('commit-brush'));
    expect(onPeriodChange).toHaveBeenCalledTimes(1);
    expect(onPeriodChange).toHaveBeenCalledWith(expect.objectContaining({ type: 'custom' }));
  });
});
