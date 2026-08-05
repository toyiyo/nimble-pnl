/**
 * Deno edge-function counterpart to `src/lib/dateOnly.ts`'s `toDateOnlyString`.
 * Edge functions cannot import from `src/`, so this is a self-contained copy —
 * keep the two in agreement.
 *
 * Serializes a Date's LOCAL fields into a YYYY-MM-DD calendar-day string.
 * Use this for a Date that already represents a calendar day (case a: a day
 * parsed out of a filename, a date-picker value, a week/period bound) — never
 * for a moment in time (`.toISOString()` reads UTC fields and rolls the day
 * back for any server TZ east of UTC, e.g. Pacific/Auckland).
 */
export function toDateOnlyString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
