/**
 * Parse a date-only string (YYYY-MM-DD) as local midnight.
 *
 * IMPORTANT: `new Date("2026-04-10")` and `parseISO("2026-04-10")` parse
 * date-only strings as UTC midnight. In timezones behind UTC (CDT, EST, PST),
 * this displays as the previous day. Always use this function for date-only
 * strings from Supabase (DATE columns like shift_date, week_start_date, etc.).
 */
export function parseDateLocal(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}
