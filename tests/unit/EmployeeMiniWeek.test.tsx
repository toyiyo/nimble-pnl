import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { EmployeeMiniWeek } from '@/components/scheduling/ShiftPlanner/EmployeeMiniWeek';
import { TooltipProvider } from '@/components/ui/tooltip';

import type { Shift } from '@/types/scheduling';
import type { EffectiveAvailability } from '@/lib/effectiveAvailability';

let nextShiftId = 0;
function makeShift(partial: Partial<Shift>): Shift {
  nextShiftId += 1;
  return {
    id: 's' + nextShiftId,
    restaurant_id: 'r1',
    employee_id: 'e1',
    start_time: '2026-04-20T13:00:00',
    end_time: '2026-04-20T21:00:00',
    break_duration: 0,
    position: 'server',
    status: 'scheduled',
    is_published: false,
    locked: false,
    source: 'manual',
    created_at: '',
    updated_at: '',
    ...partial,
  };
}

const weekDays = [
  '2026-04-20', '2026-04-21', '2026-04-22', '2026-04-23',
  '2026-04-24', '2026-04-25', '2026-04-26',
];

describe('<EmployeeMiniWeek>', () => {
  it('renders 7 day columns', () => {
    const { container } = render(
      <EmployeeMiniWeek weekDays={weekDays} employeeShifts={[]} />,
    );
    expect(container.querySelectorAll('[data-mini-week-day]')).toHaveLength(7);
  });

  it('renders a shift bar only inside the day matching the shift start', () => {
    const shifts = [makeShift({ start_time: '2026-04-21T09:00:00', end_time: '2026-04-21T17:00:00' })];
    const { container } = render(
      <EmployeeMiniWeek weekDays={weekDays} employeeShifts={shifts} />,
    );
    const tuesday = container.querySelector('[data-mini-week-day="2026-04-21"]');
    expect(tuesday).not.toBeNull();
    expect(tuesday!.querySelectorAll('[data-mini-bar]')).toHaveLength(1);
    const monday = container.querySelector('[data-mini-week-day="2026-04-20"]');
    expect(monday).not.toBeNull();
    expect(monday!.querySelectorAll('[data-mini-bar]')).toHaveLength(0);
  });

  it('renders multiple bars when employee has multiple shifts on the same day', () => {
    const shifts = [
      makeShift({ id: 'a', start_time: '2026-04-20T07:00:00', end_time: '2026-04-20T11:00:00' }),
      makeShift({ id: 'b', start_time: '2026-04-20T17:00:00', end_time: '2026-04-20T22:00:00' }),
    ];
    const { container } = render(
      <EmployeeMiniWeek weekDays={weekDays} employeeShifts={shifts} />,
    );
    const monday = container.querySelector('[data-mini-week-day="2026-04-20"]');
    expect(monday).not.toBeNull();
    expect(monday!.querySelectorAll('[data-mini-bar]')).toHaveLength(2);
  });
});

// dow: 2026-04-20 (Mon)=1, 04-21 (Tue)=2, 04-22 (Wed)=3, 04-23 (Thu)=4,
// 04-24 (Fri)=5, 04-25 (Sat)=6, 04-26 (Sun)=0
const dates = weekDays.map((d) => new Date(d + 'T00:00:00'));

function renderWithTooltip(ui: React.ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

describe('<EmployeeMiniWeek> availability tint (Task 6)', () => {
  it('renders exactly as today (no tint, day cells aria-hidden, no strip summary) when availabilityByDow is not provided', () => {
    const { container } = renderWithTooltip(
      <EmployeeMiniWeek weekDays={weekDays} employeeShifts={[]} />,
    );
    const monday = container.querySelector('[data-mini-week-day="2026-04-20"]');
    expect(monday).not.toBeNull();
    expect(monday!.getAttribute('aria-hidden')).toBe('true');
    expect(monday!.className).not.toMatch(/emerald|amber|red-500\/5/);
    expect(container.querySelector('[role="img"]')).toBeNull();
  });

  it('tints an available recurring day emerald and an unavailable recurring day red with a hatch pattern', () => {
    const availabilityByDow = new Map<number, EffectiveAvailability>([
      [
        1, // Monday
        {
          type: 'recurring',
          slots: [{ isAvailable: true, startTime: '09:00:00', endTime: '17:00:00', sourceRecord: {} as never }],
        },
      ],
      [
        2, // Tuesday
        {
          type: 'recurring',
          slots: [{ isAvailable: false, startTime: null, endTime: null, sourceRecord: {} as never }],
        },
      ],
    ]);
    const { container } = renderWithTooltip(
      <EmployeeMiniWeek
        weekDays={weekDays}
        employeeShifts={[]}
        availabilityByDow={availabilityByDow}
        timezone="UTC"
        dates={dates}
      />,
    );
    const monday = container.querySelector('[data-mini-week-day="2026-04-20"]');
    const tuesday = container.querySelector('[data-mini-week-day="2026-04-21"]');
    expect(monday!.className).toMatch(/emerald-500\/10/);
    expect(tuesday!.className).toMatch(/red-500\/5/);
    expect(tuesday!.getAttribute('style')).toMatch(/repeating-linear-gradient/);
    expect(monday!.getAttribute('style') ?? '').not.toMatch(/repeating-linear-gradient/);
  });

  it('exposes a single accessible strip-level summary and keeps day cells aria-hidden', () => {
    const availabilityByDow = new Map<number, EffectiveAvailability>([
      [
        1, // Monday
        {
          type: 'recurring',
          slots: [{ isAvailable: true, startTime: '09:00:00', endTime: '17:00:00', sourceRecord: {} as never }],
        },
      ],
      [
        2, // Tuesday
        {
          type: 'recurring',
          slots: [{ isAvailable: false, startTime: null, endTime: null, sourceRecord: {} as never }],
        },
      ],
    ]);
    const { container } = renderWithTooltip(
      <EmployeeMiniWeek
        weekDays={weekDays}
        employeeShifts={[]}
        availabilityByDow={availabilityByDow}
        timezone="UTC"
        dates={dates}
      />,
    );

    const strip = screen.getByRole('img', {
      name: /Availability — Mon Available 9:00 AM – 5:00 PM; Tue Unavailable; Wed No availability set/,
    });
    expect(strip).toBeInTheDocument();

    for (const day of weekDays) {
      const cell = container.querySelector(`[data-mini-week-day="${day}"]`);
      expect(cell!.getAttribute('aria-hidden')).toBe('true');
    }
  });

  // CodeRabbit finding: `weekSummary` indexed `dates[i]` directly (no
  // optional chaining), unlike the grid render's `dates?.[i]?.getDay()` a
  // few lines below for the same lookup — a length mismatch between `dates`
  // and `weekDays` would throw instead of degrading gracefully.
  it('does not throw and falls back to "No availability set" when dates is shorter than weekDays', () => {
    const availabilityByDow = new Map<number, EffectiveAvailability>([
      [
        1, // Monday
        {
          type: 'recurring',
          slots: [{ isAvailable: true, startTime: '09:00:00', endTime: '17:00:00', sourceRecord: {} as never }],
        },
      ],
    ]);
    const shortDates = dates.slice(0, 3); // fewer entries than weekDays (7)
    expect(() =>
      renderWithTooltip(
        <EmployeeMiniWeek
          weekDays={weekDays}
          employeeShifts={[]}
          availabilityByDow={availabilityByDow}
          timezone="UTC"
          dates={shortDates}
        />,
      ),
    ).not.toThrow();

    // Days beyond shortDates' length (indices 3-6) fall back to a blank
    // weekday label + "No availability set" (the `d ? ... : ''` branch) —
    // the important assertion is that rendering didn't throw and Monday's
    // real availability still made it into the summary.
    const strip = screen.getByRole('img', {
      name: /Availability — Mon Available 9:00 AM – 5:00 PM;.*No availability set/,
    });
    expect(strip).toBeInTheDocument();
  });

  // CodeRabbit finding: the strip is a Radix TooltipTrigger (asChild) wrapping
  // a plain div — without an explicit tabIndex, a div isn't natively
  // focusable, so a keyboard-only user could never trigger the tooltip that
  // exposes this same aria-label summary (CLAUDE.md: "Interactive elements
  // must be keyboard accessible").
  it('makes the accessible strip keyboard-focusable (tabIndex=0) so its tooltip is reachable without a mouse', () => {
    const availabilityByDow = new Map<number, EffectiveAvailability>([
      [
        1,
        {
          type: 'recurring',
          slots: [{ isAvailable: true, startTime: '09:00:00', endTime: '17:00:00', sourceRecord: {} as never }],
        },
      ],
    ]);
    const { container } = renderWithTooltip(
      <EmployeeMiniWeek
        weekDays={weekDays}
        employeeShifts={[]}
        availabilityByDow={availabilityByDow}
        timezone="UTC"
        dates={dates}
      />,
    );
    const strip = container.querySelector('[role="img"]');
    expect(strip).not.toBeNull();
    expect(strip!.getAttribute('tabindex')).toBe('0');
  });
});
