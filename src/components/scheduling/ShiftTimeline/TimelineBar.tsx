import { cn } from '@/lib/utils';
import type { TimelineBar as TimelineBarModel } from './useTimelineModel';
import type { Shift } from '@/types/scheduling';

interface TimelineBarProps {
  /** The bar data (shift, geometry, label, color) from useTimelineModel. */
  bar: TimelineBarModel;
  /** Maps a minute value to a horizontal percent within [0, 100]. */
  minToPct: (min: number) => number;
  /** Called when the user clicks or activates the bar. */
  onSelect: (shift: Shift) => void;
}

/**
 * A single shift rendered as an absolutely-positioned `<button>` within a
 * timeline lane row.
 *
 * - Position: `left` / `width` derived from `minToPct`.
 * - Color: `bar.color` Tailwind classes (bg + border + text) from `getPositionColors`.
 * - Accessibility: `aria-label` with comma-separated fields for reliable SR pronunciation.
 * - Label is truncated with `truncate` so narrow bars stay tidy.
 */
export function TimelineBar({ bar, minToPct, onSelect }: TimelineBarProps) {
  const { leftMin, endMin, label, ariaLabel, color, shift } = bar;

  const left = minToPct(leftMin);
  const right = minToPct(endMin);
  const width = right - left;

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={() => onSelect(shift)}
      className={cn(
        'absolute inset-y-0.5 rounded-md border px-1.5 text-left text-[11px] font-medium truncate',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        'transition-opacity hover:opacity-90 active:opacity-80',
        color.bg,
        color.border,
        color.text,
      )}
      style={{
        left: `${left}%`,
        width: `${Math.max(width, 1)}%`,
      }}
    >
      {label}
    </button>
  );
}
