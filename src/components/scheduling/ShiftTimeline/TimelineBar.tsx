import { memo, useCallback } from 'react';

import { cn } from '@/lib/utils';
import { minutesToCompact } from '@/lib/shiftCoverage';
import { useTimelineBarDrag } from './useTimelineBarDrag';
import type { TimelineBar as TimelineBarModel } from './useTimelineModel';
import type { TimelineWindow } from '@/lib/timelineModel';
import type { ShiftMinuteRange } from '@/lib/timelineDragMath';
import type { Shift } from '@/types/scheduling';

interface TimelineBarProps {
  /** The bar data (shift, geometry, label, color) from useTimelineModel. */
  readonly bar: TimelineBarModel;
  /** Maps a minute value to a horizontal percent within [0, 100]. */
  readonly minToPct: (min: number) => number;
  /** Called when the user clicks, taps, or activates the bar via keyboard. */
  readonly onSelect: (shift: Shift) => void;
  /** The visible time window — needed to invert pointer position back to minutes. */
  readonly window: TimelineWindow;
  /** Returns the lane's plot region bounding rect, read fresh on every pointer event. */
  readonly getPlotRect: () => DOMRect | null;
  /**
   * Called on every rAF-throttled frame while dragging, with the live
   * drafted range (feeds Stage D2's live coverage merge). Called with `null`
   * when a drag ends, is cancelled, or never starts.
   */
  readonly onDraftChange: (shiftId: string, range: ShiftMinuteRange | null) => void;
  /** Called on pointerup with the final drafted range — the caller commits it via validateAndUpdateTime. */
  readonly onDragCommit: (shiftId: string, range: ShiftMinuteRange) => void;
}

/**
 * A single shift rendered as an absolutely-positioned `<button>` within a
 * timeline lane row.
 *
 * - Position: `left` / `width` derived from `minToPct`.
 * - Color: `bar.color` Tailwind classes (bg + border + text) from `getPositionColors`.
 * - Accessibility: `aria-label` with comma-separated fields for reliable SR pronunciation.
 *   Keyboard Enter/Space still calls `onSelect` via the native `<button>` click
 *   synthesis — the pointer-drag wiring only listens for pointer events, so it
 *   never intercepts keyboard activation.
 * - Label is truncated with `truncate` so narrow bars stay tidy.
 *
 * Drag-move / edge-resize (Stage D1): the bar body is a move handle; two
 * narrow edge strips are resize handles. `useTimelineBarDrag` disambiguates a
 * tap (< 5px movement — a no-op, left to the native `onClick` below) from a
 * real drag (calls `onDraftChange` each frame, `onDragCommit` on release).
 * Locked shifts and touch pointers never drag — `touch-action: none` is
 * scoped to the body + handles only so the lane's own pan-to-scroll behavior
 * is unaffected.
 *
 * Memoized (Stage D1b): re-renders only when this bar's identity/geometry/
 * label/color actually changes, so a drag frame only re-renders the dragged
 * row while sibling bars in other lanes stay untouched.
 */
function TimelineBarImpl({
  bar,
  minToPct,
  onSelect,
  window,
  getPlotRect,
  onDraftChange,
  onDragCommit,
}: TimelineBarProps) {
  const { leftMin, endMin, label, ariaLabel, color, shift } = bar;
  const locked = shift.locked;

  const handleTap = useCallback(() => onSelect(shift), [onSelect, shift]);

  const handleDraftChange = useCallback(
    (range: ShiftMinuteRange | null) => onDraftChange(shift.id, range),
    [onDraftChange, shift.id],
  );

  const handleCommit = useCallback(
    (range: ShiftMinuteRange) => onDragCommit(shift.id, range),
    [onDragCommit, shift.id],
  );

  const getWindow = useCallback(() => window, [window]);

  const { dragState, handleBodyPointerDown, handleStartHandlePointerDown, handleEndHandlePointerDown, handlePointerMove, handlePointerUp, handlePointerCancel } =
    useTimelineBarDrag({
      original: { startMin: leftMin, endMin },
      locked,
      getPlotRect,
      getWindow,
      onDraftChange: handleDraftChange,
      onCommit: handleCommit,
    });

  const displayLeftMin = dragState?.startMin ?? leftMin;
  const displayEndMin = dragState?.endMin ?? endMin;

  const left = minToPct(displayLeftMin);
  const right = minToPct(displayEndMin);
  const width = right - left;

  return (
    <div
      className="absolute inset-y-0.5"
      style={{ left: `${left}%`, width: `${Math.max(width, 1)}%` }}
    >
      <button
        type="button"
        aria-label={ariaLabel}
        onClick={handleTap}
        onPointerDown={handleBodyPointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        className={cn(
          'relative h-full w-full rounded-md border px-1.5 text-left text-[11px] font-medium truncate',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          'transition-opacity hover:opacity-90 active:opacity-80',
          !locked && 'cursor-grab touch-none',
          color.bg,
          color.border,
          color.text,
        )}
      >
        {label}

        {!locked && (
          <>
            <span
              data-testid="resize-handle-start"
              aria-hidden="true"
              onPointerDown={handleStartHandlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerCancel}
              className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize touch-none"
            />
            <span
              data-testid="resize-handle-end"
              aria-hidden="true"
              onPointerDown={handleEndHandlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerCancel}
              className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize touch-none"
            />
          </>
        )}
      </button>

      {dragState && (
        <div
          data-testid="drag-time-readout"
          aria-hidden="true"
          className={cn(
            'absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md border px-1.5 py-0.5',
            'bg-popover text-popover-foreground border-border/40 text-[11px] font-medium shadow-sm',
            'pointer-events-none z-10',
          )}
        >
          {minutesToCompact(dragState.startMin % 1440)} – {minutesToCompact(dragState.endMin % 1440)}
        </div>
      )}
    </div>
  );
}

function areEqual(prev: TimelineBarProps, next: TimelineBarProps): boolean {
  return (
    prev.bar.shift.id === next.bar.shift.id &&
    prev.bar.leftMin === next.bar.leftMin &&
    prev.bar.endMin === next.bar.endMin &&
    prev.bar.row === next.bar.row &&
    prev.bar.label === next.bar.label &&
    prev.bar.ariaLabel === next.bar.ariaLabel &&
    prev.bar.color === next.bar.color &&
    prev.bar.shift.locked === next.bar.shift.locked &&
    prev.minToPct === next.minToPct &&
    prev.onSelect === next.onSelect &&
    prev.window.startMin === next.window.startMin &&
    prev.window.endMin === next.window.endMin &&
    prev.getPlotRect === next.getPlotRect &&
    prev.onDraftChange === next.onDraftChange &&
    prev.onDragCommit === next.onDragCommit
  );
}

export const TimelineBar = memo(TimelineBarImpl, areEqual);
