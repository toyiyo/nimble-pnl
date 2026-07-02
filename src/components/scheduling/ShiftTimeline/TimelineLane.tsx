import type { TimelineLane as TimelineLaneModel } from './useTimelineModel';
import type { Shift } from '@/types/scheduling';
import { TimelineBar } from './TimelineBar';

interface TimelineLaneProps {
  /** Lane data from useTimelineModel (label, hours, bars). */
  lane: TimelineLaneModel;
  /** Maps a minute value to a horizontal percent within [0, 100]. */
  minToPct: (min: number) => number;
  /** Called when the user clicks a shift bar. */
  onSelect: (shift: Shift) => void;
}

/** Height in pixels for each stacked bar row within a lane. */
const ROW_HEIGHT_PX = 28;

/**
 * A single area/position band in the timeline.
 *
 * Layout:
 *  - Sticky-left label column: section name · shift count · total hours.
 *  - Relative-positioned plot region whose height is `(maxRow + 1) × ROW_HEIGHT_PX`.
 *  - Each `TimelineBar` is placed at `top: bar.row × ROW_HEIGHT_PX`.
 */
export function TimelineLane({ lane, minToPct, onSelect }: TimelineLaneProps) {
  const { label, hours, bars } = lane;
  const maxRow = bars.reduce((max, b) => Math.max(max, b.row), 0);
  const plotHeight = (maxRow + 1) * ROW_HEIGHT_PX;

  return (
    <div className="flex border-b border-border/40 last:border-b-0">
      {/* Sticky label column */}
      <div
        className="sticky left-0 z-10 flex flex-col justify-center min-w-[120px] w-[120px] shrink-0 bg-background border-r border-border/40 px-3 py-2"
        style={{ minHeight: plotHeight }}
      >
        <span className="text-[13px] font-medium text-foreground truncate">{label || 'Unassigned'}</span>
        <span className="text-[11px] text-muted-foreground mt-0.5">
          {bars.length} shift{bars.length !== 1 ? 's' : ''} · {hours.toFixed(1)}h
        </span>
      </div>

      {/* Plot region: bars stacked by row */}
      <div
        className="relative flex-1"
        style={{ height: Math.max(plotHeight, ROW_HEIGHT_PX) }}
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
            />
          </div>
        ))}
      </div>
    </div>
  );
}
