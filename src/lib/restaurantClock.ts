import { formatInTimeZone } from 'date-fns-tz';

/**
 * The restaurant timezone is the default frame for every user-visible date.
 *
 * A `Date` is either a *day on a calendar* or a *moment in time*, and the two
 * serialize differently. This module owns the moment-in-time half; the
 * calendar-day half lives in `src/lib/dateOnly.ts`. Each rejects the other's
 * input rather than silently producing a plausible wrong answer.
 */

/** Matches the `restaurants.timezone` DB default (migration 20251001022351). */
export const DEFAULT_TIMEZONE = 'America/Chicago';

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const WALL_CLOCK_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

/**
 * Throw where a loud failure is useful (dev, Vitest), log where it would be an
 * outage (production). This app has NO error boundary, so an uncaught throw in
 * render blanks the entire route — strictly worse than the wrong date.
 */
function reject(fn: string, reason: string, value: unknown): void {
  const message = `restaurantClock.${fn}: ${reason} (received ${JSON.stringify(value)})`;
  const env = import.meta.env;
  if (env?.DEV || env?.MODE === 'test') {
    throw new TypeError(message);
  }
  console.error(`[restaurantClock] ${message}`);
}

/**
 * Validate an IANA zone, falling back to the restaurant default.
 *
 * Ported from `supabase/functions/_shared/timezone.ts:25`. An invalid or empty
 * string makes `Intl.DateTimeFormat` throw `RangeError` synchronously, which
 * once crashed an entire edge-function email send (memory/lessons.md:807).
 */
export function safeTz(tz: string | null | undefined): string {
  if (!tz) return DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

/** Coerce an instant, complaining if it looks like a calendar day. */
function asInstant(value: string | Date, fn: string): Date {
  if (typeof value === 'string' && DATE_ONLY_RE.test(value)) {
    reject(fn, 'received a calendar day where a moment in time was expected', value);
    // Production fallback: read it as the calendar day it plainly is.
    return new Date(`${value}T00:00:00Z`);
  }
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) {
    reject(fn, 'received an unparseable value', value);
    return new Date(0);
  }
  return d;
}

/** Minutes east of UTC for `tz` at `at`. America/Chicago in CDT is -300. */
export function tzOffsetMinutes(tz: string, at: Date = new Date()): number {
  const zone = safeTz(tz);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    timeZoneName: 'longOffset',
  }).formatToParts(at);
  const raw = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  // "GMT-05:00", or bare "GMT" at exactly UTC.
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(raw);
  if (!m) return 0;
  const sign = m[1] === '-' ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3]));
}

/** Short zone name for display, e.g. "CDT". */
export function tzAbbrev(tz: string, at: Date = new Date()): string {
  return formatInTimeZone(at, safeTz(tz), 'zzz');
}

/** Format a moment in time in the restaurant's zone. */
export function formatInstant(value: string | Date, tz: string, pattern: string): string {
  return formatInTimeZone(asInstant(value, 'formatInstant'), safeTz(tz), pattern);
}

/** The restaurant-local calendar day an instant belongs to. */
export function toBusinessDay(value: string | Date, tz: string): string {
  return formatInTimeZone(asInstant(value, 'toBusinessDay'), safeTz(tz), 'yyyy-MM-dd');
}

/**
 * Every restaurant-local calendar day an interval touches, inclusive.
 *
 * Replaces the `new Date(y, m, d)` cursor loops that derived a day range from
 * the HOST's calendar fields, which put an overnight shift's second day on
 * whatever day it was in the viewer's zone. Iterates on calendar-day strings,
 * so no DST-shifted instant arithmetic is involved.
 */
export function businessDaysBetween(
  startInstant: string | Date,
  endInstant: string | Date,
  tz: string
): string[] {
  const zone = safeTz(tz);
  const startDay = toBusinessDay(asInstant(startInstant, 'businessDaysBetween'), zone);
  const endDay = toBusinessDay(asInstant(endInstant, 'businessDaysBetween'), zone);

  // An inverted range yields just the start day rather than looping forever.
  if (endDay <= startDay) return [startDay];

  const days: string[] = [];
  // Step with UTC noon so no DST edge can land the cursor on the wrong date,
  // and read the day back in UTC -- the cursor is a calendar-day token here,
  // deliberately not an instant in `zone`.
  const cursor = new Date(`${startDay}T12:00:00Z`);
  const last = new Date(`${endDay}T12:00:00Z`);
  while (cursor <= last) {
    days.push(formatInTimeZone(cursor, 'UTC', 'yyyy-MM-dd'));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

/** Render an instant for a `<input type="datetime-local">` in the restaurant's zone. */
export function toWallClockInput(value: string | Date, tz: string): string {
  return formatInTimeZone(asInstant(value, 'toWallClockInput'), safeTz(tz), "yyyy-MM-dd'T'HH:mm");
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Interpret a naive wall-clock string as restaurant-local and return the UTC
 * instant. The inverse of `toWallClockInput`.
 *
 * Deliberately does NOT delegate to `date-fns-tz`'s `fromZonedTime`, whose
 * handling of DST edges reads the HOST's local-time getters and disagrees
 * with Postgres (`timestamp AT TIME ZONE tz`) on both the repeated hour
 * (fall-back) and the nonexistent hour (spring-forward). Postgres resolves
 * both using the zone's SMALLER NUMERIC UTC OFFSET -- not "before", not
 * "after", and deliberately not tzdb's `isdst` designation. Verified
 * empirically against `America/Chicago` and `Australia/Sydney` (opposite
 * hemispheres), `Australia/Lord_Howe` (a 30-minute DST shift), and
 * `Europe/Dublin`, which is decisive: tzdb designates Irish summer (+1) as
 * *standard* and winter as a negative DST offset, so "smaller numeric offset"
 * and "the non-DST offset" pick opposite answers there -- and Postgres
 * follows the former. See `tests/unit/restaurantClock.test.ts` and
 * `supabase/tests/wall_clock_parity.sql` for the pinned values.
 *
 * Algorithm (host-TZ-independent -- never reads a local-time getter or
 * depends on `process.env.TZ`):
 *   1. Parse the wall clock's literal fields as if they were UTC ("naive").
 *   2. Collect the (at most two) distinct UTC offsets the zone could be
 *      observing around that moment, probed 24h to either side.
 *   3. A candidate offset is "valid" if applying it and formatting the
 *      result back in `tz` reproduces the input wall clock exactly.
 *   4. Exactly one valid candidate -> unambiguous, return it.
 *   5. Zero (nonexistent hour) or two (repeated hour) valid candidates ->
 *      resolve with the smaller (less-east) of the two offsets, matching
 *      Postgres.
 */
export function parseWallClock(wallClock: string, tz: string): string {
  if (!WALL_CLOCK_RE.test(wallClock)) {
    reject('parseWallClock', 'expected a naive wall clock (YYYY-MM-DDTHH:mm)', wallClock);
    const fallback = new Date(wallClock);
    return Number.isNaN(fallback.getTime()) ? new Date(0).toISOString() : fallback.toISOString();
  }

  const zone = safeTz(tz);
  // What toWallClockInput's pattern produces; the input may carry seconds
  // (per WALL_CLOCK_RE) but the datetime-local field never does, and the
  // ambiguity check only needs minute precision.
  const wallClockMinutes = wallClock.slice(0, 16);

  const [datePart, timePart] = wallClock.split('T');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hour, minute, second = '0'] = timePart.split(':');
  const naive = Date.UTC(year, month - 1, day, Number(hour), Number(minute), Number(second));

  const offsetBefore = tzOffsetMinutes(zone, new Date(naive - DAY_MS));
  const offsetAfter = tzOffsetMinutes(zone, new Date(naive + DAY_MS));
  const candidateOffsets = [...new Set([offsetBefore, offsetAfter])];

  const isValidOffset = (offsetMinutes: number): boolean => {
    const candidate = naive - offsetMinutes * 60000;
    return formatInTimeZone(new Date(candidate), zone, "yyyy-MM-dd'T'HH:mm") === wallClockMinutes;
  };

  const validOffsets = candidateOffsets.filter(isValidOffset);
  if (validOffsets.length === 1) {
    return new Date(naive - validOffsets[0] * 60000).toISOString();
  }

  // Zero valid (nonexistent) or two valid (repeated): the smaller numeric
  // offset wins, which is what Postgres does. See the doc comment -- this is
  // NOT the same as tzdb's "standard" offset in negative-DST zones.
  const smallerOffset = Math.min(offsetBefore, offsetAfter);
  return new Date(naive - smallerOffset * 60000).toISOString();
}
