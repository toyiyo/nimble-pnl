// ---------------------------------------------------------------------------
// Shared scheduling constants & helpers
// ---------------------------------------------------------------------------
// Extracted from WeekTemplateBuilder, ScheduleBoard, ScheduleAssignment,
// and ShiftDefinitionsManager to eliminate code duplication.
// ---------------------------------------------------------------------------

/**
 * Column order for the weekly schedule grid.
 * Mon(1), Tue(2), Wed(3), Thu(4), Fri(5), Sat(6), Sun(0)
 */
export const COLUMN_DAYS = [1, 2, 3, 4, 5, 6, 0] as const;

/** Short day names indexed by JS getDay() convention (0=Sun, 1=Mon, ..., 6=Sat). */
export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Format a 24h HH:MM time string into 12-hour format with AM/PM.
 * Example: "14:30" → "2:30 PM"
 */
export function formatTime(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 || 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
}

/**
 * Calculate hours between two HH:MM times (supports overnight shifts).
 * Subtracts break minutes from the result.
 */
export function hoursForSlot(start: string, end: string, breakMin: number): number {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  let diff = eh * 60 + em - (sh * 60 + sm);
  if (diff <= 0) diff += 24 * 60; // overnight
  return Math.max(0, (diff - breakMin) / 60);
}

/**
 * Format a week date range for display headers.
 * Example: "2026-03-02" → "Mar 2 – 8, 2026" (same month)
 *          "2026-02-24" → "Feb 24 – Mar 2, 2026" (cross month)
 */
export function formatWeekRange(weekStartStr: string): string {
  const start = new Date(weekStartStr + 'T00:00:00');
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const startMonth = start.toLocaleDateString('en-US', { month: 'short' });
  const endMonth = end.toLocaleDateString('en-US', { month: 'short' });
  const year = end.getFullYear();
  if (startMonth === endMonth) {
    return `${startMonth} ${start.getDate()} \u2013 ${end.getDate()}, ${year}`;
  }
  return `${startMonth} ${start.getDate()} \u2013 ${endMonth} ${end.getDate()}, ${year}`;
}

/**
 * Get the Date object for a specific day_of_week within a week starting on Monday.
 * dayOfWeek uses JS convention: 0=Sun, 1=Mon, ..., 6=Sat.
 */
export function dateForDay(weekStartStr: string, dayOfWeek: number): Date {
  const start = new Date(weekStartStr + 'T00:00:00');
  const offset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const d = new Date(start);
  d.setDate(start.getDate() + offset);
  return d;
}

/**
 * Check if two time ranges overlap (supports overnight shifts).
 * Times are in HH:MM format.
 */
export function timesOverlap(
  startA: string,
  endA: string,
  startB: string,
  endB: string,
): boolean {
  const toMin = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };
  const aStart = toMin(startA);
  let aEnd = toMin(endA);
  const bStart = toMin(startB);
  let bEnd = toMin(endB);
  if (aEnd <= aStart) aEnd += 24 * 60;
  if (bEnd <= bStart) bEnd += 24 * 60;
  return aStart < bEnd && bStart < aEnd;
}
