import type { TimelineWindow } from './useTimelineModel';
import { minutesToCompact } from '@/lib/shiftCoverage';

interface TimelineAxisProps {
  /** Derived time window for the selected day. */
  readonly window: TimelineWindow;
  /** Maps a minute value to a horizontal percent position within the plot. */
  readonly minToPct: (min: number) => number;
}

/**
 * Horizontal axis: one tick line + label per hour across the derived window.
 *
 * Renders a purely presentational row; no interactive elements.
 * Labels use `minutesToCompact` so overnight ticks (min > 1440) display the
 * correct wrapped hour (e.g. 1500 → "1a").
 */
export function TimelineAxis({ window, minToPct }: TimelineAxisProps) {
  const { startMin, endMin } = window;

  // Collect whole-hour ticks that fall within the window
  const ticks: number[] = [];
  const firstHour = Math.ceil(startMin / 60) * 60;
  for (let m = firstHour; m <= endMin; m += 60) {
    ticks.push(m);
  }

  return (
    <div className="relative h-6 select-none" aria-hidden>
      {ticks.map((m) => {
        const pct = minToPct(m);
        return (
          <div
            key={m}
            className="absolute top-0 flex flex-col items-center"
            style={{ left: `${pct}%` }}
          >
            {/* Tick line */}
            <div className="h-2 w-px bg-border/60" />
            {/* Hour label */}
            <span className="text-[11px] text-muted-foreground -translate-x-1/2">
              {minutesToCompact(m)}
            </span>
          </div>
        );
      })}
      {/* Full-width baseline */}
      <div className="absolute bottom-0 left-0 right-0 h-px bg-border/40" />
    </div>
  );
}
