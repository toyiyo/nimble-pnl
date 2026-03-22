import type { ConflictCheck } from '@/types/scheduling';

/**
 * Format a UTC TIME string (HH:MM:SS) to local time display.
 * Creates a reference date in UTC with the given time, then formats in the target timezone.
 */
export function formatUTCTimeToLocal(utcTime: string, timezone: string): string {
  const [hours, minutes] = utcTime.split(':').map(Number);
  const refDate = new Date(Date.UTC(2026, 0, 1, hours, minutes, 0));
  return refDate.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: timezone,
  });
}

/** Extract an ISO date from a message and format it as a short day label (e.g. "Mon, Mar 22"). */
function extractDayLabel(message: string | undefined, timezone: string): string | null {
  const dateMatch = message?.match(/\d{4}-\d{2}-\d{2}/);
  if (!dateMatch) return null;
  const date = new Date(dateMatch[0] + 'T00:00:00Z');
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: timezone });
}

export function formatConflictLine(conflict: ConflictCheck, timezone: string): string {
  if (conflict.conflict_type === 'time-off') {
    return conflict.message || 'Time-off conflict';
  }

  if (conflict.available_start && conflict.available_end) {
    const start = formatUTCTimeToLocal(conflict.available_start, timezone);
    const end = formatUTCTimeToLocal(conflict.available_end, timezone);
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
