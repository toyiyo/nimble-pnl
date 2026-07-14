import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TipTopEarners } from '../../src/components/tips/TipTopEarners';
import type { TipSplitWithItems } from '../../src/hooks/useTipSplits';

const employeeIds = [
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  '33333333-3333-3333-3333-333333333333',
  '44444444-4444-4444-4444-444444444444',
];

/** Minimal split builder — only the fields the aggregation reads. */
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

function makeItem(overrides: Partial<TipSplitWithItems['items'][number]>): TipSplitWithItems['items'][number] {
  return {
    id: 'item-1',
    tip_split_id: 'split-1',
    employee_id: employeeIds[0],
    amount: 1000,
    hours_worked: 5,
    role: 'Server',
    role_weight: null,
    employee: { name: 'Employee', position: 'Server' },
    ...overrides,
  } as TipSplitWithItems['items'][number];
}

describe('TipTopEarners', () => {
  it('renders only the top 3 employees by earnedCents, descending, excluding a lower 4th earner', () => {
    const splits: TipSplitWithItems[] = [
      makeSplit({
        id: 'split-1',
        status: 'approved',
        items: [
          makeItem({
            id: 'item-1',
            employee_id: employeeIds[0],
            amount: 9000,
            employee: { name: 'Top Earner', position: 'Server' },
          }),
          makeItem({
            id: 'item-2',
            employee_id: employeeIds[1],
            amount: 7000,
            employee: { name: 'Second Earner', position: 'Server' },
          }),
          makeItem({
            id: 'item-3',
            employee_id: employeeIds[2],
            amount: 5000,
            employee: { name: 'Third Earner', position: 'Bartender' },
          }),
          makeItem({
            id: 'item-4',
            employee_id: employeeIds[3],
            amount: 1000,
            employee: { name: 'Fourth Earner', position: 'Busser' },
          }),
        ],
      }),
    ];

    render(<TipTopEarners splits={splits} />);

    expect(screen.getByText('Top Earner')).toBeInTheDocument();
    expect(screen.getByText('Second Earner')).toBeInTheDocument();
    expect(screen.getByText('Third Earner')).toBeInTheDocument();
    expect(screen.queryByText('Fourth Earner')).not.toBeInTheDocument();
  });

  it('shows each employee sharePct as visible text', () => {
    const splits: TipSplitWithItems[] = [
      makeSplit({
        id: 'split-1',
        status: 'approved',
        items: [
          makeItem({
            id: 'item-1',
            employee_id: employeeIds[0],
            amount: 8000,
            employee: { name: 'Maria Santos', position: 'Server' },
          }),
          makeItem({
            id: 'item-2',
            employee_id: employeeIds[1],
            amount: 2000,
            employee: { name: 'Alex Kim', position: 'Busser' },
          }),
        ],
      }),
    ];

    render(<TipTopEarners splits={splits} />);

    expect(screen.getAllByText(/80(\.0)?%/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/20(\.0)?%/).length).toBeGreaterThan(0);
  });

  it('excludes draft-only allocations (a draft split employee must not appear)', () => {
    const splits: TipSplitWithItems[] = [
      makeSplit({
        id: 'split-1',
        status: 'draft',
        items: [
          makeItem({
            id: 'item-1',
            employee_id: employeeIds[0],
            amount: 5000,
            employee: { name: 'Draft Only Earner', position: 'Server' },
          }),
        ],
      }),
    ];

    render(<TipTopEarners splits={splits} />);

    expect(screen.queryByText('Draft Only Earner')).not.toBeInTheDocument();
    expect(screen.getByText(/no approved allocations yet/i)).toBeInTheDocument();
  });

  it('shows the empty state and no list when there are no finalized allocations', () => {
    render(<TipTopEarners splits={[]} />);

    expect(screen.getByText(/no approved allocations yet/i)).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: /top earners/i })).not.toBeInTheDocument();
  });

  it('fires onViewAll when the "View all" affordance is clicked, and hides it when no callback is provided', async () => {
    const user = userEvent.setup();
    const onViewAll = vi.fn();

    const splits: TipSplitWithItems[] = [
      makeSplit({
        id: 'split-1',
        status: 'approved',
        items: [
          makeItem({
            id: 'item-1',
            employee_id: employeeIds[0],
            amount: 5000,
            employee: { name: 'Maria Santos', position: 'Server' },
          }),
        ],
      }),
    ];

    const { rerender } = render(<TipTopEarners splits={splits} onViewAll={onViewAll} />);
    const cta = screen.getByRole('button', { name: /view all earners in distribution/i });
    await user.click(cta);
    expect(onViewAll).toHaveBeenCalledTimes(1);

    rerender(<TipTopEarners splits={splits} />);
    expect(screen.queryByRole('button', { name: /view all earners in distribution/i })).not.toBeInTheDocument();
  });
});
