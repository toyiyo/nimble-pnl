import { useRef, useState, useCallback, useMemo, memo } from 'react';

import type { TimelineLane as TimelineLaneModel } from './useTimelineModel';
import type { TimelineWindow } from '@/lib/timelineModel';
import type { Shift } from '@/types/scheduling';
import type { PaintDraft, PaintRange } from '@/lib/timelineDraft';
import { pointerToMinutes, beginPaint, updatePaint, endPaint, DEFAULT_CLICK_DURATION_MIN } from '@/lib/timelineDraft';
import type { ShiftMinuteRange } from '@/lib/timelineDragMath';
import { TimelineBar } from './TimelineBar';
import { cn } from '@/lib/utils';

/** Lane context passed to `onPaintCommit`, keyed by the lane's grouping value. */
export interface LanePaintContext {
  /** The lane's `key` (position or area value; empty string = unassigned). */
  key: string;
}

interface TimelineLaneProps {
  /** Lane data from useTimelineModel (label, hours, bars). */
  readonly lane: TimelineLaneModel;
  /** Maps a minute value to a horizontal percent within [0, 100]. */
  readonly minToPct: (min: number) => number;
  /** Visible time window — needed to invert pointer position back to minutes. */
  readonly window: TimelineWindow;
  /** Called when the user clicks a shift bar. */
  readonly onSelect: (shift: Shift) => void;
  /**
   * Called when a paint gesture (drag or click) on the lane's empty plot
   * region — or the visually-hidden "Add shift" button — commits a range.
   * The parent opens the quick-add popover with this range + lane context.
   */
  readonly onPaintCommit: (range: PaintRange, laneContext: LanePaintContext) => void;
  /** Forwarded to each `TimelineBar` — rAF-throttled live drag-draft updates (Stage D2). */
  readonly onBarDraftChange: (shiftId: string, range: ShiftMinuteRange | null) => void;
  /** Forwarded to each `TimelineBar` — fires on drag/resize release (Stage D3). */
  readonly onBarDragCommit: (shiftId: string, range: ShiftMinuteRange) => void;
  /**
   * The shift id that should render a transient change highlight, or null
   * (design doc §Fix 3). Forwarded to the matching `TimelineBar` as `highlighted`.
   */
  readonly highlightedShiftId?: string | null;
}

/** Height in pixels for each stacked bar row within a lane. */
const ROW_HEIGHT_PX = 28;

/** Touch long-press duration (ms) before painting starts, so a plain scroll gesture isn't hijacked. */
const LONG_PRESS_MS = 500;

/** Pointer movement (px) during the long-press wait that cancels it (treated as a scroll, not a hold). */
const LONG_PRESS_MOVE_CANCEL_PX = 10;

/**
 * A single area/position band in the timeline.
 *
 * Layout:
 *  - Sticky-left label column: section name · shift count · total hours.
 *  - Relative-positioned plot region whose height is `(maxRow + 1) × ROW_HEIGHT_PX`.
 *  - Each `TimelineBar` is placed at `top: bar.row × ROW_HEIGHT_PX`.
 *
 * Paint-to-create (Stage C2): pointer handlers on the plot region let a manager
 * drag out a ghost bar (mouse) or long-press-then-drag (touch, 500ms, so
 * horizontal scroll still works) to stage a new shift's time range. A plain
 * click/tap (no drag) drops a default-duration ghost at the snapped point. All
 * range math is delegated to the pure `timelineDraft` helpers — this component
 * only owns the DOM wiring + ghost rendering. Escape cancels an in-progress
 * paint. A visually-hidden "Add shift to <lane>" button gives keyboard users
 * the same entry point without any pointer gesture.
 */
function TimelineLaneImpl({
  lane,
  minToPct,
  window,
  onSelect,
  onPaintCommit,
  onBarDraftChange,
  onBarDragCommit,
  highlightedShiftId = null,
}: TimelineLaneProps) {
  const { label, hours, bars } = lane;
  const maxRow = bars.reduce((max, b) => Math.max(max, b.row), 0);
  const plotHeight = (maxRow + 1) * ROW_HEIGHT_PX;
  // Memoized so it's a stable dependency for the useCallback handlers below
  // (a fresh object literal on every render would force those handlers to be
  // recreated every render too, defeating useCallback's purpose here).
  const laneContext: LanePaintContext = useMemo(() => ({ key: lane.key }), [lane.key]);
  const displayLabel = label || 'Unassigned';

  const plotRef = useRef<HTMLDivElement>(null);
  // Stable callback (never recreated) so it's a safe prop for TimelineBar's
  // memo comparator — reads the ref fresh on every call, never a stale rect.
  const getPlotRect = useCallback(() => plotRef.current?.getBoundingClientRect() ?? null, []);
  const [draft, setDraft] = useState<PaintDraft | null>(null);
  // Refs so pointer handlers registered at pointerdown always read the latest
  // window/draft rather than a stale closure (lesson 2026-06-04).
  const windowRef = useRef(window);
  windowRef.current = window;
  const draftRef = useRef<PaintDraft | null>(null);
  draftRef.current = draft;
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tracks pointer-down clientX for BOTH mouse and touch gestures (renamed
  // from `touchStartRef`, which the touch long-press logic still uses to
  // detect a pre-long-press scroll) — `handlePointerMove` needs this for
  // EVERY pointer type to compute `movedPx` in pixels; using it only for
  // touch left mouse gestures with no baseline clientX to diff against.
  const pointerStartRef = useRef<{ clientX: number; pointerId: number } | null>(null);

  const clearLongPressTimer = useCallback(() => {
    if (longPressTimerRef.current !== null) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const startPaint = useCallback((clientX: number) => {
    const rect = plotRef.current?.getBoundingClientRect();
    if (!rect) return;
    const pointerMin = pointerToMinutes(clientX, rect, windowRef.current);
    setDraft(beginPaint(pointerMin, windowRef.current));
  }, []);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      // Only the plot background itself starts a paint — bars have their own
      // onClick and must not trigger a paint gesture underneath them.
      if (event.target !== event.currentTarget) return;

      if (event.pointerType === 'touch') {
        pointerStartRef.current = { clientX: event.clientX, pointerId: event.pointerId };
        clearLongPressTimer();
        longPressTimerRef.current = setTimeout(() => {
          longPressTimerRef.current = null;
          startPaint(event.clientX);
        }, LONG_PRESS_MS);
        return;
      }

      pointerStartRef.current = { clientX: event.clientX, pointerId: event.pointerId };
      startPaint(event.clientX);
    },
    [clearLongPressTimer, startPaint],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      // Pending long-press (touch, timer not yet fired): cancel on movement
      // past the threshold so a horizontal scroll isn't hijacked as a paint.
      if (longPressTimerRef.current !== null) {
        const start = pointerStartRef.current;
        if (start && Math.abs(event.clientX - start.clientX) > LONG_PRESS_MOVE_CANCEL_PX) {
          clearLongPressTimer();
        }
        return;
      }

      const current = draftRef.current;
      if (!current) return;

      const rect = plotRef.current?.getBoundingClientRect();
      if (!rect) return;
      const pointerMin = pointerToMinutes(event.clientX, rect, windowRef.current);
      // `movedPx` MUST be a pixel delta from the pointer-down clientX — never
      // `current.pointerDownMin` (restaurant-local minutes-since-midnight,
      // ~600-1380), which would mix units and misclassify a stationary click
      // as a drag (or vice versa). Falls back to `event.clientX` (zero delta)
      // only if pointerdown's start somehow wasn't recorded.
      const movedPx = Math.abs(event.clientX - (pointerStartRef.current?.clientX ?? event.clientX));
      setDraft(updatePaint(current, pointerMin, windowRef.current, movedPx));
    },
    [clearLongPressTimer],
  );

  const handlePointerUp = useCallback(() => {
    clearLongPressTimer();
    pointerStartRef.current = null;

    const current = draftRef.current;
    if (!current) return;

    setDraft(null);
    const range = endPaint(current, windowRef.current);
    onPaintCommit(range, laneContext);
  }, [clearLongPressTimer, onPaintCommit, laneContext]);

  const handlePointerCancel = useCallback(() => {
    // A browser-initiated pointercancel (e.g. an OS gesture takes over the
    // pointer) must DISCARD the in-progress paint, not commit it — unlike
    // pointerup, which is a deliberate release. Clear the long-press timer
    // and the draft directly, without calling endPaint/onPaintCommit.
    clearLongPressTimer();
    pointerStartRef.current = null;
    if (draftRef.current) setDraft(null);
  }, [clearLongPressTimer]);

  const handlePointerLeave = useCallback(() => {
    // A pointer leaving the plot mid-drag (without pointerup) shouldn't
    // silently commit — treat it like Escape: cancel the in-progress paint.
    // Pending long-press timers are unaffected (finger hasn't started dragging).
    if (draftRef.current) setDraft(null);
  }, []);

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && draftRef.current) {
      setDraft(null);
      clearLongPressTimer();
    }
  }, [clearLongPressTimer]);

  const handleAddShiftClick = useCallback(() => {
    const w = windowRef.current;
    const duration = Math.min(DEFAULT_CLICK_DURATION_MIN, w.endMin - w.startMin);
    onPaintCommit({ startMin: w.startMin, endMin: w.startMin + duration }, laneContext);
  }, [onPaintCommit, laneContext]);

  return (
    <div className="flex border-b border-border/40 last:border-b-0">
      {/* Sticky label column */}
      <div
        className="sticky left-0 z-10 flex flex-col justify-center min-w-[120px] w-[120px] shrink-0 bg-background border-r border-border/40 px-3 py-2"
        style={{ minHeight: plotHeight }}
      >
        <span className="text-[13px] font-medium text-foreground truncate">{displayLabel}</span>
        <span className="text-[11px] text-muted-foreground mt-0.5">
          {bars.length} shift{bars.length !== 1 ? 's' : ''} · {hours.toFixed(1)}h
        </span>
        <button
          type="button"
          onClick={handleAddShiftClick}
          className="sr-only"
        >
          {`Add shift to ${displayLabel} lane`}
        </button>
      </div>

      {/* Plot region: bars stacked by row, plus the paint-to-create pointer surface */}
      <div
        ref={plotRef}
        data-testid="lane-plot"
        className="relative flex-1 touch-pan-x touch-pan-y"
        style={{ height: Math.max(plotHeight, ROW_HEIGHT_PX) }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onPointerLeave={handlePointerLeave}
        onKeyDown={handleKeyDown}
      >
        {bars.map((bar) => (
          <div
            key={bar.shift.id}
            className="absolute left-0 right-0"
            style={{
              top: bar.row * ROW_HEIGHT_PX,
              height: ROW_HEIGHT_PX,
            }}
          >
            <TimelineBar
              bar={bar}
              minToPct={minToPct}
              onSelect={onSelect}
              window={window}
              getPlotRect={getPlotRect}
              onDraftChange={onBarDraftChange}
              onDragCommit={onBarDragCommit}
              highlighted={bar.shift.id === highlightedShiftId}
            />
          </div>
        ))}

        {draft && (
          <div
            data-testid="paint-ghost"
            aria-hidden="true"
            className={cn(
              'absolute inset-y-0.5 rounded-md border border-dashed border-foreground/40 bg-foreground/5',
              'pointer-events-none',
            )}
            style={{
              left: `${minToPct(draft.startMin)}%`,
              width: `${Math.max(minToPct(draft.endMin) - minToPct(draft.startMin), 1)}%`,
              top: plotHeight,
              height: ROW_HEIGHT_PX,
            }}
          />
        )}
      </div>
    </div>
  );
}

function areLaneEqual(prev: TimelineLaneProps, next: TimelineLaneProps): boolean {
  return (
    prev.lane === next.lane &&
    prev.minToPct === next.minToPct &&
    prev.window.startMin === next.window.startMin &&
    prev.window.endMin === next.window.endMin &&
    prev.onSelect === next.onSelect &&
    prev.onPaintCommit === next.onPaintCommit &&
    prev.onBarDraftChange === next.onBarDraftChange &&
    prev.onBarDragCommit === next.onBarDragCommit &&
    prev.highlightedShiftId === next.highlightedShiftId
  );
}

/**
 * Memoized (Stage D1b): `lane` is a fresh object per `useTimelineModel` recompute,
 * so this comparator relies on reference equality of `lane` itself (stable
 * unless that lane's bars/hours actually changed) plus the primitive window
 * bounds and stable callback identities — a drag frame's rAF-throttled model
 * recompute only produces a new `lane` object for the lane containing the
 * dragged bar, so sibling lanes skip re-rendering.
 */
export const TimelineLane = memo(TimelineLaneImpl, areLaneEqual);
