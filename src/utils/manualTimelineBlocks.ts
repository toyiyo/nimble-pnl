import { startOfDay, endOfDay } from 'date-fns';
import { TimePunch } from '@/types/timeTracking';
import { isWithinWindow } from '@/utils/punchWindow';

/**
 * A clock_in→clock_out pair rendered as one editable bar on the Manual timeline.
 * Extracted from ManualTimelineEditor so the pairing/attribution logic is pure
 * and unit-testable.
 */
export interface TimeBlock {
  id: string; // Unique ID for UI, maps to punch pair
  startTime: Date;
  endTime: Date;
  breakMinutes?: number; // Optional break duration
  notes?: string; // Optional notes
  clockInPunchId?: string;
  clockOutPunchId?: string;
  hasClockInTime?: boolean;
  hasClockOutTime?: boolean;
  isNew?: boolean; // Track if this is unsaved
  isSaving?: boolean;
  isImported?: boolean;
  importSource?: string;
}

/** Read the import source from a punch's device_info (`import:<source>`). */
export const getImportSource = (punch: TimePunch | undefined): string | null => {
  if (!punch?.device_info) return null;
  if (!punch.device_info.startsWith('import:')) return null;
  return punch.device_info.replace('import:', '').trim() || 'Uploaded';
};

/**
 * Pair one employee's punches into clock_in→clock_out blocks WITHOUT a per-day
 * pre-filter (so a shift crossing midnight pairs whole), then keep only blocks
 * whose clock-in (startTime) falls on `date` — attributing each shift to the day
 * it began. Pass the ±18h buffered punch set so the next-day clock-out is present.
 *
 * Reuses `isWithinWindow` (the app-wide clock-in-day attribution rule from #599)
 * so overnight handling stays consistent with payroll/timecard/dashboard.
 */
export function buildTimelineBlocks(punches: TimePunch[], date: Date): TimeBlock[] {
  const sorted = [...punches].sort(
    (a, b) => new Date(a.punch_time).getTime() - new Date(b.punch_time).getTime()
  );

  const blocks: TimeBlock[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const punch = sorted[i];
    if (punch.punch_type !== 'clock_in') continue;
    const next = sorted[i + 1];
    if (next?.punch_type === 'clock_out') {
      const importSource = getImportSource(punch) || getImportSource(next);
      blocks.push({
        id: `${punch.id}-${next.id}`,
        startTime: new Date(punch.punch_time),
        endTime: new Date(next.punch_time),
        clockInPunchId: punch.id,
        clockOutPunchId: next.id,
        notes: punch.notes || next.notes || undefined,
        hasClockInTime: true,
        hasClockOutTime: true,
        isImported: Boolean(importSource),
        importSource: importSource || undefined,
      });
      i++; // Skip the paired clock_out
    }
  }

  // Attribute each block to its clock-in day.
  const start = startOfDay(date);
  const end = endOfDay(date);
  return blocks.filter((block) => isWithinWindow(block.startTime, start, end));
}
