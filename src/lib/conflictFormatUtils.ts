import type { ConflictCheck } from '@/types/scheduling';
import { formatDateOnly } from '@/lib/dateOnly';
import { formatHourToTime } from '@/lib/timeUtils';

/**
 * Format a restaurant-local TIME string (HH:MM or HH:MM:SS) for display.
 * No timezone conversion. "17:30:00" gives "5:30 PM"; "00:00:00" gives "12:00 AM".
 */
export function formatLocalTimeOfDay(localTime: string): string {
  const [h, m] = localTime.split(':').map(Number);
  return formatHourToTime(h + m / 60);
}

/**
 * Extract an ISO date from a message and format it as a short day label
 * (e.g. "Mon, Mar 22").
 *
 * Takes NO timezone: the date embedded in a conflict message is a calendar day
 * the SQL already resolved in the restaurant's frame (`'Shift on ' ||
 * v_current_date`), not an instant. Round-tripping it through UTC midnight and
 * back — as this did — rendered the PREVIOUS day for every restaurant west of
 * UTC, i.e. all of them.
 */
function extractDayLabel(message: string | undefined): string | null {
  const dateMatch = message?.match(/\d{4}-\d{2}-\d{2}/);
  if (!dateMatch) return null;
  try {
    return formatDateOnly(dateMatch[0], 'EEE, MMM d');
  } catch {
    // The SQL only emits real calendar dates, so this is unreachable today.
    // Guard anyway: `formatDateOnly` throws on a regex-matching but invalid date
    // (e.g. 2026-02-31 from a future caller). This runs inside render via
    // `formatConflictLine`, so a throw would crash the conflict dialog. Fall back
    // to the raw date rather than the old silent UTC-midnight coercion.
    return dateMatch[0];
  }
}

export function formatConflictLine(conflict: ConflictCheck): string {
  if (conflict.conflict_type === 'time-off') {
    return conflict.message || 'Time-off conflict';
  }

  // The RPC returns the window in restaurant local time. Show it with no
  // conversion. A legacy UTC window (available_start) is never shown.
  if (conflict.available_start_local && conflict.available_end_local) {
    const start = formatLocalTimeOfDay(conflict.available_start_local);
    const end = formatLocalTimeOfDay(conflict.available_end_local);
    const dayLabel = extractDayLabel(conflict.message);
    if (dayLabel) {
      return `Shift on ${dayLabel} is outside availability (available ${start} – ${end})`;
    }
    return `Outside availability window (available ${start} – ${end})`;
  }

  const dayLabel = extractDayLabel(conflict.message);
  if (dayLabel && conflict.message) {
    return conflict.message.replace(/\d{4}-\d{2}-\d{2}/, dayLabel);
  }

  return conflict.message || 'Scheduling conflict';
}
