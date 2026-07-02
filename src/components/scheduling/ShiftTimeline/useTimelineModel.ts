import { isoToLocalMinutes } from '@/lib/shiftCoverage';
import type { Shift } from '@/types/scheduling';
import type { PositionColors } from '@/lib/positionColors';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TimelineWindow {
  startMin: number;
  endMin: number;
}

export interface TimelineBar {
  shift: Shift;
  row: number;
  leftMin: number;
  endMin: number;
  label: string;
  ariaLabel: string;
  color: PositionColors;
}

export interface TimelineLane {
  key: string;
  label: string;
  hours: number;
  bars: TimelineBar[];
}

export interface TimelineGap {
  startMin: number;
  endMin: number;
}

export interface TimelineModel {
  window: TimelineWindow;
  lanes: TimelineLane[];
  coverage: { min: number; count: number }[];
  demand: { min: number; target: number }[] | null;
  gaps: TimelineGap[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_START = 600; // 10:00
const DEFAULT_END = 1380;  // 23:00

// ─── Window derivation ────────────────────────────────────────────────────────

/**
 * Derive the visible time window for the given day's shifts.
 * Floors start and ceils end to the nearest hour.
 * Overnight shifts may yield endMin > 1440.
 * Returns a sane default when no shifts are present.
 */
export function deriveWindow(
  shifts: Shift[],
  dateStr: string,
  tz: string,
): TimelineWindow {
  if (shifts.length === 0) {
    return { startMin: DEFAULT_START, endMin: DEFAULT_END };
  }

  let minStart = Infinity;
  let maxEnd = -Infinity;

  for (const s of shifts) {
    const ds = isoToLocalMinutes(s.start_time, dateStr, tz);
    let de = isoToLocalMinutes(s.end_time, dateStr, tz);
    if (de <= ds) de += 1440;
    minStart = Math.min(minStart, ds);
    maxEnd = Math.max(maxEnd, de);
  }

  return {
    startMin: Math.floor(minStart / 60) * 60,
    endMin: Math.ceil(maxEnd / 60) * 60,
  };
}
