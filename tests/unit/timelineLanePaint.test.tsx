/**
 * Unit tests for TimelineLane's paint-to-create layer (Stage C2):
 *   - Mouse drag on the empty plot region paints a dashed ghost bar and
 *     commits a range on pointerup.
 *   - A plain click (no movement) commits the default-duration range from
 *     `endPaint` (pure math already covered by timelineDraft.test.ts — here we
 *     only pin that TimelineLane wires pointer events through it correctly).
 *   - Touch requires a 500ms long-press before painting starts; releasing
 *     early (or moving before the timer fires) does not create a shift.
 *   - Escape cancels an in-progress paint without committing.
 *   - A visually-hidden "Add shift to <lane>" button is present per lane and
 *     invokes the quick-add callback with lane context, no pointer gesture
 *     required.
 *   - Bars (existing shifts) are unaffected: clicking a bar still calls
 *     onSelect and does not start a paint gesture.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

import { TimelineLane } from '@/components/scheduling/ShiftTimeline/TimelineLane';
import type { TimelineLane as TimelineLaneModel, TimelineBar as TimelineBarModel } from '@/components/scheduling/ShiftTimeline/useTimelineModel';
import type { TimelineWindow } from '@/lib/timelineModel';
import type { Shift } from '@/types/scheduling';
import type { PaintRange } from '@/lib/timelineDraft';

// ─── Shared helpers ────────────────────────────────────────────────────────────

const WINDOW: TimelineWindow = { startMin: 600, endMin: 1380 }; // 10:00–23:00, 780 min span

function minToPct(min: number): number {
  return ((min - WINDOW.startMin) / (WINDOW.endMin - WINDOW.startMin)) * 100;
}

function makeShift(overrides: Partial<Shift> = {}): Shift {
  return {
    id: 's1',
    restaurant_id: 'r1',
    employee_id: 'e1',
    start_time: '2026-07-11T15:00:00Z',
    end_time: '2026-07-11T21:00:00Z',
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
    leftMin: 600,
    endMin: 960,
    label: 'Ann Smith',
    ariaLabel: 'Ann Smith, Server, 10a to 4p, 6.0 hours',
    color: {
      bg: 'bg-blue-500/15',
      border: 'border-blue-500/30',
      text: 'text-blue-700 dark:text-blue-300',
    },
    ...overrides,
  };
}

function makeLane(overrides: Partial<TimelineLaneModel> = {}): TimelineLaneModel {
  return {
    key: 'Server',
    label: 'Server',
    hours: 6,
    bars: [],
    ...overrides,
  };
}

/** Stub the plot region's rect so pointerToMinutes maps deterministically. */
function stubPlotRect(container: HTMLElement, left = 0, width = 780) {
  const plot = container.querySelector('[data-testid="lane-plot"]') as HTMLElement;
  vi.spyOn(plot, 'getBoundingClientRect').mockReturnValue({
    left,
    width,
    top: 0,
    height: 28,
    right: left + width,
    bottom: 28,
    x: left,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
  return plot;
}

function renderLane(overrides: {
  lane?: TimelineLaneModel;
  onSelect?: (shift: Shift) => void;
  onPaintCommit?: (range: PaintRange, laneContext: { position?: string | null; area?: string | null }) => void;
} = {}) {
  const onSelect = overrides.onSelect ?? vi.fn();
  const onPaintCommit = overrides.onPaintCommit ?? vi.fn();
  const utils = render(
    <TimelineLane
      lane={overrides.lane ?? makeLane()}
      minToPct={minToPct}
      window={WINDOW}
      onSelect={onSelect}
      onPaintCommit={onPaintCommit}
    />,
  );
  const plot = stubPlotRect(utils.container);
  return { ...utils, plot, onSelect, onPaintCommit };
}

// ─── Mouse drag paint ────────────────────────────────────────────────────────

describe('TimelineLane paint layer — mouse drag', () => {
  it('renders a dashed ghost bar while dragging', () => {
    const { plot, container } = renderLane();

    fireEvent.pointerDown(plot, { clientX: 100, pointerId: 1, pointerType: 'mouse' });
    fireEvent.pointerMove(plot, { clientX: 200, pointerId: 1, pointerType: 'mouse' });

    const ghost = container.querySelector('[data-testid="paint-ghost"]');
    expect(ghost).toBeInTheDocument();
    expect(ghost).toHaveClass('border-dashed');
  });

  it('commits a range on pointerup after dragging', () => {
    const onPaintCommit = vi.fn();
    const { plot } = renderLane({ onPaintCommit });

    fireEvent.pointerDown(plot, { clientX: 100, pointerId: 1, pointerType: 'mouse' });
    fireEvent.pointerMove(plot, { clientX: 300, pointerId: 1, pointerType: 'mouse' });
    fireEvent.pointerUp(plot, { clientX: 300, pointerId: 1, pointerType: 'mouse' });

    expect(onPaintCommit).toHaveBeenCalledTimes(1);
    const [range, laneContext] = onPaintCommit.mock.calls[0];
    expect(range.startMin).toBeLessThan(range.endMin);
    expect(laneContext).toEqual({ key: 'Server' });
  });

  it('clears the ghost bar after commit', () => {
    const { plot, container } = renderLane();

    fireEvent.pointerDown(plot, { clientX: 100, pointerId: 1, pointerType: 'mouse' });
    fireEvent.pointerMove(plot, { clientX: 300, pointerId: 1, pointerType: 'mouse' });
    fireEvent.pointerUp(plot, { clientX: 300, pointerId: 1, pointerType: 'mouse' });

    expect(container.querySelector('[data-testid="paint-ghost"]')).not.toBeInTheDocument();
  });

  it('commits the default-duration range on a plain click (no movement)', () => {
    const onPaintCommit = vi.fn();
    const { plot } = renderLane({ onPaintCommit });

    fireEvent.pointerDown(plot, { clientX: 100, pointerId: 1, pointerType: 'mouse' });
    fireEvent.pointerUp(plot, { clientX: 100, pointerId: 1, pointerType: 'mouse' });

    expect(onPaintCommit).toHaveBeenCalledTimes(1);
    const [range] = onPaintCommit.mock.calls[0];
    expect(range.endMin - range.startMin).toBe(120);
  });

  it('does not start a paint gesture when clicking an existing bar', async () => {
    const onSelect = vi.fn();
    const onPaintCommit = vi.fn();
    const bar = makeBar();
    const { onSelect: selectSpy } = renderLane({
      lane: makeLane({ bars: [bar] }),
      onSelect,
      onPaintCommit,
    });

    fireEvent.click(screen.getByRole('button', { name: bar.ariaLabel }));

    expect(selectSpy).toHaveBeenCalledWith(bar.shift);
    expect(onPaintCommit).not.toHaveBeenCalled();
  });
});

// ─── Escape cancels ──────────────────────────────────────────────────────────

describe('TimelineLane paint layer — Escape cancel', () => {
  it('cancels an in-progress paint without committing', () => {
    const onPaintCommit = vi.fn();
    const { plot, container } = renderLane({ onPaintCommit });

    fireEvent.pointerDown(plot, { clientX: 100, pointerId: 1, pointerType: 'mouse' });
    fireEvent.pointerMove(plot, { clientX: 300, pointerId: 1, pointerType: 'mouse' });
    expect(container.querySelector('[data-testid="paint-ghost"]')).toBeInTheDocument();

    fireEvent.keyDown(plot, { key: 'Escape' });
    expect(container.querySelector('[data-testid="paint-ghost"]')).not.toBeInTheDocument();

    fireEvent.pointerUp(plot, { clientX: 300, pointerId: 1, pointerType: 'mouse' });
    expect(onPaintCommit).not.toHaveBeenCalled();
  });
});

// ─── Touch long-press ────────────────────────────────────────────────────────

describe('TimelineLane paint layer — touch long-press', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not paint on touch before the 500ms long-press timer fires', () => {
    const { plot, container } = renderLane();

    fireEvent.pointerDown(plot, { clientX: 100, pointerId: 1, pointerType: 'touch' });
    vi.advanceTimersByTime(400);
    fireEvent.pointerMove(plot, { clientX: 200, pointerId: 1, pointerType: 'touch' });

    expect(container.querySelector('[data-testid="paint-ghost"]')).not.toBeInTheDocument();
  });

  it('starts painting after the 500ms long-press timer fires', () => {
    const { plot, container } = renderLane();

    fireEvent.pointerDown(plot, { clientX: 100, pointerId: 1, pointerType: 'touch' });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    fireEvent.pointerMove(plot, { clientX: 200, pointerId: 1, pointerType: 'touch' });

    expect(container.querySelector('[data-testid="paint-ghost"]')).toBeInTheDocument();
  });

  it('cancels the pending long-press timer if the pointer is released early', () => {
    const onPaintCommit = vi.fn();
    const { plot } = renderLane({ onPaintCommit });

    fireEvent.pointerDown(plot, { clientX: 100, pointerId: 1, pointerType: 'touch' });
    vi.advanceTimersByTime(200);
    fireEvent.pointerUp(plot, { clientX: 100, pointerId: 1, pointerType: 'touch' });
    vi.advanceTimersByTime(500);

    expect(onPaintCommit).not.toHaveBeenCalled();
  });

  it('cancels the pending long-press timer if the pointer moves before it fires (preserves scroll)', () => {
    const { plot, container } = renderLane();

    fireEvent.pointerDown(plot, { clientX: 100, pointerId: 1, pointerType: 'touch' });
    vi.advanceTimersByTime(200);
    // Movement before the long-press fires is a scroll gesture, not a paint drag.
    fireEvent.pointerMove(plot, { clientX: 140, pointerId: 1, pointerType: 'touch' });
    vi.advanceTimersByTime(500);
    fireEvent.pointerMove(plot, { clientX: 200, pointerId: 1, pointerType: 'touch' });

    expect(container.querySelector('[data-testid="paint-ghost"]')).not.toBeInTheDocument();
  });
});

// ─── Keyboard entry point ────────────────────────────────────────────────────

describe('TimelineLane paint layer — keyboard entry point', () => {
  it('renders a visually-hidden "Add shift to <lane>" button', () => {
    renderLane({ lane: makeLane({ label: 'Bar' }) });
    expect(screen.getByRole('button', { name: 'Add shift to Bar lane' })).toBeInTheDocument();
  });

  it('labels the button "Unassigned lane" when the lane label is empty', () => {
    renderLane({ lane: makeLane({ key: 'unknown', label: '' }) });
    expect(screen.getByRole('button', { name: 'Add shift to Unassigned lane' })).toBeInTheDocument();
  });

  it('invokes onPaintCommit with a default-duration range at the window start when activated', () => {
    const onPaintCommit = vi.fn();
    renderLane({ lane: makeLane({ key: 'Bar', label: 'Bar' }), onPaintCommit });

    fireEvent.click(screen.getByRole('button', { name: 'Add shift to Bar lane' }));

    expect(onPaintCommit).toHaveBeenCalledTimes(1);
    const [range, laneContext] = onPaintCommit.mock.calls[0];
    expect(range.endMin - range.startMin).toBe(120);
    expect(laneContext).toEqual({ key: 'Bar' });
  });

  it('is visually hidden via sr-only styling', () => {
    renderLane({ lane: makeLane({ label: 'Bar' }) });
    const button = screen.getByRole('button', { name: 'Add shift to Bar lane' });
    expect(button.className).toMatch(/sr-only/);
  });
});
