import { useEffect, useState } from 'react';
import { isoToLocalMinutes } from '@/lib/shiftCoverage';
import type { TimelineWindow } from './useTimelineModel';

interface NowIndicatorProps {
  /** Calendar date string (YYYY-MM-DD) of the currently selected day. */
  readonly dateStr: string;
  /** Restaurant IANA timezone. */
  readonly tz: string;
  /** Derived time window for the selected day. */
  readonly window: TimelineWindow;
  /** Maps a minute value to a horizontal percent within [0, 100]. */
  readonly minToPct: (min: number) => number;
}

/**
 * A thin vertical "now" line that tracks the current time within the visible
 * window.
 *
 * Owns a local `useState<Date>` updated every 60 seconds via `setInterval` so
 * the 60 s repaint is scoped to this component and does not bust the model memo
 * or re-render the lanes (per CLAUDE.md NowIndicator pattern).
 *
 * Returns null when the current time falls outside the visible window (including
 * when the selected day is not today).
 */
export function NowIndicator({ dateStr, tz, window, minToPct }: NowIndicatorProps) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const nowMin = isoToLocalMinutes(now.toISOString(), dateStr, tz);

  if (nowMin < window.startMin || nowMin > window.endMin) return null;

  return (
    <div
      aria-hidden
      className="absolute top-0 bottom-0 w-px bg-destructive/70 pointer-events-none"
      style={{ left: `${minToPct(nowMin)}%` }}
    />
  );
}
