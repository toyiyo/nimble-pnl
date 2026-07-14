import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { TipPeriodSummary } from '@/components/tips/TipPeriodSummary';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TipSplitWithItems } from '@/hooks/useTipSplits';

describe('TipPeriodSummary', () => {
  const startDate = new Date('2026-01-19');
  const endDate = new Date('2026-01-25');

  it('shows warning if coverage is incomplete', () => {
    render(
      <TipPeriodSummary
        splits={[]}
        startDate={startDate}
        endDate={endDate}
        isLoading={false}
        shareMethod="hours"
      />
    );
    expect(screen.getByText(/missing tips/i)).toBeInTheDocument();
  });

  it('shows correct total tips amount', () => {
    const splits: TipSplitWithItems[] = [
      {
        id: '1',
        restaurant_id: 'r1',
        split_date: '2026-01-20',
        total_amount: 15000, // $150.00
        status: 'approved',
        share_method: 'hours',
        created_at: '2026-01-20T12:00:00Z',
        items: [],
      },
      {
        id: '2',
        restaurant_id: 'r1',
        split_date: '2026-01-21',
        total_amount: 10000, // $100.00
        status: 'approved',
        share_method: 'hours',
        created_at: '2026-01-21T12:00:00Z',
        items: [],
      },
    ];

    render(
      <TipPeriodSummary
        splits={splits}
        startDate={startDate}
        endDate={endDate}
        isLoading={false}
        shareMethod="hours"
      />
    );

    // Total should be $250.00
    expect(screen.getByText('$250.00')).toBeInTheDocument();
  });

  it('shows coverage stats correctly', () => {
    const splits: TipSplitWithItems[] = [
      {
        id: '1',
        restaurant_id: 'r1',
        split_date: '2026-01-20',
        total_amount: 10000,
        status: 'approved',
        share_method: 'hours',
        created_at: '2026-01-20T12:00:00Z',
        items: [],
      },
    ];

    render(
      <TipPeriodSummary
        splits={splits}
        startDate={startDate}
        endDate={endDate}
        isLoading={false}
        shareMethod="hours"
      />
    );

    // Should show 1 of 7 days
    expect(screen.getByText('1 of 7 days')).toBeInTheDocument();
  });

  it('shows loading skeleton when loading', () => {
    const { container } = render(
      <TipPeriodSummary
        splits={undefined}
        startDate={startDate}
        endDate={endDate}
        isLoading={true}
        shareMethod="hours"
      />
    );

    // Verify the loading state doesn't show normal content
    expect(screen.queryByText('Total tips')).not.toBeInTheDocument();
    // Skeleton bumped to approximate the taller card (with the earners strip)
    expect(container.querySelector('.h-40')).toBeInTheDocument();
  });

  it('displays share method label correctly', () => {
    render(
      <TipPeriodSummary
        splits={[]}
        startDate={startDate}
        endDate={endDate}
        isLoading={false}
        shareMethod="hours"
      />
    );

    expect(screen.getByText('By hours worked')).toBeInTheDocument();
  });

  it('renders the top earners strip and wires onViewDistribution to it', async () => {
    const user = userEvent.setup();
    const onViewDistribution = vi.fn();
    const splits: TipSplitWithItems[] = [
      {
        id: '1',
        restaurant_id: 'r1',
        split_date: '2026-01-20',
        total_amount: 10000,
        status: 'approved',
        share_method: 'hours',
        created_at: '2026-01-20T12:00:00Z',
        items: [
          {
            id: 'item-1',
            tip_split_id: '1',
            employee_id: 'e1',
            amount: 10000,
            hours_worked: 5,
            role: 'Server',
            role_weight: null,
            employee: { name: 'Maria Santos', position: 'Server' },
          } as TipSplitWithItems['items'][number],
        ],
      },
    ];

    render(
      <TipPeriodSummary
        splits={splits}
        startDate={startDate}
        endDate={endDate}
        isLoading={false}
        shareMethod="hours"
        onViewDistribution={onViewDistribution}
      />
    );

    expect(screen.getByText('Top earners')).toBeInTheDocument();
    expect(screen.getByText('Maria Santos')).toBeInTheDocument();

    const cta = screen.getByRole('button', { name: /view all earners in distribution/i });
    await user.click(cta);
    expect(onViewDistribution).toHaveBeenCalledTimes(1);
  });

  it('renders the top earners strip after the stats grid and before the missing-days alert', () => {
    const splits: TipSplitWithItems[] = [
      {
        id: '1',
        restaurant_id: 'r1',
        split_date: '2026-01-20',
        total_amount: 10000,
        status: 'approved',
        share_method: 'hours',
        created_at: '2026-01-20T12:00:00Z',
        items: [],
      },
    ];

    render(
      <TipPeriodSummary
        splits={splits}
        startDate={startDate}
        endDate={endDate}
        isLoading={false}
        shareMethod="hours"
      />
    );

    // 6 days missing out of 7 -> the missing-days alert should render
    const statsGrid = screen.getByText('Total tips').closest('div')!.parentElement!;
    const topEarnersHeading = screen.getByText('Top earners');
    const alert = screen.getByText(/missing tips/i);

    expect(
      statsGrid.compareDocumentPosition(topEarnersHeading.closest('div')!) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      topEarnersHeading.compareDocumentPosition(alert) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });
});
