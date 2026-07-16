/**
 * Regression tests for TimelineBar's live outside-availability recompute
 * during an in-flight drag/resize (design doc §3c: "It updates live as a
 * bar is dragged/resized ... see availability before you commit").
 *
 * Before this fix, the amber marker / aria-label suffix stayed pinned to
 * `bar.outsideAvailability` — the value computed once, pre-drag, by
 * `timelineModel.assignRows` — for the entire gesture. These tests drag a
 * bar across an availability-window boundary and assert the marker flips
 * live, using the same `shiftOutsideAvailability` predicate the RPC mirrors.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { TimelineBar } from '@/components/scheduling/ShiftTimeline/TimelineBar';
import type { TimelineBar as TimelineBarModel } from '@/components/scheduling/ShiftTimeline/useTimelineModel';
import type { TimelineWindow } from '@/lib/timelineModel';
import type { EffectiveAvailability } from '@/lib/effectiveAvailability';
import type { Shift } from '@/types/scheduling';

const WINDOW: TimelineWindow = { startMin: 600, endMin: 1380 }; // 10:00–23:00

function minToPct(min: number): number {
  return ((min - WINDOW.startMin) / (WINDOW.endMin - WINDOW.startMin)) * 100;
}

// left === WINDOW.startMin and width === span makes clientX read directly as
// restaurant-local minutes-since-midnight (same trick as timelineBarDrag.test.tsx).
const PLOT_RECT = {
  left: WINDOW.startMin,
  width: WINDOW.endMin - WINDOW.startMin,
  top: 0,
  height: 28,
  right: WINDOW.endMin,
  bottom: 28,
  x: WINDOW.startMin,
  y: 0,
  toJSON: () => ({}),
} as DOMRect;

const DATE_STR = '2026-07-11';
const TZ = 'UTC';
const DOW = new Date(`${DATE_STR}T00:00:00`).getDay();

// Employee available 15:00–21:00 UTC (stored UTC-clock, and tz is UTC so the
// local wall-clock window is identical: 15:00–21:00).
const AVAILABLE_15_TO_21: EffectiveAvailability = {
  type: 'recurring',
  slots: [{ isAvailable: true, startTime: '15:00:00', endTime: '21:00:00', sourceRecord: {} as never }],
};

function makeAvailabilityMap(): Map<string, Map<number, EffectiveAvailability>> {
  const dowMap = new Map<number, EffectiveAvailability>();
  dowMap.set(DOW, AVAILABLE_15_TO_21);
  return new Map([['e1', dowMap]]);
}

function makeShift(overrides: Partial<Shift> = {}): Shift {
  return {
    id: 's1',
    restaurant_id: 'r1',
    employee_id: 'e1',
    start_time: '2026-07-11T16:00:00Z',
    end_time: '2026-07-11T19:00:00Z',
    break_duration: 0,
    position: 'Server',
    status: 'scheduled',
    is_published: false,
    locked: false,
    source: 'manual',
    notes: '',
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
    ...overrides,
  };
}

function makeBar(overrides: Partial<TimelineBarModel> = {}): TimelineBarModel {
  return {
    shift: makeShift(),
    row: 0,
    leftMin: 900, // 15:00
    endMin: 1080, // 18:00 — inside the 15:00-21:00 window
    label: 'Ann Smith',
    ariaLabel: 'Ann Smith, Server, 3p to 6p, 3.0 hours',
    color: {
      bg: 'bg-blue-500/15',
      border: 'border-blue-500/30',
      text: 'text-blue-700 dark:text-blue-300',
    },
    outsideAvailability: false,
    ...overrides,
  };
}

let rafSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
    cb(0);
    return 1;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
});

afterEach(() => {
  rafSpy.mockRestore();
  vi.restoreAllMocks();
});

describe('TimelineBar — live outside-availability recompute during drag', () => {
  it('flips the marker ON mid-drag when the draft range moves outside the window, even though the pre-drag bar was inside it', () => {
    const bar = makeBar({ leftMin: 900, endMin: 1080, outsideAvailability: false }); // 15:00-18:00, inside
    render(
      <TimelineBar
        bar={bar}
        minToPct={minToPct}
        onSelect={vi.fn()}
        window={WINDOW}
        getPlotRect={() => PLOT_RECT}
        onDraftChange={vi.fn()}
        onDragCommit={vi.fn()}
        availabilityByEmployee={makeAvailabilityMap()}
        dateStr={DATE_STR}
        tz={TZ}
      />,
    );
    const button = screen.getByRole('button');

    // Pre-drag: marker reflects the static bar.outsideAvailability (false).
    expect(button.className).not.toContain('border-l-amber-500');
    expect(button.getAttribute('aria-label')).not.toMatch(/outside availability/);

    // Drag +300min: 15:00-18:00 -> 20:00-23:00, which extends past the 21:00 window end.
    fireEvent.pointerDown(button, { pointerId: 1, clientX: 900, pointerType: 'mouse' });
    fireEvent.pointerMove(button, { pointerId: 1, clientX: 1200, pointerType: 'mouse' });

    expect(button.className).toContain('border-l-amber-500');
    expect(button.getAttribute('aria-label')).toMatch(/outside availability/);
  });

  it('flips the marker OFF mid-drag when the draft range moves back inside the window, even though the pre-drag bar was outside it', () => {
    const bar = makeBar({ leftMin: 1200, endMin: 1380, outsideAvailability: true }); // 20:00-23:00, outside
    render(
      <TimelineBar
        bar={bar}
        minToPct={minToPct}
        onSelect={vi.fn()}
        window={WINDOW}
        getPlotRect={() => PLOT_RECT}
        onDraftChange={vi.fn()}
        onDragCommit={vi.fn()}
        availabilityByEmployee={makeAvailabilityMap()}
        dateStr={DATE_STR}
        tz={TZ}
      />,
    );
    const button = screen.getByRole('button');

    // Pre-drag: marker reflects the static bar.outsideAvailability (true).
    expect(button.className).toContain('border-l-amber-500');
    expect(button.getAttribute('aria-label')).toMatch(/outside availability/);

    // Drag -300min: 20:00-23:00 -> 15:00-18:00, fully inside the 15:00-21:00 window.
    fireEvent.pointerDown(button, { pointerId: 1, clientX: 1200, pointerType: 'mouse' });
    fireEvent.pointerMove(button, { pointerId: 1, clientX: 900, pointerType: 'mouse' });

    expect(button.className).not.toContain('border-l-amber-500');
    expect(button.getAttribute('aria-label')).not.toMatch(/outside availability/);
  });

  it('reverts to the static bar.outsideAvailability once the drag ends (dragState clears)', () => {
    const bar = makeBar({ leftMin: 900, endMin: 1080, outsideAvailability: false });
    render(
      <TimelineBar
        bar={bar}
        minToPct={minToPct}
        onSelect={vi.fn()}
        window={WINDOW}
        getPlotRect={() => PLOT_RECT}
        onDraftChange={vi.fn()}
        onDragCommit={vi.fn()}
        availabilityByEmployee={makeAvailabilityMap()}
        dateStr={DATE_STR}
        tz={TZ}
      />,
    );
    const button = screen.getByRole('button');

    fireEvent.pointerDown(button, { pointerId: 1, clientX: 900, pointerType: 'mouse' });
    fireEvent.pointerMove(button, { pointerId: 1, clientX: 1200, pointerType: 'mouse' });
    expect(button.className).toContain('border-l-amber-500'); // live-flagged mid-drag

    fireEvent.pointerUp(button, { pointerId: 1, clientX: 1200, pointerType: 'mouse' });

    // dragState is now null — falls back to the static (pre-drag) value again.
    expect(button.className).not.toContain('border-l-amber-500');
    expect(button.getAttribute('aria-label')).not.toMatch(/outside availability/);
  });

  it('backward compatibility: without availabilityByEmployee/dateStr/tz, the marker stays pinned to the static bar.outsideAvailability throughout the drag', () => {
    const bar = makeBar({ leftMin: 900, endMin: 1080, outsideAvailability: false }); // would flip live if props were supplied
    render(
      <TimelineBar
        bar={bar}
        minToPct={minToPct}
        onSelect={vi.fn()}
        window={WINDOW}
        getPlotRect={() => PLOT_RECT}
        onDraftChange={vi.fn()}
        onDragCommit={vi.fn()}
        // No availabilityByEmployee / dateStr / tz supplied.
      />,
    );
    const button = screen.getByRole('button');

    fireEvent.pointerDown(button, { pointerId: 1, clientX: 900, pointerType: 'mouse' });
    fireEvent.pointerMove(button, { pointerId: 1, clientX: 1200, pointerType: 'mouse' });

    // Draft range is now 20:00-23:00 (would be outside availability), but with
    // no availability data supplied the marker must stay at the static false.
    expect(button.className).not.toContain('border-l-amber-500');
    expect(button.getAttribute('aria-label')).not.toMatch(/outside availability/);
  });
});
