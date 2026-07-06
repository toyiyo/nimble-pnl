/**
 * Unit tests for TimelineBar's pointer drag-move / edge-resize gesture
 * (Stage D1):
 *   - A locked shift renders no resize handles and never drags — pointer
 *     sequences on its body are inert (no onDraftChange/onDragCommit calls).
 *   - A sub-threshold pointer sequence (movement below the 5px drag
 *     threshold) never fires onDraftChange/onDragCommit, leaving the bar's
 *     native onClick as the only path to onSelect — preserving tap-to-edit.
 *   - Keyboard Enter/Space (a native <button> click, no pointer events at
 *     all) still calls onSelect — the drag wiring only listens for pointer
 *     events and never intercepts keydown.
 *   - A touch pointer (`pointerType: 'touch'`) never starts a drag: no
 *     onDraftChange call, no resize-handle drag either.
 *   - A real mouse drag past the threshold calls onDraftChange with a live
 *     snapped range (rAF-throttled) and onDragCommit on release; a resize
 *     handle drag resizes only the grabbed edge.
 *
 * Pure move/resize/snap/clamp math is exhaustively covered in
 * tests/unit/timelineDragMath.test.ts — these tests only pin the DOM/pointer
 * wiring (handles present/absent, touch-action classes, click-vs-drag
 * choreography, rAF-throttled callback firing).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { TimelineBar } from '@/components/scheduling/ShiftTimeline/TimelineBar';
import type { TimelineBar as TimelineBarModel } from '@/components/scheduling/ShiftTimeline/useTimelineModel';
import type { TimelineWindow } from '@/lib/timelineModel';
import type { Shift } from '@/types/scheduling';

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

/**
 * A rect positioned so `pointerToMinutes(clientX, rect, WINDOW) === clientX`
 * exactly (for clientX within [600, 1380]): `left` equals `WINDOW.startMin`
 * and `width` equals the window's span, so the pct-based inverse mapping in
 * `pointerToMinutes` collapses to the identity. This lets tests use clientX
 * values that read directly as restaurant-local minutes-since-midnight.
 */
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

interface RenderBarOptions {
  bar?: TimelineBarModel;
  onSelect?: (shift: Shift) => void;
  onDraftChange?: (shiftId: string, range: { startMin: number; endMin: number } | null) => void;
  onDragCommit?: (shiftId: string, range: { startMin: number; endMin: number }) => void;
  getPlotRect?: () => DOMRect | null;
}

function renderBar(overrides: RenderBarOptions = {}) {
  const onSelect = overrides.onSelect ?? vi.fn();
  const onDraftChange = overrides.onDraftChange ?? vi.fn();
  const onDragCommit = overrides.onDragCommit ?? vi.fn();
  const getPlotRect = overrides.getPlotRect ?? (() => PLOT_RECT);
  const utils = render(
    <TimelineBar
      bar={overrides.bar ?? makeBar()}
      minToPct={minToPct}
      onSelect={onSelect}
      window={WINDOW}
      getPlotRect={getPlotRect}
      onDraftChange={onDraftChange}
      onDragCommit={onDragCommit}
    />,
  );
  const button = screen.getByRole('button');
  return { ...utils, button, onSelect, onDraftChange, onDragCommit };
}

let rafSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // Run rAF callbacks synchronously so drag-frame assertions don't need
  // to await an actual animation frame.
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

describe('TimelineBar drag — locked shifts', () => {
  it('renders no resize handles for a locked shift', () => {
    renderBar({ bar: makeBar({ shift: makeShift({ locked: true }) }) });
    expect(screen.queryByTestId('resize-handle-start')).not.toBeInTheDocument();
    expect(screen.queryByTestId('resize-handle-end')).not.toBeInTheDocument();
  });

  it('renders resize handles for an unlocked shift', () => {
    renderBar({ bar: makeBar({ shift: makeShift({ locked: false }) }) });
    expect(screen.getByTestId('resize-handle-start')).toBeInTheDocument();
    expect(screen.getByTestId('resize-handle-end')).toBeInTheDocument();
  });

  it('does not drag a locked bar — a pointer drag on the body never calls onDraftChange or onDragCommit', () => {
    const { button, onDraftChange, onDragCommit, onSelect } = renderBar({
      bar: makeBar({ shift: makeShift({ locked: true }) }),
    });

    fireEvent.pointerDown(button, { pointerId: 1, clientX: 100, pointerType: 'mouse' });
    fireEvent.pointerMove(button, { pointerId: 1, clientX: 200, pointerType: 'mouse' });
    fireEvent.pointerUp(button, { pointerId: 1, clientX: 200, pointerType: 'mouse' });

    expect(onDraftChange).not.toHaveBeenCalled();
    expect(onDragCommit).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('applies cursor-grab and touch-none only to unlocked bars', () => {
    const { button: unlockedBtn } = renderBar({ bar: makeBar({ shift: makeShift({ locked: false }) }) });
    expect(unlockedBtn.className).toContain('cursor-grab');
    expect(unlockedBtn.className).toContain('touch-none');
  });

  it('does not apply cursor-grab or touch-none to a locked bar', () => {
    const { button: lockedBtn } = renderBar({ bar: makeBar({ shift: makeShift({ locked: true }) }) });
    expect(lockedBtn.className).not.toContain('cursor-grab');
    expect(lockedBtn.className).not.toContain('touch-none');
  });
});

describe('TimelineBar drag — click-vs-drag disambiguation', () => {
  it('a plain click (userEvent, no real movement) calls onSelect exactly once and never starts a drag', async () => {
    const user = userEvent.setup();
    const bar = makeBar();
    const { button, onSelect, onDraftChange, onDragCommit } = renderBar({ bar });

    await user.click(button);

    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith(bar.shift);
    // The zero-movement pointerdown+up sequence still clears the (never-set)
    // draft on release — that's the only onDraftChange call, and it's `null`.
    expect(onDraftChange).toHaveBeenCalledWith('s1', null);
    expect(onDragCommit).not.toHaveBeenCalled();
  });

  it('a sub-threshold pointer sequence (< 5px movement) does not commit a drag, leaving onClick to fire onSelect', () => {
    const bar = makeBar();
    const { button, onSelect, onDraftChange, onDragCommit } = renderBar({ bar });

    fireEvent.pointerDown(button, { pointerId: 1, clientX: 100, pointerType: 'mouse' });
    fireEvent.pointerMove(button, { pointerId: 1, clientX: 102, pointerType: 'mouse' }); // 2px < 5px threshold
    fireEvent.pointerUp(button, { pointerId: 1, clientX: 102, pointerType: 'mouse' });
    // A real browser follows pointerup with a click event; jsdom's fireEvent
    // doesn't synthesize this automatically, so we fire it explicitly here to
    // pin that the hook does NOT call onSelect itself (that would double-fire
    // alongside this click).
    fireEvent.click(button);

    expect(onDraftChange).toHaveBeenCalledWith('s1', null); // cleared on pointerup, never set (sub-threshold)
    expect(onDragCommit).not.toHaveBeenCalled();
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith(bar.shift);
  });

  it('a past-threshold pointer sequence commits a drag and does NOT suppress the button (onClick is still the caller\'s concern, not fired here without a real click event)', () => {
    const bar = makeBar();
    const { button, onDragCommit } = renderBar({ bar });

    fireEvent.pointerDown(button, { pointerId: 1, clientX: 700, pointerType: 'mouse' });
    fireEvent.pointerMove(button, { pointerId: 1, clientX: 740, pointerType: 'mouse' }); // 40px > 5px threshold
    fireEvent.pointerUp(button, { pointerId: 1, clientX: 740, pointerType: 'mouse' });

    expect(onDragCommit).toHaveBeenCalledTimes(1);
    expect(onDragCommit).toHaveBeenCalledWith('s1', expect.any(Object));
  });

  it('keyboard Enter/Space still calls onSelect via the native button click (no pointer events involved)', async () => {
    const user = userEvent.setup();
    const bar = makeBar();
    const { button, onSelect } = renderBar({ bar });

    button.focus();
    await user.keyboard('{Enter}');

    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith(bar.shift);
  });
});

describe('TimelineBar drag — touch', () => {
  it('a touch pointer never starts a drag on the body', () => {
    const { button, onDraftChange, onDragCommit } = renderBar();

    fireEvent.pointerDown(button, { pointerId: 1, clientX: 100, pointerType: 'touch' });
    fireEvent.pointerMove(button, { pointerId: 1, clientX: 300, pointerType: 'touch' });
    fireEvent.pointerUp(button, { pointerId: 1, clientX: 300, pointerType: 'touch' });

    expect(onDraftChange).not.toHaveBeenCalled();
    expect(onDragCommit).not.toHaveBeenCalled();
  });

  it('a touch pointer never starts a resize on the edge handles', () => {
    const { onDraftChange, onDragCommit } = renderBar();
    const startHandle = screen.getByTestId('resize-handle-start');

    fireEvent.pointerDown(startHandle, { pointerId: 1, clientX: 0, pointerType: 'touch' });
    fireEvent.pointerMove(startHandle, { pointerId: 1, clientX: 50, pointerType: 'touch' });
    fireEvent.pointerUp(startHandle, { pointerId: 1, clientX: 50, pointerType: 'touch' });

    expect(onDraftChange).not.toHaveBeenCalled();
    expect(onDragCommit).not.toHaveBeenCalled();
  });

  it('scopes touch-action:none to the body and handles, not the lane background (verified indirectly: bar button carries touch-none)', () => {
    const { button } = renderBar();
    // The lane's own plot region (tested separately in timelineLanePaint.test.tsx)
    // uses touch-pan-x/touch-pan-y, never touch-none — this bar button is the
    // only element scoped to touch-none.
    expect(button.className).toContain('touch-none');
  });
});

describe('TimelineBar drag — move (body drag)', () => {
  it('calls onDraftChange with a snapped, duration-preserving range while dragging', () => {
    const bar = makeBar({ leftMin: 600, endMin: 960 }); // 6h shift
    const { button, onDraftChange } = renderBar({ bar });

    fireEvent.pointerDown(button, { pointerId: 1, clientX: 700, pointerType: 'mouse' });
    // clientX reads directly as minutes here (see PLOT_RECT), so a 60px move is a 60min move.
    fireEvent.pointerMove(button, { pointerId: 1, clientX: 760, pointerType: 'mouse' });

    expect(onDraftChange).toHaveBeenCalled();
    const lastCall = onDraftChange.mock.calls.at(-1);
    expect(lastCall![0]).toBe('s1');
    const range = lastCall![1] as { startMin: number; endMin: number };
    expect(range.endMin - range.startMin).toBe(360); // duration preserved
    expect(range.startMin % 15).toBe(0); // snapped to STEP_MIN
  });

  it('clears the draft (calls onDraftChange with null) on release', () => {
    const bar = makeBar({ leftMin: 600, endMin: 960 });
    const { button, onDraftChange } = renderBar({ bar });

    fireEvent.pointerDown(button, { pointerId: 1, clientX: 700, pointerType: 'mouse' });
    fireEvent.pointerMove(button, { pointerId: 1, clientX: 760, pointerType: 'mouse' });
    fireEvent.pointerUp(button, { pointerId: 1, clientX: 760, pointerType: 'mouse' });

    expect(onDraftChange).toHaveBeenLastCalledWith('s1', null);
  });

  it('cancelling the gesture (pointercancel) clears the draft without committing', () => {
    const bar = makeBar({ leftMin: 600, endMin: 960 });
    const { button, onDraftChange, onDragCommit } = renderBar({ bar });

    fireEvent.pointerDown(button, { pointerId: 1, clientX: 700, pointerType: 'mouse' });
    fireEvent.pointerMove(button, { pointerId: 1, clientX: 760, pointerType: 'mouse' });
    fireEvent.pointerCancel(button, { pointerId: 1, clientX: 760, pointerType: 'mouse' });

    expect(onDragCommit).not.toHaveBeenCalled();
    expect(onDraftChange).toHaveBeenLastCalledWith('s1', null);
  });
});

describe('TimelineBar drag — resize handles', () => {
  it('dragging the start handle resizes only startMin, leaving endMin untouched', () => {
    const bar = makeBar({ leftMin: 600, endMin: 960 });
    const { onDraftChange } = renderBar({ bar });
    const startHandle = screen.getByTestId('resize-handle-start');

    fireEvent.pointerDown(startHandle, { pointerId: 1, clientX: 600, pointerType: 'mouse' });
    fireEvent.pointerMove(startHandle, { pointerId: 1, clientX: 650, pointerType: 'mouse' }); // 50px move > threshold

    const lastCall = onDraftChange.mock.calls.at(-1);
    const range = lastCall![1] as { startMin: number; endMin: number };
    expect(range.endMin).toBe(960);
    expect(range.startMin).toBeGreaterThan(600);
  });

  it('dragging the end handle resizes only endMin, leaving startMin untouched', () => {
    const bar = makeBar({ leftMin: 600, endMin: 960 });
    const { onDraftChange } = renderBar({ bar });
    const endHandle = screen.getByTestId('resize-handle-end');

    fireEvent.pointerDown(endHandle, { pointerId: 1, clientX: 960, pointerType: 'mouse' });
    fireEvent.pointerMove(endHandle, { pointerId: 1, clientX: 1010, pointerType: 'mouse' }); // 50px move > threshold

    const lastCall = onDraftChange.mock.calls.at(-1);
    const range = lastCall![1] as { startMin: number; endMin: number };
    expect(range.startMin).toBe(600);
    expect(range.endMin).toBeGreaterThan(960);
  });

  it('resize respects the 15-minute minimum duration floor', () => {
    const bar = makeBar({ leftMin: 600, endMin: 630 }); // 30-min shift
    const { onDraftChange } = renderBar({ bar });
    const endHandle = screen.getByTestId('resize-handle-end');

    fireEvent.pointerDown(endHandle, { pointerId: 1, clientX: 630, pointerType: 'mouse' });
    // Drag the end handle far to the left, well past the start — should clamp at a 15-min floor.
    fireEvent.pointerMove(endHandle, { pointerId: 1, clientX: 500, pointerType: 'mouse' });

    const lastCall = onDraftChange.mock.calls.at(-1);
    const range = lastCall![1] as { startMin: number; endMin: number };
    expect(range.endMin - range.startMin).toBe(15);
  });
});
