import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { ScheduleOverviewPanel } from '@/components/scheduling/ShiftPlanner/ScheduleOverviewPanel';
import type { OverviewDay } from '@/hooks/usePlannerShiftsIndex';

// 7-day fixture: 5 staffed, 2 unstaffed
const WEEK_DAYS = [
  '2026-06-16',
  '2026-06-17',
  '2026-06-18',
  '2026-06-19',
  '2026-06-20',
  '2026-06-21',
  '2026-06-22',
];

function makeDay(day: string, unstaffed: boolean): OverviewDay {
  return { day, pills: [], collapsedCount: 0, hasGap: false, gapLabel: null, unstaffed };
}

const overviewDays: OverviewDay[] = [
  makeDay(WEEK_DAYS[0], false), // staffed
  makeDay(WEEK_DAYS[1], false), // staffed
  makeDay(WEEK_DAYS[2], false), // staffed
  makeDay(WEEK_DAYS[3], true),  // unstaffed
  makeDay(WEEK_DAYS[4], false), // staffed
  makeDay(WEEK_DAYS[5], false), // staffed
  makeDay(WEEK_DAYS[6], true),  // unstaffed
];

const coverageByDay = new Map<string, number[]>();

describe('<ScheduleOverviewPanel>', () => {
  it('shows empty state when overviewDays is empty', () => {
    const { container } = render(
      <ScheduleOverviewPanel
        overviewDays={[]}
        coverageByDay={new Map<string, number[]>()}
        isMobile={false}
      />,
    );

    // Expand the panel first (empty state lives inside CollapsibleContent)
    const trigger = screen.getByRole('button', { expanded: false });
    fireEvent.click(trigger);

    // Empty-state message is shown
    expect(screen.getByText(/No schedule data for this week\./i)).toBeTruthy();

    // No day cards
    expect(container.querySelectorAll('[data-overview-day]')).toHaveLength(0);
  });

  it('is collapsed by default: no day cards visible, teaser shows 5/7 days staffed', () => {
    const { container } = render(
      <ScheduleOverviewPanel
        overviewDays={overviewDays}
        coverageByDay={coverageByDay}
        isMobile={false}
      />,
    );

    // Trigger button must report aria-expanded=false
    const trigger = screen.getByRole('button', { expanded: false });
    expect(trigger).toBeTruthy();

    // CollapsibleContent is unmounted when closed → zero day cards
    const dayCards = container.querySelectorAll('[data-overview-day]');
    expect(dayCards).toHaveLength(0);

    // Rollup teaser is visible when collapsed
    expect(screen.getByText(/5\/7 days staffed/)).toBeTruthy();
  });

  it('expanding reveals 7 day cards and hides the teaser', () => {
    const { container } = render(
      <ScheduleOverviewPanel
        overviewDays={overviewDays}
        coverageByDay={coverageByDay}
        isMobile={false}
      />,
    );

    const trigger = screen.getByRole('button', { expanded: false });
    fireEvent.click(trigger);

    // After expand: aria-expanded=true
    expect(screen.getByRole('button', { expanded: true })).toBeTruthy();

    // 7 day cards mount
    const dayCards = container.querySelectorAll('[data-overview-day]');
    expect(dayCards).toHaveLength(7);

    // Teaser disappears when expanded
    expect(screen.queryByText(/days staffed/)).toBeNull();
  });

  it('collapsing again hides day cards and restores the teaser', () => {
    const { container } = render(
      <ScheduleOverviewPanel
        overviewDays={overviewDays}
        coverageByDay={coverageByDay}
        isMobile={false}
      />,
    );

    const trigger = screen.getByRole('button', { expanded: false });
    fireEvent.click(trigger); // expand
    fireEvent.click(screen.getByRole('button', { expanded: true })); // collapse

    // Back to collapsed state
    expect(screen.getByRole('button', { expanded: false })).toBeTruthy();
    expect(container.querySelectorAll('[data-overview-day]')).toHaveLength(0);
    expect(screen.getByText(/5\/7 days staffed/)).toBeTruthy();
  });

  it('rollup math: counts unstaffed:false days out of total', () => {
    // 5 staffed of 7 total → "5/7 days staffed"
    render(
      <ScheduleOverviewPanel
        overviewDays={overviewDays}
        coverageByDay={coverageByDay}
        isMobile={false}
      />,
    );

    expect(screen.getByText(/5\/7 days staffed/)).toBeTruthy();
  });
});
