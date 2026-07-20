/**
 * Time-off cell treatment for the desktop schedule grid day cell.
 *
 * Design: docs/superpowers/specs/2026-07-19-schedule-calendar-readability-design.md
 * §2 Time-off treatment (desktop grid) — off cells move off the info-blue onto
 * a neutral `.timeoff-hatch` + dashed border, and a "Time off" pill renders on
 * *every* off day (not just the first day of a span). A shift scheduled during
 * approved time off is flagged as a conflict via `.conflict-hatch` +
 * `border-destructive` + a destructive "Conflict" tag.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SchedulingTimeOffCellContent } from '@/pages/SchedulingTimeOffCellContent';

describe('SchedulingTimeOffCellContent', () => {
  it('renders children with no hatch/border classes when not off', () => {
    const { container } = render(
      <SchedulingTimeOffCellContent isOff={false} hasShift={false}>
        <div>shift content</div>
      </SchedulingTimeOffCellContent>
    );
    expect(screen.getByText('shift content')).toBeInTheDocument();
    const wrapper = container.firstElementChild!;
    expect(wrapper.className).not.toMatch(/timeoff-hatch|conflict-hatch/);
    expect(screen.queryByText('Time off')).toBeNull();
    expect(screen.queryByText('Conflict')).toBeNull();
  });

  it('applies .timeoff-hatch + dashed muted border and a "Time off" pill on an off day with no shift', () => {
    const { container } = render(
      <SchedulingTimeOffCellContent isOff hasShift={false}>
        <div>add button</div>
      </SchedulingTimeOffCellContent>
    );
    const wrapper = container.firstElementChild!;
    expect(wrapper).toHaveClass('timeoff-hatch', 'border-dashed', 'border-muted-foreground/50');
    expect(wrapper.className).not.toMatch(/conflict-hatch/);
    expect(screen.getByText('Time off')).toBeInTheDocument();
    expect(screen.queryByText('Conflict')).toBeNull();
  });

  it('renders the "Time off" pill on every off day, not only the run start (no isRunStart gate)', () => {
    // No isRunStart-style prop exists at all — every off day (isOff=true) gets the pill.
    render(
      <SchedulingTimeOffCellContent isOff hasShift={false}>
        <div>day 3 of the span</div>
      </SchedulingTimeOffCellContent>
    );
    expect(screen.getByText('Time off')).toBeInTheDocument();
  });

  it('applies .conflict-hatch + destructive border and a "Conflict" tag when off and a shift exists', () => {
    const { container } = render(
      <SchedulingTimeOffCellContent isOff hasShift>
        <div>the shift card</div>
      </SchedulingTimeOffCellContent>
    );
    const wrapper = container.firstElementChild!;
    expect(wrapper).toHaveClass('conflict-hatch', 'border-destructive');
    expect(wrapper.className).not.toMatch(/timeoff-hatch/);
    expect(screen.getByText('Conflict')).toBeInTheDocument();
    expect(screen.queryByText('Time off')).toBeNull();
  });

  it('preserves sr-only "Approved time off" text for a non-conflict off day', () => {
    render(
      <SchedulingTimeOffCellContent isOff hasShift={false}>
        <div />
      </SchedulingTimeOffCellContent>
    );
    expect(screen.getByText('Approved time off')).toHaveClass('sr-only');
  });

  it('preserves sr-only scheduling-conflict text for a conflict day', () => {
    render(
      <SchedulingTimeOffCellContent isOff hasShift>
        <div />
      </SchedulingTimeOffCellContent>
    );
    expect(
      screen.getByText('Scheduling conflict: shift scheduled during approved time off')
    ).toHaveClass('sr-only');
  });

  it('renders no sr-only status text when not off', () => {
    render(
      <SchedulingTimeOffCellContent isOff={false} hasShift={false}>
        <div />
      </SchedulingTimeOffCellContent>
    );
    expect(screen.queryByText('Approved time off')).toBeNull();
    expect(
      screen.queryByText('Scheduling conflict: shift scheduled during approved time off')
    ).toBeNull();
  });

  it('always renders children regardless of off/conflict state', () => {
    render(
      <SchedulingTimeOffCellContent isOff hasShift>
        <div>the shift card</div>
      </SchedulingTimeOffCellContent>
    );
    expect(screen.getByText('the shift card')).toBeInTheDocument();
  });
});
