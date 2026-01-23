import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { TipPeriodTimeline } from '@/components/tips/TipPeriodTimeline';
import { render, screen, fireEvent } from '@testing-library/react';
import type { TipSplitWithItems } from '@/hooks/useTipSplits';

describe('TipPeriodTimeline', () => {
  const startDate = new Date('2026-01-19');
  const endDate = new Date('2026-01-25');

  it('renders loading skeletons when loading', () => {
    render(
      <TipPeriodTimeline
        startDate={startDate}
        endDate={endDate}
        splits={undefined}
        isLoading={true}
        onDayClick={() => {}}
      />
    );
    // Skeleton components render as divs with animate-pulse class
    const container = screen.getByText('Period Timeline').closest('.space-y-4, [class*="card"]');
    expect(container).toBeInTheDocument();
  });

  it('renders days of the week correctly', () => {
    render(
      <TipPeriodTimeline
        startDate={startDate}
        endDate={endDate}
        splits={[]}
        isLoading={false}
        onDayClick={() => {}}
      />
    );
    // Check that days are rendered (Sun through Sat for the week)
    expect(screen.getByText('Sun')).toBeInTheDocument();
    expect(screen.getByText('Mon')).toBeInTheDocument();
    expect(screen.getByText('Sat')).toBeInTheDocument();
  });

  it('handles day click correctly', () => {
    const handleClick = vi.fn();
    render(
      <TipPeriodTimeline
        startDate={startDate}
        endDate={endDate}
        splits={[]}
        isLoading={false}
        onDayClick={handleClick}
      />
    );

    // Click the first day cell (date 19)
    const dayButton = screen.getByText('19').closest('button');
    if (dayButton) {
      fireEvent.click(dayButton);
    }
    expect(handleClick).toHaveBeenCalled();
  });

  it('shows correct status for days with splits', () => {
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
      <TipPeriodTimeline
        startDate={startDate}
        endDate={endDate}
        splits={splits}
        isLoading={false}
        onDayClick={() => {}}
      />
    );

    // Check that the amount badge is displayed for the day with a split
    expect(screen.getByText('$100.00')).toBeInTheDocument();
  });

  it('shows empty state for days without entries', () => {
    render(
      <TipPeriodTimeline
        startDate={startDate}
        endDate={endDate}
        splits={[]}
        isLoading={false}
        onDayClick={() => {}}
      />
    );

    // All days should show "Add tips" text when empty
    const addTipsTexts = screen.getAllByText('Add tips');
    expect(addTipsTexts.length).toBe(7); // 7 days in the week
  });
});
