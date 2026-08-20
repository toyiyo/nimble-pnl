import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CashFlowHeadline } from '@/components/banking/cashflow/CashFlowHeadline';
import type { CashFlowTotals } from '@/lib/cashflowInsights';

describe('CashFlowHeadline', () => {
  it('shows Net cashflow, Money in, and Money out', () => {
    const totals: CashFlowTotals = { moneyIn: 12000, moneyOut: -8000, net: 4000 };
    render(<CashFlowHeadline totals={totals} />);

    expect(screen.getByText('Net cashflow')).toBeInTheDocument();
    expect(screen.getByText('$4,000')).toBeInTheDocument();
    expect(screen.getByText('Money in')).toBeInTheDocument();
    expect(screen.getByText('$12,000')).toBeInTheDocument();
    expect(screen.getByText('Money out')).toBeInTheDocument();
    expect(screen.getByText('$8,000')).toBeInTheDocument();
  });

  it('renders a positive net without the destructive class', () => {
    const totals: CashFlowTotals = { moneyIn: 12000, moneyOut: -8000, net: 4000 };
    render(<CashFlowHeadline totals={totals} />);

    const net = screen.getByText('$4,000');
    expect(net.className).not.toContain('text-destructive');
    expect(net.className).toContain('text-[28px]');
    expect(net.className).toContain('font-semibold');
    expect(net.className).toContain('tracking-tight');
  });

  it('renders a negative net with the destructive class', () => {
    const totals: CashFlowTotals = { moneyIn: 3000, moneyOut: -8000, net: -5000 };
    render(<CashFlowHeadline totals={totals} />);

    const net = screen.getByText('-$5,000');
    expect(net.className).toContain('text-destructive');
  });
});
