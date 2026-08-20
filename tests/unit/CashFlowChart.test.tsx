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
    category: { id: 'c1', name: 'Sales' },
  },
  {
    transaction_date: '2026-06-05',
    amount: -2000,
    is_transfer: false,
    normalized_payee: 'Vendor B',
    merchant_name: null,
    description: null,
    category: { id: 'c2', name: 'Supplies' },
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

describe('CashFlowChart', () => {
  it('defaults to Flow mode: role="img", aria-label mentions Flow, interval select hidden', () => {
    render(<CashFlowChart rows={rows} period={period} />);

    const chart = screen.getByRole('img', { name: /flow/i });
    expect(chart).toBeInTheDocument();
    expect(screen.queryByTestId('interval')).not.toBeInTheDocument();
  });

  it('wires the visible caption to the chart via aria-describedby', () => {
    render(<CashFlowChart rows={rows} period={period} />);

    const chart = screen.getByRole('img', { name: /flow/i });
    const describedById = chart.getAttribute('aria-describedby');
    expect(describedById).toBeTruthy();

    const caption = document.getElementById(describedById!);
    expect(caption).not.toBeNull();
    expect(caption).toBeVisible();
    expect(caption!.textContent).toMatch(/money in/i);
    expect(caption!.textContent).toMatch(/money out/i);
    expect(caption!.textContent).toMatch(/\$5,000/);
    expect(caption!.textContent).toMatch(/\$3,500/);
  });

  it('switches to By category mode: shows the interval select and updates the aria-label', () => {
    render(<CashFlowChart rows={rows} period={period} />);

    fireEvent.click(screen.getByText('By category'));

    expect(screen.getByRole('img', { name: /category/i })).toBeInTheDocument();
    expect(screen.getByTestId('interval')).toBeInTheDocument();
  });

  it('switches to In vs out mode: updates the aria-label and hides the interval select is still shown', () => {
    render(<CashFlowChart rows={rows} period={period} />);

    fireEvent.click(screen.getByText('In vs out'));

    expect(screen.getByRole('img', { name: /in vs out/i })).toBeInTheDocument();
    expect(screen.getByTestId('interval')).toBeInTheDocument();
  });

  it('going back to Flow mode hides the interval select again', () => {
    render(<CashFlowChart rows={rows} period={period} />);

    fireEvent.click(screen.getByText('By category'));
    expect(screen.getByTestId('interval')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Flow'));
    expect(screen.queryByTestId('interval')).not.toBeInTheDocument();
  });

  it('the cashflow filter select excludes transfer rows from the caption totals when set to Exclude transfers', () => {
    render(<CashFlowChart rows={rows} period={period} />);

    const chart = screen.getByRole('img', { name: /flow/i });
    const describedById = chart.getAttribute('aria-describedby')!;
    expect(document.getElementById(describedById)!.textContent).toMatch(/\$3,500/);

    fireEvent.change(screen.getByTestId('cashflow-filter'), { target: { value: 'exclude-transfers' } });

    const captionAfter = document.getElementById(chart.getAttribute('aria-describedby')!)!;
    expect(captionAfter.textContent).not.toMatch(/\$3,500/);
    expect(captionAfter.textContent).toMatch(/\$2,000/);
  });

  it('renders an empty flow gracefully for zero rows', () => {
    render(<CashFlowChart rows={[]} period={period} />);

    expect(screen.getByRole('img', { name: /flow/i })).toBeInTheDocument();
  });
});
