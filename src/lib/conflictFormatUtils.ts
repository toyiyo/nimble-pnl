import type { ConflictCheck } from '@/types/scheduling';
import { utcTimeToLocalTime } from '@/lib/availabilityTimeUtils';
import { formatHourToTime } from '@/lib/timeUtils';

/**
 * Format a UTC TIME string (HH:MM or HH:MM:SS) to local time display.
 *
 * Delegates the UTC→local conversion to `utcTimeToLocalTime` (date-fns-tz),
 * which anchors the DST offset to `referenceDate` (defaults to today).
 * This matches the anchor used by `localTimeToUtcTime` (the writer) and
 * `utcTimeToLocalTime` (the grid reader), ensuring the conflict warning
 * always shows the same local time the employee entered.
 *
 * Prior implementation hardcoded a January-1 anchor (standard time), causing
 * daylight-saving times to display 1 hour earlier than stored.
 */
export function formatUTCTimeToLocal(
  utcTime: string,
  timezone: string,
  referenceDate: Date = new Date(),
): string {
  const local = utcTimeToLocalTime(utcTime, timezone, referenceDate); // "HH:MM", DST-correct
  const [h, m] = local.split(':').map(Number);
  return formatHourToTime(h + m / 60); // "10:30 PM"
}

/** Extract an ISO date from a message and format it as a short day label (e.g. "Mon, Mar 22"). */
function extractDayLabel(message: string | undefined, timezone: string): string | null {
  const dateMatch = message?.match(/\d{4}-\d{2}-\d{2}/);
  if (!dateMatch) return null;
  const date = new Date(dateMatch[0] + 'T00:00:00Z');
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: timezone });
}

export function formatConflictLine(
  conflict: ConflictCheck,
  timezone: string,
  referenceDate: Date = new Date(),
): string {
  if (conflict.conflict_type === 'time-off') {
    return conflict.message || 'Time-off conflict';
  }

  if (conflict.available_start && conflict.available_end) {
    const start = formatUTCTimeToLocal(conflict.available_start, timezone, referenceDate);
    const end = formatUTCTimeToLocal(conflict.available_end, timezone, referenceDate);
    const dayLabel = extractDayLabel(conflict.message, timezone);
    if (dayLabel) {
      return `Shift on ${dayLabel} is outside availability (available ${start} – ${end})`;
    }
    return `Outside availability window (available ${start} – ${end})`;
  }

  const dayLabel = extractDayLabel(conflict.message, timezone);
  if (dayLabel && conflict.message) {
    return conflict.message.replace(/\d{4}-\d{2}-\d{2}/, dayLabel);
  }

  return conflict.message || 'Scheduling conflict';
}
