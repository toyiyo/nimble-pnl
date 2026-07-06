/**
 * timelineDraft — pure paint/drag math for the Timeline's paint-to-create
 * gesture (Stage C) and quick-add draft prefill.
 *
 * Everything here is a pure function: no DOM access, no React, no mutation of
 * inputs. Callers (the future lane paint layer) own the pointer-event
 * wiring and simply feed `clientX`/rects/window through these helpers.
 */
import { STEP_MIN, type TimelineWindow } from '@/lib/timelineModel';
import { snapToStep, minutesToIso, minutesToHHMM } from '@/lib/shiftTimeMath';
import type { TimelineShiftEditorValues } from '@/components/scheduling/ShiftTimeline/TimelineShiftEditor';
import type { Shift } from '@/types/scheduling';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Minimum paint-drag duration, in minutes (also the snap step). */
export const MIN_PAINT_DURATION_MIN = STEP_MIN;

/** Default duration (minutes) dropped by a plain click (no drag). */
export const DEFAULT_CLICK_DURATION_MIN = 120;

/** Pointer movement (px) below which a pointerup is treated as a click, not a drag. */
export const CLICK_DRAG_THRESHOLD_PX = 5;

// ─── pointerToMinutes ──────────────────────────────────────────────────────────

/**
 * Inverse of the timeline's `minToPct` mapping: converts a pointer's
 * viewport `clientX` into restaurant-local minutes-since-midnight, given the
 * plot region's bounding rect and the visible time window.
 *
 * Clamped to `[window.startMin, window.endMin]`. Guards against a zero-width
 * rect (not yet laid out) by returning `window.startMin` rather than NaN.
 */
export function pointerToMinutes(clientX: number, plotRect: DOMRect, window: TimelineWindow): number {
  const { startMin, endMin } = window;
  if (plotRect.width <= 0) return startMin;

  const pct = (clientX - plotRect.left) / plotRect.width;
  const clampedPct = Math.min(1, Math.max(0, pct));
  return startMin + clampedPct * (endMin - startMin);
}

// ─── Paint reducer ─────────────────────────────────────────────────────────────

export interface PaintDraft {
  /** The snapped minute where the paint gesture began; the range's fixed edge. */
  anchorMin: number;
  startMin: number;
  endMin: number;
  /** Raw (unsnapped) pointer minute at pointerdown — retained for reference/debugging. */
  pointerDownMin: number;
  /** Total pixel movement since pointerdown (for click-vs-drag disambiguation). */
  movedPx: number;
}

function clampToWindow(min: number, window: TimelineWindow): number {
  return Math.min(window.endMin, Math.max(window.startMin, min));
}

/**
 * Start a paint gesture. The anchor is clamped into the window and snapped to
 * `STEP_MIN`; the draft initially has zero duration at the anchor.
 */
export function beginPaint(pointerMin: number, window: TimelineWindow): PaintDraft {
  const anchorMin = snapToStep(clampToWindow(pointerMin, window));
  return {
    anchorMin,
    startMin: anchorMin,
    endMin: anchorMin,
    pointerDownMin: pointerMin,
    movedPx: 0,
  };
}

/**
 * Update an in-progress paint draft as the pointer moves. The anchor stays
 * fixed; the moving edge snaps to `STEP_MIN`, is clamped to the window, and a
 * minimum duration of `MIN_PAINT_DURATION_MIN` is enforced (extending away
 * from the anchor, staying inside the window) so a barely-moved drag never
 * collapses to zero width.
 */
export function updatePaint(
  draft: PaintDraft,
  pointerMin: number,
  window: TimelineWindow,
  movedPx: number,
): PaintDraft {
  const { anchorMin } = draft;
  const rawMoving = snapToStep(clampToWindow(pointerMin, window));

  let startMin: number;
  let endMin: number;

  if (rawMoving >= anchorMin) {
    startMin = anchorMin;
    endMin = rawMoving;
    if (endMin - startMin < MIN_PAINT_DURATION_MIN) {
      endMin = clampToWindow(startMin + MIN_PAINT_DURATION_MIN, window);
      startMin = endMin - MIN_PAINT_DURATION_MIN;
    }
  } else {
    endMin = anchorMin;
    startMin = rawMoving;
    if (endMin - startMin < MIN_PAINT_DURATION_MIN) {
      startMin = clampToWindow(endMin - MIN_PAINT_DURATION_MIN, window);
      endMin = startMin + MIN_PAINT_DURATION_MIN;
    }
  }

  return {
    ...draft,
    startMin,
    endMin,
    movedPx,
  };
}

export interface PaintRange {
  startMin: number;
  endMin: number;
}

/**
 * Finalize a paint gesture into a committed `{startMin, endMin}` range.
 *
 * - A real drag (movement past `CLICK_DRAG_THRESHOLD_PX`) keeps the
 *   already-snapped/clamped range from `updatePaint` as-is.
 * - A plain click (movement below the threshold) instead drops a default
 *   `DEFAULT_CLICK_DURATION_MIN` range anchored at the snapped click point,
 *   clamped to the window (pulling the start back if the default would
 *   overflow the window's end), falling back to the window's own span if
 *   it's shorter than the default duration.
 */
export function endPaint(draft: PaintDraft, window: TimelineWindow): PaintRange {
  if (draft.movedPx >= CLICK_DRAG_THRESHOLD_PX) {
    return { startMin: draft.startMin, endMin: draft.endMin };
  }

  const windowSpan = window.endMin - window.startMin;
  const duration = Math.min(DEFAULT_CLICK_DURATION_MIN, windowSpan);

  let startMin = draft.anchorMin;
  let endMin = startMin + duration;

  if (endMin > window.endMin) {
    endMin = window.endMin;
    startMin = endMin - duration;
  }
  if (startMin < window.startMin) {
    startMin = window.startMin;
    endMin = startMin + duration;
  }

  return { startMin, endMin };
}

// ─── Draft-shift builder ────────────────────────────────────────────────────────

export interface DraftShiftValues extends TimelineShiftEditorValues {
  /** Prefilled position, derived from lane context (blank for gap-click entry, no lane). */
  position: string;
}

export interface BuildDraftShiftOptions {
  /** Lane context (position/area) the paint gesture occurred in, if any. */
  laneContext?: { position?: string | null; area?: string | null };
  /** Optional employee to prefill (rarely used; most entry points leave this blank). */
  defaultEmployeeId?: string;
}

/**
 * Build the initial `TimelineShiftEditorValues` (+ prefilled `position`) for
 * a freshly-painted draft shift, given its committed minute range and
 * optional lane context. Pure — does not touch employee ranking (that's
 * `rankEmployeesForShift`'s job once the editor renders).
 */
export function buildDraftShiftValues(
  range: PaintRange,
  options: BuildDraftShiftOptions = {},
): DraftShiftValues {
  return {
    employeeId: options.defaultEmployeeId ?? '',
    startTime: minutesToHHMM(range.startMin),
    endTime: minutesToHHMM(range.endMin),
    breakDuration: '',
    notes: '',
    position: options.laneContext?.position ?? '',
  };
}

// ─── Drag-draft merge (Stage D2 — live coverage feedback) ──────────────────────

/** An in-flight drag-move/resize draft for a single existing shift. */
export interface DragShiftDraft {
  /** The id of the shift being dragged — used to find and replace it in `dayShifts`. */
  shiftId: string;
  /** Drafted restaurant-local minutes-since-midnight (may exceed 1440 for overnight bars). */
  startMin: number;
  endMin: number;
}

/**
 * Merge an in-flight drag draft into the day's shifts, replacing the dragged
 * shift's `start_time`/`end_time` with the drafted (moved/resized) minutes —
 * converted back to UTC ISO via `minutesToIso` so the merged array is a valid
 * `Shift[]` that `buildTimelineModel` can consume unchanged. All other shifts
 * pass through untouched (same object references, so `React.memo` comparators
 * keyed on shift identity/geometry skip re-rendering unaffected rows).
 *
 * Pure — does not mutate `dayShifts` or any shift within it. If `draft` is
 * null, or its `shiftId` isn't present in `dayShifts` (e.g. a stale draft
 * surviving a day switch), the original array is returned unchanged so a
 * dangling draft can never inject a phantom shift into the model.
 */
export function mergeDraftShift(
  dayShifts: Shift[],
  draft: DragShiftDraft | null,
  dateStr: string,
  tz: string,
): Shift[] {
  if (!draft) return dayShifts;

  const index = dayShifts.findIndex((s) => s.id === draft.shiftId);
  if (index === -1) return dayShifts;

  const original = dayShifts[index];
  const draftedShift: Shift = {
    ...original,
    start_time: minutesToIso(dateStr, draft.startMin, tz),
    end_time: minutesToIso(dateStr, draft.endMin, tz),
  };

  const merged = dayShifts.slice();
  merged[index] = draftedShift;
  return merged;
}
