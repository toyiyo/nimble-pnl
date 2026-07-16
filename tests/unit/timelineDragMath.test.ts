/**
 * Unit tests for the pure drag-move/edge-resize reducers (Stage D1) that power
 * `useTimelineBarDrag`. These are the pixel/minute math the pointer hook calls
 * on every rAF-throttled pointermove; the hook itself wires DOM pointer events
 * and is covered by component tests where jsdom allows.
 *
 * Move preserves duration; resize enforces a 15-min floor; both snap to
 * STEP_MIN and clamp into the visible window (including overnight bars whose
 * endMin already exceeds 1440).
 */
import { describe, it, expect } from 'vitest';
import {
  moveShiftDraft,
  resizeShiftStart,
  resizeShiftEnd,
  MIN_SHIFT_DURATION_MIN,
} from '@/lib/timelineDragMath';
import type { TimelineWindow } from '@/lib/timelineModel';

const WINDOW: TimelineWindow = { startMin: 600, endMin: 1380 }; // 10:00–23:00

// ---------------------------------------------------------------------------
// moveShiftDraft — body drag, preserves duration
// ---------------------------------------------------------------------------

describe('moveShiftDraft', () => {
  it('shifts both edges by the same snapped delta, preserving duration', () => {
    // Original bar 660-780 (11:00-13:00, 120 min). Grabbed at pointer 660 (bar start),
    // dragged to pointer 700 -> delta 40, snaps to 45 (nearest 15 to 40... actually 40 rounds to 45? 40/15=2.67->3*15=45)
    const result = moveShiftDraft(
      { startMin: 660, endMin: 780 },
      { grabPointerMin: 660, currentPointerMin: 700 },
      WINDOW,
    );
    // delta = 700 - 660 = 40, snapped to nearest 15 -> 45
    expect(result).toEqual({ startMin: 705, endMin: 825 });
  });

  it('preserves duration exactly regardless of delta', () => {
    const original = { startMin: 660, endMin: 900 }; // 240 min duration
    const result = moveShiftDraft(
      original,
      { grabPointerMin: 660, currentPointerMin: 750 },
      WINDOW,
    );
    expect(result.endMin - result.startMin).toBe(240);
  });

  it('snaps the delta to STEP_MIN (15)', () => {
    const result = moveShiftDraft(
      { startMin: 660, endMin: 780 },
      { grabPointerMin: 660, currentPointerMin: 667 }, // delta 7 -> snaps to 0
      WINDOW,
    );
    expect(result).toEqual({ startMin: 660, endMin: 780 });
  });

  it('clamps so the moved bar never starts before window.startMin', () => {
    const result = moveShiftDraft(
      { startMin: 615, endMin: 735 }, // 120 min duration, near window start
      { grabPointerMin: 615, currentPointerMin: 300 }, // large leftward drag
      WINDOW,
    );
    expect(result.startMin).toBe(WINDOW.startMin);
    expect(result.endMin - result.startMin).toBe(120);
  });

  it('clamps so the moved bar never ends after window.endMin', () => {
    const result = moveShiftDraft(
      { startMin: 1200, endMin: 1320 }, // 120 min duration
      { grabPointerMin: 1200, currentPointerMin: 2000 }, // large rightward drag
      WINDOW,
    );
    expect(result.endMin).toBe(WINDOW.endMin);
    expect(result.endMin - result.startMin).toBe(120);
  });

  it('keeps the result within [window.startMin, window.endMin] when duration exceeds the window span (sequential clamps must not fight)', () => {
    // Regression test: original span is 800 min, wider than the 780-min
    // visible window. Sequentially clamping startMin-then-endMin (or vice
    // versa) can push startMin below window.startMin because each clamp
    // re-derives the other edge from the fixed `duration`, which no longer
    // fits inside the window. The oversized-duration case must be handled
    // first by snapping the whole range to the window's bounds.
    const original = { startMin: 600, endMin: 1400 }; // 800 min duration > 780 min window span
    const result = moveShiftDraft(
      original,
      { grabPointerMin: 600, currentPointerMin: 600 },
      WINDOW,
    );
    expect(result.startMin).toBeGreaterThanOrEqual(WINDOW.startMin);
    expect(result.endMin).toBeLessThanOrEqual(WINDOW.endMin);
    expect(result.startMin).toBe(WINDOW.startMin);
    expect(result.endMin).toBe(WINDOW.endMin);
  });

  it('allows an overnight bar (endMin > 1440) to be dragged within an overnight window', () => {
    const overnightWindow: TimelineWindow = { startMin: 1200, endMin: 1800 }; // 20:00-06:00 next day
    const result = moveShiftDraft(
      { startMin: 1320, endMin: 1620 }, // 22:00-02:00, 300 min duration
      { grabPointerMin: 1320, currentPointerMin: 1380 }, // delta 60
      overnightWindow,
    );
    expect(result).toEqual({ startMin: 1380, endMin: 1680 });
  });
});

// ---------------------------------------------------------------------------
// resizeShiftStart — left edge handle, keeps endMin fixed
// ---------------------------------------------------------------------------

describe('resizeShiftStart', () => {
  it('moves the start edge to the snapped pointer minute', () => {
    const result = resizeShiftStart({ startMin: 660, endMin: 780 }, 690, WINDOW);
    expect(result).toEqual({ startMin: 690, endMin: 780 });
  });

  it('snaps the pointer minute to STEP_MIN', () => {
    const result = resizeShiftStart({ startMin: 660, endMin: 780 }, 697, WINDOW); // snaps to 690 (697/15=46.47->46*15=690... let's verify)
    expect(result.startMin % 15).toBe(0);
  });

  it('enforces the 15-min minimum duration floor (cannot cross past endMin - 15)', () => {
    const result = resizeShiftStart({ startMin: 660, endMin: 780 }, 900, WINDOW); // dragging start past end
    expect(result.endMin - result.startMin).toBe(MIN_SHIFT_DURATION_MIN);
    expect(result.startMin).toBe(780 - MIN_SHIFT_DURATION_MIN);
  });

  it('clamps the start edge to window.startMin', () => {
    const result = resizeShiftStart({ startMin: 660, endMin: 780 }, 0, WINDOW);
    expect(result.startMin).toBe(WINDOW.startMin);
    expect(result.endMin).toBe(780);
  });

  it('does not move endMin', () => {
    const result = resizeShiftStart({ startMin: 660, endMin: 780 }, 690, WINDOW);
    expect(result.endMin).toBe(780);
  });
});

// ---------------------------------------------------------------------------
// resizeShiftEnd — right edge handle, keeps startMin fixed
// ---------------------------------------------------------------------------

describe('resizeShiftEnd', () => {
  it('moves the end edge to the snapped pointer minute', () => {
    const result = resizeShiftEnd({ startMin: 660, endMin: 780 }, 810, WINDOW);
    expect(result).toEqual({ startMin: 660, endMin: 810 });
  });

  it('enforces the 15-min minimum duration floor (cannot cross before startMin + 15)', () => {
    const result = resizeShiftEnd({ startMin: 660, endMin: 780 }, 500, WINDOW); // dragging end before start
    expect(result.endMin - result.startMin).toBe(MIN_SHIFT_DURATION_MIN);
    expect(result.startMin).toBe(660);
    expect(result.endMin).toBe(660 + MIN_SHIFT_DURATION_MIN);
  });

  it('clamps the end edge to window.endMin', () => {
    const result = resizeShiftEnd({ startMin: 660, endMin: 780 }, 5000, WINDOW);
    expect(result.endMin).toBe(WINDOW.endMin);
    expect(result.startMin).toBe(660);
  });

  it('does not move startMin', () => {
    const result = resizeShiftEnd({ startMin: 660, endMin: 780 }, 810, WINDOW);
    expect(result.startMin).toBe(660);
  });

  it('allows extending an overnight bar past 1440 within an overnight window', () => {
    const overnightWindow: TimelineWindow = { startMin: 1200, endMin: 1800 };
    const result = resizeShiftEnd({ startMin: 1320, endMin: 1500 }, 1560, overnightWindow);
    expect(result).toEqual({ startMin: 1320, endMin: 1560 });
  });
});
