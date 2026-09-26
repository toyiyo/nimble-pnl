/**
 * Deno edge-function path for `toDateOnlyString`. The one implementation is in
 * `./labor/dateOnly.ts`, which `src/lib/dateOnly.ts` also re-exports. This
 * file keeps the old edge import path.
 *
 * Serializes a Date's LOCAL fields into a YYYY-MM-DD calendar-day string.
 * Use this for a Date that already represents a calendar day (case a: a day
 * parsed out of a filename, a date-picker value, a week/period bound) — never
 * for a moment in time (`.toISOString()` reads UTC fields and rolls the day
 * back for any server TZ east of UTC, e.g. Pacific/Auckland).
 */
export { toDateOnlyString } from './labor/dateOnly.ts';
