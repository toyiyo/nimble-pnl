import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MoneyBreakdownTable } from '@/components/banking/cashflow/MoneyBreakdownTable';
import type { BreakdownRow } from '@/lib/cashflowInsights';

const sourceRows: BreakdownRow[] = [
  { label: 'Square Payouts', amount: 9000, pctOfTotal: 75 },
  { label: 'Remaining', amount: 3000, pctOfTotal: 25 },
];

const categoryRows: BreakdownRow[] = [
  { label: 'Sales', amount: 10000, pctOfTotal: 83 },
  { label: 'Remaining', amount: 2000, pctOfTotal: 17 },
];

describe('MoneyBreakdownTable', () => {
  it('shows the title and the formatted total', () => {
    render(
      <MoneyBreakdownTable
        title="Money in"
        total={12000}
        primaryTabLabel="Source"
        primaryRows={sourceRows}
        categoryRows={categoryRows}
      />,
    );

    expect(screen.getByText('Money in')).toBeInTheDocument();
    expect(screen.getByText('$12,000')).toBeInTheDocument();
  });

  it('shows the Source and Category underline tabs, Source active by default', () => {
    render(
      <MoneyBreakdownTable
        title="Money in"
        total={12000}
        primaryTabLabel="Source"
        primaryRows={sourceRows}
        categoryRows={categoryRows}
      />,
    );

    const sourceTab = screen.getByRole('tab', { name: 'Source' });
    const categoryTab = screen.getByRole('tab', { name: 'Category' });
    expect(sourceTab).toHaveAttribute('aria-selected', 'true');
    expect(categoryTab).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByText('Square Payouts')).toBeInTheDocument();
  });

  it('uses Recipient as the primary tab label for money out', () => {
    render(
      <MoneyBreakdownTable
        title="Money out"
        total={-11000}
        primaryTabLabel="Recipient"
        primaryRows={sourceRows}
        categoryRows={categoryRows}
      />,
    );

    expect(screen.getByRole('tab', { name: 'Recipient' })).toBeInTheDocument();
  });

  it('switches to the category rows when the Category tab is clicked', () => {
    render(
      <MoneyBreakdownTable
        title="Money in"
        total={12000}
        primaryTabLabel="Source"
        primaryRows={sourceRows}
        categoryRows={categoryRows}
      />,
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Category' }));

    expect(screen.getByRole('tab', { name: 'Category' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Sales')).toBeInTheDocument();
    expect(screen.queryByText('Square Payouts')).not.toBeInTheDocument();
  });

  it('shows each row with its percent, a percent-of-total track, and a right-aligned amount', () => {
    render(
      <MoneyBreakdownTable
        title="Money in"
        total={12000}
        primaryTabLabel="Source"
        primaryRows={sourceRows}
        categoryRows={categoryRows}
      />,
    );

    expect(screen.getByText('75%')).toBeInTheDocument();
    expect(screen.getByText('$9,000')).toBeInTheDocument();
    const amount = screen.getByText('$9,000');
    expect(amount.className).toContain('text-right');

    const track = screen.getByTestId('breakdown-track-Square Payouts');
    expect(track).toHaveStyle({ width: '75%' });
  });

  it('shows a Remaining row for the folded rest', () => {
    render(
      <MoneyBreakdownTable
        title="Money in"
        total={12000}
        primaryTabLabel="Source"
        primaryRows={sourceRows}
        categoryRows={categoryRows}
      />,
    );

    expect(screen.getByText('Remaining')).toBeInTheDocument();
    expect(screen.getByText('25%')).toBeInTheDocument();
  });

  it('shows out-of-money amounts as a positive, formatted currency', () => {
    const outRows: BreakdownRow[] = [{ label: 'Rent Co', amount: -5000, pctOfTotal: 100 }];
    render(
      <MoneyBreakdownTable
        title="Money out"
        total={-5000}
        primaryTabLabel="Recipient"
        primaryRows={outRows}
        categoryRows={outRows}
      />,
    );

    // One for the header total, one for the row amount.
    expect(screen.getAllByText('$5,000')).toHaveLength(2);
    const rowAmount = screen.getAllByText('$5,000').find((el) => el.className.includes('text-right'));
    expect(rowAmount).toBeDefined();
  });
});
