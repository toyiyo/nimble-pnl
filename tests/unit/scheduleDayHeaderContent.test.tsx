/**
 * "Today" highlight for the desktop schedule grid header cell.
 *
 * Design: docs/superpowers/specs/2026-07-19-schedule-calendar-readability-design.md
 * §1 "Today" highlight (desktop grid) — filled `primary` date circle, a small
 * "Today" badge, and (via `TODAY_HEADER_CAP_RULE_CLASS`, applied by the
 * caller on the `<th>`) a 3px inset cap rule. Replaces the pulsing dot.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  ScheduleDayHeaderContent,
  TODAY_HEADER_CAP_RULE_CLASS,
} from '@/pages/SchedulingDayHeaderContent';

const TODAY = new Date('2026-07-19T12:00:00Z');
const OTHER_DAY = new Date('2026-07-14T12:00:00Z');

describe('TODAY_HEADER_CAP_RULE_CLASS', () => {
  it('is the 3px inset primary cap rule shadow utility', () => {
    expect(TODAY_HEADER_CAP_RULE_CLASS).toBe('shadow-[inset_0_3px_0_hsl(var(--primary))]');
  });
});

describe('ScheduleDayHeaderContent', () => {
  it('renders a filled primary circle around the day number when today', () => {
    render(<ScheduleDayHeaderContent day={TODAY} isToday />);
    const dayNumber = screen.getByText('19');
    expect(dayNumber).toHaveClass('bg-primary', 'text-primary-foreground', 'rounded-full');
  });

  it('renders a "Today" badge when today', () => {
    render(<ScheduleDayHeaderContent day={TODAY} isToday />);
    const badge = screen.getByText('Today');
    expect(badge).toHaveClass('bg-primary', 'text-primary-foreground');
  });

  it('does not use animate-pulse anywhere (replaces the pulsing dot)', () => {
    const { container } = render(<ScheduleDayHeaderContent day={TODAY} isToday />);
    expect(container.querySelector('.animate-pulse')).toBeNull();
  });

  it('does not render a circle fill or "Today" badge on non-today days', () => {
    render(<ScheduleDayHeaderContent day={OTHER_DAY} isToday={false} />);
    expect(screen.queryByText('Today')).toBeNull();
    const dayNumber = screen.getByText('14');
    expect(dayNumber).not.toHaveClass('bg-primary');
  });

  it('applies emphasis (selectionMode) styling independent of today', () => {
    render(<ScheduleDayHeaderContent day={OTHER_DAY} isToday={false} emphasize />);
    const weekday = screen.getByText('Tue');
    expect(weekday).toHaveClass('font-semibold');
  });
});
