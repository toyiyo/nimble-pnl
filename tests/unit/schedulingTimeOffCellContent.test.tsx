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

/** Get the content wrapper (the component's sole root element), throwing with a clear
 * message instead of silently dereferencing null if the markup ever changes shape. */
function getWrapper(container: HTMLElement): HTMLElement {
  const wrapper = container.firstElementChild;
  if (!(wrapper instanceof HTMLElement)) {
    throw new Error('Expected SchedulingTimeOffCellContent to render a single root element');
  }
  return wrapper;
}

describe('SchedulingTimeOffCellContent', () => {
  it('should render no hatch/border classes when the day is not off', () => {
    const { container } = render(
      <SchedulingTimeOffCellContent isOff={false} hasShift={false}>
        <div>shift content</div>
      </SchedulingTimeOffCellContent>
    );
    expect(screen.getByText('shift content')).toBeInTheDocument();
    const wrapper = getWrapper(container);
    expect(wrapper.className).not.toMatch(/timeoff-hatch|conflict-hatch/);
    expect(screen.queryByText('Time off')).toBeNull();
    expect(screen.queryByText('Conflict')).toBeNull();
  });

  it('should apply .timeoff-hatch + a dashed muted border and a "Time off" pill when the day is off with no shift', () => {
    const { container } = render(
      <SchedulingTimeOffCellContent isOff hasShift={false}>
        <div>add button</div>
      </SchedulingTimeOffCellContent>
    );
    const wrapper = getWrapper(container);
    expect(wrapper).toHaveClass('timeoff-hatch', 'border-dashed', 'border-muted-foreground/50');
    expect(wrapper.className).not.toMatch(/conflict-hatch/);
    expect(screen.getByText('Time off')).toBeInTheDocument();
    expect(screen.queryByText('Conflict')).toBeNull();
  });

  it('should render the "Time off" pill on every off day when there is no isRunStart gate', () => {
    // No isRunStart-style prop exists at all — every off day (isOff=true) gets the pill.
    render(
      <SchedulingTimeOffCellContent isOff hasShift={false}>
        <div>day 3 of the span</div>
      </SchedulingTimeOffCellContent>
    );
    expect(screen.getByText('Time off')).toBeInTheDocument();
  });

  it('should apply .conflict-hatch + a destructive border and a "Conflict" tag when an off day has a shift', () => {
    const { container } = render(
      <SchedulingTimeOffCellContent isOff hasShift>
        <div>the shift card</div>
      </SchedulingTimeOffCellContent>
    );
    const wrapper = getWrapper(container);
    expect(wrapper).toHaveClass('conflict-hatch', 'border-destructive');
    expect(wrapper.className).not.toMatch(/timeoff-hatch/);
    expect(screen.getByText('Conflict')).toBeInTheDocument();
    expect(screen.queryByText('Time off')).toBeNull();
  });

  it('should preserve the sr-only "Approved time off" text when the day is off with no conflict', () => {
    render(
      <SchedulingTimeOffCellContent isOff hasShift={false}>
        <div />
      </SchedulingTimeOffCellContent>
    );
    expect(screen.getByText('Approved time off')).toHaveClass('sr-only');
  });

  it('should preserve the sr-only scheduling-conflict text when the day is a conflict', () => {
    render(
      <SchedulingTimeOffCellContent isOff hasShift>
        <div />
      </SchedulingTimeOffCellContent>
    );
    expect(
      screen.getByText('Scheduling conflict: shift scheduled during approved time off')
    ).toHaveClass('sr-only');
  });

  it('should render no sr-only status text when the day is not off', () => {
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

  it('should always render children when off/conflict state changes', () => {
    render(
      <SchedulingTimeOffCellContent isOff hasShift>
        <div>the shift card</div>
      </SchedulingTimeOffCellContent>
    );
    expect(screen.getByText('the shift card')).toBeInTheDocument();
  });
});
