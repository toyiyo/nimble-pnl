import React from 'react';
import { describe, it, expect } from 'vitest';
import { TipPeriodSummary } from '@/components/tips/TipPeriodSummary';
import { render, screen } from '@testing-library/react';
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
    render(
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
});
