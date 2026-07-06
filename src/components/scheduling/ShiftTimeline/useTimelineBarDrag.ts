import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { pointerToMinutes } from '@/lib/timelineDraft';
import { moveShiftDraft, resizeShiftStart, resizeShiftEnd, type ShiftMinuteRange } from '@/lib/timelineDragMath';
import type { TimelineWindow } from '@/lib/timelineModel';

/** Which part of the bar a gesture is manipulating. */
export type DragMode = 'move' | 'resize-start' | 'resize-end';

export interface BarDragState {
  mode: DragMode;
  startMin: number;
  endMin: number;
}

interface UseTimelineBarDragOptions {
  /** The bar's current (committed) minute range — the drag's baseline. */
  original: ShiftMinuteRange;
  /** True when the shift is locked; disables all drag/resize gestures. */
  locked: boolean;
  /** Returns the plot region's bounding rect, read fresh on every pointer event. */
  getPlotRect: () => DOMRect | null;
  /** Returns the current visible window, read fresh on every pointer event (never a stale closure). */
  getWindow: () => TimelineWindow;
  /**
   * Called on every rAF-throttled frame while dragging, with the live drafted
   * range (for D2's live coverage merge). Called with `null` when the drag
   * ends or is cancelled.
   */
  onDraftChange: (range: ShiftMinuteRange | null) => void;
  /** Called on pointerup with the final drafted range — the caller commits it. */
  onCommit: (range: ShiftMinuteRange) => void;
}

/** Pointer movement (px) below which a pointerup is treated as a click, not a drag. */
const DRAG_THRESHOLD_PX = 5;

/**
 * Pointer-driven drag-move / edge-resize gesture for a single `TimelineBar`.
 *
 * - Body drag = move (duration preserved); edge handles = resize (15-min
 *   floor). All edges snap to `STEP_MIN` via the pure reducers in
 *   `timelineDragMath`.
 * - `setPointerCapture` is used so the gesture keeps receiving move/up events
 *   even if the pointer leaves the bar's bounding box mid-drag.
 * - Click-vs-drag: a pointerdown+up sequence with movement below
 *   `DRAG_THRESHOLD_PX` is treated as a tap, not a drag — `onCommit` is never
 *   called and no draft is ever produced. Tap-to-edit is left entirely to the
 *   bar's native `<button onClick>` (this hook never calls `onSelect`
 *   itself), so a real click event — from a mouse click, a tap, or keyboard
 *   Enter/Space — always reaches it exactly once.
 * - Suppressing the post-drag synthetic click (Codex P2 fix): a past-threshold
 *   drag sets a one-shot flag, read via the returned `consumeJustDragged()`.
 *   The caller (`TimelineBar`) must call it from its own `onClick` handler and
 *   skip forwarding to `onSelect` when it returns true — otherwise the
 *   trailing `click` the browser dispatches after the drag's pointerup would
 *   reopen the edit popover right after every drag.
 * - Touch (`pointerType === 'touch'`) never drags: pointerdown on touch is a
 *   no-op here (the bar's own `onClick` handles the tap-to-edit path via the
 *   browser's native click synthesis), so the popover is the only way to
 *   change times on a touch device.
 * - Stale-closure discipline: `getPlotRect`/`getWindow` are called fresh on
 *   every pointermove rather than closed over at pointerdown, since the
 *   window/geometry can change while a drag is in flight (lesson 2026-06-04).
 * - rAF throttle: draft-state commits (both the `onDraftChange` callback and
 *   this hook's own `dragState` for the floating time readout) happen at most
 *   once per animation frame, never per raw pointermove.
 * - Unmount cleanup: any in-flight rAF handle is cancelled on unmount so no
 *   frame callback fires (and calls setState) after the owning component is
 *   gone.
 */
export function useTimelineBarDrag({
  original,
  locked,
  getPlotRect,
  getWindow,
  onDraftChange,
  onCommit,
}: UseTimelineBarDragOptions) {
  const [dragState, setDragState] = useState<BarDragState | null>(null);

  // Refs so the pointer-capture handlers (registered once per gesture, at
  // pointerdown) always read the latest values rather than a stale closure
  // from the render that started the gesture (lesson 2026-06-04).
  const originalRef = useRef(original);
  originalRef.current = original;
  const onDraftChangeRef = useRef(onDraftChange);
  onDraftChangeRef.current = onDraftChange;
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;

  const gestureRef = useRef<{
    mode: DragMode;
    pointerId: number;
    grabPointerMin: number;
    grabClientX: number;
    movedPx: number;
    lastClientX: number;
    rafHandle: number | null;
    latestRange: ShiftMinuteRange;
  } | null>(null);

  // Set for exactly one trailing click after a real (past-threshold) drag
  // commits, so the caller can skip that browser-synthesized click instead of
  // reopening the edit popover via onSelect. `consumeJustDragged` clears the
  // flag as soon as it's read, so it only ever suppresses a single click.
  const justDraggedRef = useRef(false);

  const consumeJustDragged = useCallback(() => {
    const was = justDraggedRef.current;
    justDraggedRef.current = false;
    return was;
  }, []);

  const computeRange = useCallback((mode: DragMode, clientX: number): ShiftMinuteRange | null => {
    const rect = getPlotRect();
    if (!rect) return null;
    const window = getWindow();
    const pointerMin = pointerToMinutes(clientX, rect, window);
    const base = originalRef.current;
    const gesture = gestureRef.current;

    if (mode === 'move') {
      const grabPointerMin = gesture?.grabPointerMin ?? pointerMin;
      return moveShiftDraft(base, { grabPointerMin, currentPointerMin: pointerMin }, window);
    }
    if (mode === 'resize-start') {
      return resizeShiftStart(base, pointerMin, window);
    }
    return resizeShiftEnd(base, pointerMin, window);
  }, [getPlotRect, getWindow]);

  const scheduleFrame = useCallback(() => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.rafHandle !== null) return;
    gesture.rafHandle = requestAnimationFrame(() => {
      const g = gestureRef.current;
      if (!g) return;
      g.rafHandle = null;
      const range = computeRange(g.mode, g.lastClientX);
      if (!range) return;
      g.latestRange = range;
      setDragState({ mode: g.mode, startMin: range.startMin, endMin: range.endMin });
      onDraftChangeRef.current(range);
    });
  }, [computeRange]);

  const endGesture = useCallback((event: { pointerId: number; currentTarget: unknown }) => {
    const gesture = gestureRef.current;
    if (!gesture) return;

    if (gesture.rafHandle !== null) {
      cancelAnimationFrame(gesture.rafHandle);
      gesture.rafHandle = null;
    }

    const target = event.currentTarget as { releasePointerCapture?: (id: number) => void } | null;
    target?.releasePointerCapture?.(gesture.pointerId);

    // gesture.latestRange is only updated inside the rAF callback
    // (scheduleFrame) — if pointerup arrives before that frame has run (a
    // fast drag, or any pointerup dispatched with no intervening animation
    // frame), latestRange would still be the untouched original range even
    // though the pointer clearly moved past the drag threshold. Recompute
    // synchronously from the last known pointer position — BEFORE clearing
    // gestureRef, since computeRange reads gestureRef.current.grabPointerMin
    // as its move-delta baseline — so the commit always reflects where the
    // pointer actually ended up.
    const finalRange = computeRange(gesture.mode, gesture.lastClientX) ?? gesture.latestRange;

    gestureRef.current = null;
    setDragState(null);
    onDraftChangeRef.current(null);

    // Sub-threshold movement is a tap, not a drag: leave it to the bar's
    // native onClick (fired by the browser after this pointerup) rather than
    // calling onSelect ourselves, which would double-fire it.
    if (gesture.movedPx < DRAG_THRESHOLD_PX) return;

    // Past-threshold: a real drag. The browser still dispatches a trailing
    // `click` on the bar after this pointerup — flag it so the caller's
    // onClick handler can skip forwarding that one click to onSelect
    // (otherwise every drag would also reopen the edit popover).
    justDraggedRef.current = true;

    onCommitRef.current(finalRange);
  }, [computeRange]);

  const makePointerDownHandler = useCallback(
    (mode: DragMode) => (event: React.PointerEvent<HTMLElement>) => {
      if (locked) return;
      // Touch never drags — a tap opens the popover via the bar's own onClick;
      // every drag outcome is reachable through the popover's time fields.
      if (event.pointerType === 'touch') return;

      event.stopPropagation();

      const rect = getPlotRect();
      const window = getWindow();
      const grabPointerMin = rect ? pointerToMinutes(event.clientX, rect, window) : 0;

      gestureRef.current = {
        mode,
        pointerId: event.pointerId,
        grabPointerMin,
        grabClientX: event.clientX,
        movedPx: 0,
        lastClientX: event.clientX,
        rafHandle: null,
        latestRange: originalRef.current,
      };

      (event.currentTarget as unknown as { setPointerCapture?: (id: number) => void })
        .setPointerCapture?.(event.pointerId);
    },
    [locked, getPlotRect, getWindow],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const gesture = gestureRef.current;
      if (!gesture || gesture.pointerId !== event.pointerId) return;

      // Track cumulative movement from the grab point (not per-event delta,
      // which can be 0 in some synthetic/test dispatches) for click-vs-drag
      // disambiguation.
      gesture.lastClientX = event.clientX;
      gesture.movedPx = Math.max(gesture.movedPx, Math.abs(event.clientX - gesture.grabClientX));

      scheduleFrame();
    },
    [scheduleFrame],
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const gesture = gestureRef.current;
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      endGesture(event);
    },
    [endGesture],
  );

  const handlePointerCancel = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const gesture = gestureRef.current;
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      // A cancelled gesture (e.g. browser-initiated) never commits — snap back
      // by clearing the draft without calling onCommit or onTap.
      if (gesture.rafHandle !== null) cancelAnimationFrame(gesture.rafHandle);
      const target = event.currentTarget as { releasePointerCapture?: (id: number) => void } | null;
      target?.releasePointerCapture?.(gesture.pointerId);
      gestureRef.current = null;
      setDragState(null);
      onDraftChangeRef.current(null);
    },
    [],
  );

  // Unmount cleanup: cancel any in-flight rAF so a frame never fires after
  // this hook's owner has unmounted (which would call setDragState on an
  // unmounted component and touch a stale gestureRef). Runs once, on
  // unmount only — deliberately not re-run per gesture start/end.
  useEffect(() => {
    return () => {
      if (gestureRef.current?.rafHandle != null) {
        cancelAnimationFrame(gestureRef.current.rafHandle);
      }
      gestureRef.current = null;
    };
  }, []);

  return useMemo(
    () => ({
      dragState,
      handleBodyPointerDown: makePointerDownHandler('move'),
      handleStartHandlePointerDown: makePointerDownHandler('resize-start'),
      handleEndHandlePointerDown: makePointerDownHandler('resize-end'),
      handlePointerMove,
      handlePointerUp,
      handlePointerCancel,
      consumeJustDragged,
    }),
    [dragState, makePointerDownHandler, handlePointerMove, handlePointerUp, handlePointerCancel, consumeJustDragged],
  );
}
