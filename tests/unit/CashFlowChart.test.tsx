/**
 * Behavioral tests for src/components/banking/cashflow/CashFlowChart.tsx
 *
 * Pins the three chart modes (Flow / By category / In vs out), the
 * cashflow and interval controls, and the accessible name/caption pair
 * each mode must carry.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { CashFlowChart } from '@/components/banking/cashflow/CashFlowChart';
import type { CashFlowRow, CashFlowPeriod } from '@/lib/cashflowInsights';

vi.mock('@/components/ui/select', () => ({
  Select: ({
    name,
    value,
    onValueChange,
    children,
  }: {
    name: string;
    value: string;
    onValueChange: (value: string) => void;
    children: React.ReactNode;
  }) =>
    React.createElement(
      'select',
      {
        'data-testid': name,
        value,
        onChange: (e: React.ChangeEvent<HTMLSelectElement>) => onValueChange(e.target.value),
      },
      children,
    ),
  SelectContent: ({ children }: { children: React.ReactNode }) => children,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) =>
    React.createElement('option', { value }, children),
  SelectTrigger: () => null,
  SelectValue: () => null,
}));

const period: CashFlowPeriod = { from: new Date(2026, 5, 1), to: new Date(2026, 5, 30) };

const rows: CashFlowRow[] = [
  {
    transaction_date: '2026-06-03',
    amount: 5000,
    is_transfer: false,
    normalized_payee: 'Client A',
    merchant_name: null,
    description: null,
    category: { id: 'c1', name: 'Sales', account_type: 'revenue', account_subtype: null },
  },
  {
    transaction_date: '2026-06-05',
    amount: -2000,
    is_transfer: false,
    normalized_payee: 'Vendor B',
    merchant_name: null,
    description: null,
    category: { id: 'c2', name: 'Supplies', account_type: 'expense', account_subtype: null },
  },
  {
    transaction_date: '2026-06-10',
    amount: -1500,
    is_transfer: true,
    normalized_payee: 'Savings sweep',
    merchant_name: null,
    description: null,
    category: null,
  },
];

// The chart reads and writes URL search params, so it needs a router.
function renderChart(ui: React.ReactElement, initialEntries: string[] = ['/']) {
  return render(<MemoryRouter initialEntries={initialEntries}>{ui}</MemoryRouter>);
}

describe('CashFlowChart', () => {
  it('defaults to Flow mode: role="img", aria-label mentions Flow, interval select hidden', () => {
    renderChart(<CashFlowChart rows={rows} period={period} />);

    const chart = screen.getByRole('img', { name: /flow/i });
    expect(chart).toBeInTheDocument();
    expect(screen.queryByTestId('interval')).not.toBeInTheDocument();
  });

  it('wires the visible caption to the chart via aria-describedby', () => {
    renderChart(<CashFlowChart rows={rows} period={period} />);

    const chart = screen.getByRole('img', { name: /flow/i });
    const describedById = chart.getAttribute('aria-describedby');
    expect(describedById).toBeTruthy();

    const caption = document.getElementById(describedById!);
    expect(caption).not.toBeNull();
    expect(caption).toBeVisible();
    expect(caption!.textContent).toMatch(/money in/i);
    expect(caption!.textContent).toMatch(/money out/i);
    // The default filter excludes the transfer row, so money out is $2,000.
    expect(caption!.textContent).toMatch(/\$5,000/);
    expect(caption!.textContent).toMatch(/\$2,000/);
  });

  it('switches to By category mode: shows the interval select and updates the aria-label', () => {
    renderChart(<CashFlowChart rows={rows} period={period} />);

    fireEvent.click(screen.getByText('By category'));

    expect(screen.getByRole('img', { name: /category/i })).toBeInTheDocument();
    expect(screen.getByTestId('interval')).toBeInTheDocument();
  });

  it('switches to In vs out mode: updates the aria-label and keeps the interval select shown', () => {
    renderChart(<CashFlowChart rows={rows} period={period} />);

    fireEvent.click(screen.getByText('In vs out'));

    expect(screen.getByRole('img', { name: /in vs out/i })).toBeInTheDocument();
    expect(screen.getByTestId('interval')).toBeInTheDocument();
  });

  it('going back to Flow mode hides the interval select again', () => {
    renderChart(<CashFlowChart rows={rows} period={period} />);

    fireEvent.click(screen.getByText('By category'));
    expect(screen.getByTestId('interval')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Flow'));
    expect(screen.queryByTestId('interval')).not.toBeInTheDocument();
  });

  it('excludes transfer rows by default and adds them back when set to All cashflow', () => {
    renderChart(<CashFlowChart rows={rows} period={period} />);

    const chart = screen.getByRole('img', { name: /flow/i });
    const describedById = chart.getAttribute('aria-describedby')!;
    // The default filter is 'exclude-transfers': the $1,500 transfer is out.
    expect(document.getElementById(describedById)!.textContent).toMatch(/\$2,000/);

    fireEvent.change(screen.getByTestId('cashflow-filter'), { target: { value: 'all' } });

    const captionAfter = document.getElementById(chart.getAttribute('aria-describedby')!)!;
    expect(captionAfter.textContent).not.toMatch(/\$2,000/);
    expect(captionAfter.textContent).toMatch(/\$3,500/);
  });

  it('renders an empty flow gracefully for zero rows', () => {
    renderChart(<CashFlowChart rows={[]} period={period} />);

    expect(screen.getByRole('img', { name: /flow/i })).toBeInTheDocument();
  });

  it('restores the view from the URL view param', () => {
    renderChart(<CashFlowChart rows={rows} period={period} />, ['/?view=inout']);

    expect(screen.getByRole('img', { name: /in vs out/i })).toBeInTheDocument();
  });

  it('restores the interval from the URL interval param', () => {
    renderChart(<CashFlowChart rows={rows} period={period} />, ['/?view=category&interval=month']);

    expect(screen.getByRole('img', { name: /category/i })).toBeInTheDocument();
    expect(screen.getByTestId('interval')).toHaveValue('month');
  });

  it('falls back to Flow mode for an unknown view param', () => {
    renderChart(<CashFlowChart rows={rows} period={period} />, ['/?view=bogus']);

    expect(screen.getByRole('img', { name: /flow/i })).toBeInTheDocument();
  });
});
