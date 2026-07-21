/**
 * timezone.ts
 *
 * Pure, dependency-free helpers for converting a naive local ("wall-clock")
 * datetime string into the correct UTC instant for a given IANA timezone,
 * using `Intl.DateTimeFormat.formatToParts` (DST-aware, no `date-fns-tz`
 * dependency needed on the Deno edge-function runtime).
 *
 * Used by the Revel order processor (`revelOrderProcessor.ts`) to interpret
 * Revel's naive-local `created_date` in the establishment's IANA timezone
 * instead of mis-treating it as UTC.
 */

/** Restaurant default timezone (matches migration 20251001022351). */
export const DEFAULT_TIMEZONE = 'America/Chicago';

/**
 * Validate an IANA timezone string, falling back to the restaurant default
 * when it is missing or invalid.
 *
 * Lesson (2026-07-02): an invalid/empty/legacy tz string makes
 * `Intl.DateTimeFormat` THROW a `RangeError` — validate before it reaches
 * `formatToParts`, don't let it crash a sync run.
 */
export function safeTz(tz: string | null | undefined): string {
  if (!tz) return DEFAULT_TIMEZONE;
  try {
    // Constructing the formatter is enough to validate the IANA identifier;
    // an invalid one throws RangeError synchronously.
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

/**
 * Compute the UTC offset (in milliseconds) of `timeZone` at the instant
 * `date`, via an `Intl.formatToParts` round-trip. Positive means the zone is
 * ahead of UTC; negative means behind (e.g. America/Chicago in CDT is
 * -5 * 60 * 60 * 1000).
 *
 * `timeZone` is assumed already-validated (see `safeTz`); an invalid zone
 * here will throw, matching `Intl`'s native behavior.
 */
export function tzOffsetMs(date: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    hourCycle: 'h23',
  });

  const parts = formatter.formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);

  // formatToParts can report hour "24" at local midnight under hourCycle h23
  // in some runtimes; normalize to 0 so Date.UTC doesn't roll to the wrong day.
  const hour = get('hour') % 24;

  const localAsUtc = Date.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'));

  return localAsUtc - date.getTime();
}

/**
 * Interpret a naive local datetime string ("YYYY-MM-DDTHH:MM:SS" or
 * "YYYY-MM-DD HH:MM:SS", no offset) as wall-clock time in `timeZone` and
 * return the corresponding UTC instant. DST-aware.
 *
 * Mirrors `date-fns-tz`'s `fromZonedTime` without the external dependency.
 *
 * - Invalid/missing `timeZone` falls back to `America/Chicago` (see `safeTz`).
 * - An unparseable `naive` string returns an invalid `Date` (never throws).
 */
export function zonedNaiveToUtc(naive: string, timeZone: string | null | undefined): Date {
  const tz = safeTz(timeZone);

  const m = naive.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return new Date(NaN);

  const [, y, mo, d, h, mi, s] = m;
  const guess = Date.UTC(+y, +mo - 1, +d, +h, +mi, +(s ?? 0));

  // Round-trip through formatToParts to get the zone's offset at (approximately)
  // this instant, then subtract it from the naive-as-UTC guess to get the true instant.
  const offset = tzOffsetMs(new Date(guess), tz);
  return new Date(guess - offset);
}
