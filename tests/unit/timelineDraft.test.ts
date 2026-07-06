import { describe, it, expect } from 'vitest';
import {
  pointerToMinutes,
  beginPaint,
  updatePaint,
  endPaint,
  buildDraftShiftValues,
  MIN_PAINT_DURATION_MIN,
  DEFAULT_CLICK_DURATION_MIN,
  CLICK_DRAG_THRESHOLD_PX,
} from '@/lib/timelineDraft';
import type { TimelineWindow } from '@/lib/timelineModel';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const WINDOW: TimelineWindow = { startMin: 600, endMin: 1380 }; // 10:00–23:00, 780 min span

function plotRect(left = 100, width = 780): DOMRect {
  return {
    left,
    width,
    top: 0,
    height: 0,
    right: left + width,
    bottom: 0,
    x: left,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect;
}

// ---------------------------------------------------------------------------
// pointerToMinutes — pixel → restaurant-local minutes (inverse of minToPct)
// ---------------------------------------------------------------------------

describe('pointerToMinutes', () => {
  it('maps the left edge of the plot to window.startMin', () => {
    const rect = plotRect(100, 780);
    expect(pointerToMinutes(100, rect, WINDOW)).toBe(600);
  });

  it('maps the right edge of the plot to window.endMin', () => {
    const rect = plotRect(100, 780);
    expect(pointerToMinutes(880, rect, WINDOW)).toBe(1380);
  });

  it('maps the midpoint of the plot to the midpoint of the window', () => {
    const rect = plotRect(100, 780);
    expect(pointerToMinutes(100 + 390, rect, WINDOW)).toBe(990); // 600 + 780/2
  });

  it('is a linear inverse of the minToPct mapping used elsewhere in the timeline', () => {
    // minToPct(min) = (min - startMin) / (endMin - startMin) * 100
    // pointerToMinutes should invert that using clientX instead of a percent.
    const rect = plotRect(0, 1000);
    const min = pointerToMinutes(250, rect, WINDOW); // 25% across
    expect(min).toBe(WINDOW.startMin + 0.25 * (WINDOW.endMin - WINDOW.startMin));
  });

  it('clamps to window.startMin when clientX is left of the plot', () => {
    const rect = plotRect(100, 780);
    expect(pointerToMinutes(0, rect, WINDOW)).toBe(600);
  });

  it('clamps to window.endMin when clientX is right of the plot', () => {
    const rect = plotRect(100, 780);
    expect(pointerToMinutes(10000, rect, WINDOW)).toBe(1380);
  });

  it('returns window.startMin for a zero-width plot rect (no div-by-zero NaN)', () => {
    const rect = plotRect(100, 0);
    expect(pointerToMinutes(100, rect, WINDOW)).toBe(600);
  });
});

// ---------------------------------------------------------------------------
// beginPaint / updatePaint / endPaint — drag reducer with snap + min duration
// ---------------------------------------------------------------------------

describe('beginPaint', () => {
  it('starts a paint draft anchored at the snapped pointer minute', () => {
    const draft = beginPaint(607, WINDOW); // snaps to 600 (nearest 15)
    expect(draft).toEqual({
      anchorMin: 600,
      startMin: 600,
      endMin: 600,
      pointerDownMin: 607,
      movedPx: 0,
    });
  });

  it('clamps the anchor into the window before snapping', () => {
    const draft = beginPaint(1400, WINDOW); // beyond endMin=1380
    expect(draft.anchorMin).toBe(1380);
  });
});

describe('updatePaint', () => {
  it('extends the draft forward from the anchor as the pointer moves right', () => {
    const draft = beginPaint(600, WINDOW);
    const updated = updatePaint(draft, 700, WINDOW, 50);
    expect(updated.startMin).toBe(600);
    expect(updated.endMin).toBe(705); // 705 snaps to nearest 15 -> 705
    expect(updated.movedPx).toBe(50);
  });

  it('snaps the moving edge to the nearest 15-minute step', () => {
    const draft = beginPaint(600, WINDOW);
    const updated = updatePaint(draft, 706, WINDOW, 20); // 706 -> snaps to 705
    expect(updated.endMin).toBe(705);
  });

  it('extends the draft backward (startMin moves) when dragging left of the anchor', () => {
    const draft = beginPaint(900, WINDOW);
    const updated = updatePaint(draft, 795, WINDOW, 100); // 795 is already on a 15-min boundary
    expect(updated.startMin).toBe(795);
    expect(updated.endMin).toBe(900);
  });

  it('enforces the minimum 15-minute duration when the pointer barely moves', () => {
    const draft = beginPaint(600, WINDOW);
    const updated = updatePaint(draft, 605, WINDOW, 5); // snaps to 600, same as anchor
    expect(updated.endMin - updated.startMin).toBe(MIN_PAINT_DURATION_MIN);
    expect(updated.startMin).toBe(600);
    expect(updated.endMin).toBe(615);
  });

  it('enforces the minimum duration on the backward side too', () => {
    const draft = beginPaint(600, WINDOW);
    // Try to drag left of the window start — anchor is already at window edge.
    const updated = updatePaint(draft, 590, WINDOW, 10);
    expect(updated.endMin - updated.startMin).toBe(MIN_PAINT_DURATION_MIN);
  });

  it('clamps the moving edge to the window bounds', () => {
    const draft = beginPaint(600, WINDOW);
    const updated = updatePaint(draft, 5000, WINDOW, 500);
    expect(updated.endMin).toBe(1380);
  });
});

describe('endPaint', () => {
  it('returns the final {startMin, endMin} range for a real drag (moved past the click threshold)', () => {
    const draft = beginPaint(600, WINDOW);
    const updated = updatePaint(draft, 700, WINDOW, 50);
    const result = endPaint(updated, WINDOW);
    expect(result).toEqual({ startMin: 600, endMin: 705 });
  });

  it('drops a default 2-hour range at the snapped point for a plain click (< 5px movement)', () => {
    const draft = beginPaint(607, WINDOW); // snaps to 600
    const clicked = updatePaint(draft, 608, WINDOW, 1); // negligible movement
    const result = endPaint(clicked, WINDOW);
    expect(result).toEqual({ startMin: 600, endMin: 600 + DEFAULT_CLICK_DURATION_MIN });
  });

  it('uses the click-drag threshold constant to distinguish click vs drag', () => {
    expect(CLICK_DRAG_THRESHOLD_PX).toBe(5);
  });

  it('clamps the default click duration to the window when anchored near the end', () => {
    const draft = beginPaint(1380, WINDOW); // anchored at window end
    const clicked = updatePaint(draft, 1381, WINDOW, 0);
    const result = endPaint(clicked, WINDOW);
    // 1380 + 120 would overflow the window end (1380); clamp end to 1380 and
    // pull start back so the 2h duration is preserved when possible.
    expect(result.endMin).toBe(1380);
    expect(result.startMin).toBe(1380 - DEFAULT_CLICK_DURATION_MIN);
  });

  it('falls back to the minimum duration when the window itself is shorter than the default click duration', () => {
    const tinyWindow: TimelineWindow = { startMin: 600, endMin: 630 }; // 30 min span
    const draft = beginPaint(600, tinyWindow);
    const clicked = updatePaint(draft, 601, tinyWindow, 0);
    const result = endPaint(clicked, tinyWindow);
    expect(result.startMin).toBe(600);
    expect(result.endMin).toBe(630);
  });
});

// ---------------------------------------------------------------------------
// buildDraftShiftValues — lane context → prefilled editor values
// ---------------------------------------------------------------------------

describe('buildDraftShiftValues', () => {
  it('formats a same-day range as HH:MM start/end times', () => {
    const values = buildDraftShiftValues({ startMin: 600, endMin: 720 }); // 10:00-12:00
    expect(values.startTime).toBe('10:00');
    expect(values.endTime).toBe('12:00');
  });

  it('wraps an overnight endMin (>= 1440) into HH:MM-of-day for the end time field', () => {
    const values = buildDraftShiftValues({ startMin: 1410, endMin: 1470 }); // 23:30-00:30(+1)
    expect(values.startTime).toBe('23:30');
    expect(values.endTime).toBe('00:30');
  });

  it('defaults employeeId, breakDuration, and notes to empty', () => {
    const values = buildDraftShiftValues({ startMin: 600, endMin: 720 });
    expect(values.employeeId).toBe('');
    expect(values.breakDuration).toBe('');
    expect(values.notes).toBe('');
  });

  it('passes through an explicit lane-context position when grouped by position', () => {
    const values = buildDraftShiftValues(
      { startMin: 600, endMin: 720 },
      { laneContext: { position: 'Server', area: null } },
    );
    expect(values.position).toBe('Server');
  });

  it('leaves position blank when no lane context is supplied (gap-click entry point)', () => {
    const values = buildDraftShiftValues({ startMin: 600, endMin: 720 });
    expect(values.position).toBe('');
  });

  it('prefills employeeId when an explicit default employee is supplied', () => {
    const values = buildDraftShiftValues(
      { startMin: 600, endMin: 720 },
      { defaultEmployeeId: 'emp-1' },
    );
    expect(values.employeeId).toBe('emp-1');
  });
});
