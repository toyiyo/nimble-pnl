import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TipDistribution } from '../../src/components/tips/TipDistribution';
import type { TipSplitWithItems } from '../../src/hooks/useTipSplits';
import type { TipPayout } from '../../src/hooks/useTipPayouts';

const employee1 = '11111111-1111-1111-1111-111111111111';
const employee2 = '22222222-2222-2222-2222-222222222222';

/** Minimal split builder — only the fields the component/aggregation read. */
function makeSplit(overrides: Partial<TipSplitWithItems>): TipSplitWithItems {
  return {
    id: 'split-1',
    restaurant_id: 'restaurant-1',
    split_date: '2026-07-06',
    total_amount: 0,
    status: 'approved',
    share_method: null,
    tip_source: null,
    notes: null,
    created_by: null,
    approved_by: null,
    approved_at: null,
    created_at: '2026-07-06T00:00:00Z',
    updated_at: '2026-07-06T00:00:00Z',
    items: [],
    ...overrides,
  };
}

function makePayout(overrides: Partial<TipPayout>): TipPayout {
  return {
    id: 'payout-1',
    restaurant_id: 'restaurant-1',
    employee_id: employee1,
    payout_date: '2026-07-06',
    amount: 0,
    tip_split_id: null,
    notes: null,
    paid_by: null,
    created_at: '2026-07-06T00:00:00Z',
    updated_at: '2026-07-06T00:00:00Z',
    ...overrides,
  };
}

describe('TipDistribution', () => {
  it('renders row-shaped skeletons while loading, not the table', () => {
    render(
      <TipDistribution
        splits={undefined}
        payouts={[]}
        isLoading
        isError={false}
        onNavigateToOverview={vi.fn()}
      />,
    );
    expect(screen.getByTestId('tip-distribution-loading')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: /tip distribution/i })).not.toBeInTheDocument();
  });

  it('shows an error message and does not render $0/nobody data on error', () => {
    render(
      <TipDistribution
        splits={undefined}
        payouts={[]}
        isLoading={false}
        isError
        onNavigateToOverview={vi.fn()}
      />,
    );
    expect(screen.getByTestId('tip-distribution-error')).toBeInTheDocument();
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: /tip distribution/i })).not.toBeInTheDocument();
  });

  it('shows an empty state with a keyboard-operable CTA when there are no finalized allocations', async () => {
    const user = userEvent.setup();
    const onNavigateToOverview = vi.fn();
    render(
      <TipDistribution
        splits={[]}
        payouts={[]}
        isLoading={false}
        isError={false}
        onNavigateToOverview={onNavigateToOverview}
      />,
    );
    expect(screen.getByText(/no finalized tips/i)).toBeInTheDocument();
    const cta = screen.getByRole('button', { name: /overview/i });
    await user.click(cta);
    expect(onNavigateToOverview).toHaveBeenCalledTimes(1);
  });

  it('excludes draft splits from the empty-state check', () => {
    render(
      <TipDistribution
        splits={[
          makeSplit({
            status: 'draft',
            items: [
              {
                id: 'item-1',
                tip_split_id: 'split-1',
                employee_id: employee1,
                amount: 5000,
                hours_worked: 5,
                role: 'Server',
                role_weight: null,
                employee: { name: 'Maria Santos', position: 'Server' },
              } as TipSplitWithItems['items'][number],
            ],
          }),
        ]}
        payouts={[]}
        isLoading={false}
        isError={false}
        onNavigateToOverview={vi.fn()}
      />,
    );
    expect(screen.getByText(/no finalized tips/i)).toBeInTheDocument();
  });

  it('renders the summary row and per-employee rows with share bar + status badge for finalized data', () => {
    const splits: TipSplitWithItems[] = [
      makeSplit({
        id: 'split-1',
        status: 'approved',
        items: [
          {
            id: 'item-1',
            tip_split_id: 'split-1',
            employee_id: employee1,
            amount: 8000,
            hours_worked: 10,
            role: 'Server',
            role_weight: null,
            employee: { name: 'Maria Santos', position: 'Server' },
          } as TipSplitWithItems['items'][number],
          {
            id: 'item-2',
            tip_split_id: 'split-1',
            employee_id: employee2,
            amount: 2000,
            hours_worked: 4,
            role: 'Busser',
            role_weight: null,
            employee: { name: 'Alex Kim', position: 'Busser' },
          } as TipSplitWithItems['items'][number],
        ],
      }),
    ];
    const payouts: TipPayout[] = [makePayout({ employee_id: employee1, amount: 8000 })];

    render(
      <TipDistribution
        splits={splits}
        payouts={payouts}
        isLoading={false}
        isError={false}
        onNavigateToOverview={vi.fn()}
      />,
    );

    // Summary row (scoped — an individual row can coincidentally show the
    // same formatted amount as a summary total).
    const summary = screen.getByTestId('tip-distribution-summary');
    expect(within(summary).getByText('$100.00')).toBeInTheDocument(); // total distributed
    expect(within(summary).getByText('$80.00')).toBeInTheDocument(); // total paid

    // Per-employee list is a semantic list
    const list = screen.getByRole('list', { name: /tip distribution/i });
    expect(list).toBeInTheDocument();

    // Maria: paid in full, 80% share
    const mariaRow = screen.getByLabelText(
      /Maria Santos, Server, earned \$80\.00, 80(\.0)?% of pool, paid/i,
    );
    expect(mariaRow).toBeInTheDocument();

    // Alex: nothing paid yet -> unpaid badge
    const alexRow = screen.getByLabelText(
      /Alex Kim, Busser, earned \$20\.00, 20(\.0)?% of pool, unpaid/i,
    );
    expect(alexRow).toBeInTheDocument();
    expect(within(alexRow).getByText(/^unpaid$/i)).toBeInTheDocument();
  });

  it('shows a partial badge with paid/earned amounts when only part of the balance is paid', () => {
    const splits: TipSplitWithItems[] = [
      makeSplit({
        id: 'split-1',
        status: 'archived',
        items: [
          {
            id: 'item-1',
            tip_split_id: 'split-1',
            employee_id: employee1,
            amount: 5000,
            hours_worked: 6,
            role: 'Server',
            role_weight: null,
            employee: { name: 'Maria Santos', position: 'Server' },
          } as TipSplitWithItems['items'][number],
        ],
      }),
    ];
    const payouts: TipPayout[] = [makePayout({ employee_id: employee1, amount: 1000 })];

    render(
      <TipDistribution
        splits={splits}
        payouts={payouts}
        isLoading={false}
        isError={false}
        onNavigateToOverview={vi.fn()}
      />,
    );

    expect(screen.getByText('$10.00 / $50.00')).toBeInTheDocument();
  });
});
