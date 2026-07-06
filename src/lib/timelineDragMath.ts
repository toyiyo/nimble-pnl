/**
 * timelineDragMath — pure move/edge-resize reducers for the Timeline's
 * pointer-drag gesture (Stage D1). Sibling to `timelineDraft.ts`'s paint
 * reducers; kept in its own module because these operate on an *existing*
 * shift's minute range rather than a from-scratch paint gesture.
 *
 * Everything here is a pure function: no DOM access, no React. The
 * `useTimelineBarDrag` hook owns pointer-event wiring and feeds
 * clientX-derived minute values through these helpers on a rAF cadence.
 */
import { STEP_MIN, type TimelineWindow } from '@/lib/timelineModel';
import { snapToStep } from '@/lib/shiftTimeMath';

/** Minimum shift duration enforced by edge-resize, in minutes (also the snap step). */
export const MIN_SHIFT_DURATION_MIN = STEP_MIN;

export interface ShiftMinuteRange {
  startMin: number;
  endMin: number;
}

function clampToWindow(min: number, window: TimelineWindow): number {
  return Math.min(window.endMin, Math.max(window.startMin, min));
}

// ─── Move (body drag) ──────────────────────────────────────────────────────────

export interface MovePointerState {
  /** The restaurant-local minute under the pointer at the moment the drag began. */
  grabPointerMin: number;
  /** The restaurant-local minute under the pointer right now. */
  currentPointerMin: number;
}

/**
 * Body-drag reducer: shifts both edges of `original` by the same
 * snapped delta, preserving duration exactly. The delta (currentPointerMin -
 * grabPointerMin) is snapped to `STEP_MIN` before being applied so the whole
 * bar moves in 15-min increments regardless of how far the raw pointer has
 * traveled. The result is clamped into `window` by sliding the whole range
 * (never truncating it), so duration is preserved even at the window edges.
 */
export function moveShiftDraft(
  original: ShiftMinuteRange,
  pointer: MovePointerState,
  window: TimelineWindow,
): ShiftMinuteRange {
  const duration = original.endMin - original.startMin;
  const rawDelta = pointer.currentPointerMin - pointer.grabPointerMin;
  const snappedDelta = snapToStep(rawDelta);

  let startMin = original.startMin + snappedDelta;
  let endMin = startMin + duration;

  if (startMin < window.startMin) {
    startMin = window.startMin;
    endMin = startMin + duration;
  }
  if (endMin > window.endMin) {
    endMin = window.endMin;
    startMin = endMin - duration;
  }

  return { startMin, endMin };
}

// ─── Resize (edge handles) ──────────────────────────────────────────────────────

/**
 * Left-edge resize reducer: moves `startMin` to the snapped pointer minute,
 * keeping `endMin` fixed. Enforces `MIN_SHIFT_DURATION_MIN` by refusing to let
 * `startMin` cross past `endMin - MIN_SHIFT_DURATION_MIN`, and clamps to
 * `window.startMin`.
 */
export function resizeShiftStart(
  original: ShiftMinuteRange,
  pointerMin: number,
  window: TimelineWindow,
): ShiftMinuteRange {
  const snapped = snapToStep(clampToWindow(pointerMin, window));
  const maxStart = original.endMin - MIN_SHIFT_DURATION_MIN;
  const startMin = Math.min(snapped, maxStart);
  return { startMin, endMin: original.endMin };
}

/**
 * Right-edge resize reducer: moves `endMin` to the snapped pointer minute,
 * keeping `startMin` fixed. Enforces `MIN_SHIFT_DURATION_MIN` by refusing to
 * let `endMin` cross before `startMin + MIN_SHIFT_DURATION_MIN`, and clamps
 * to `window.endMin`.
 */
export function resizeShiftEnd(
  original: ShiftMinuteRange,
  pointerMin: number,
  window: TimelineWindow,
): ShiftMinuteRange {
  const snapped = snapToStep(clampToWindow(pointerMin, window));
  const minEnd = original.startMin + MIN_SHIFT_DURATION_MIN;
  const endMin = Math.max(snapped, minEnd);
  return { startMin: original.startMin, endMin };
}
