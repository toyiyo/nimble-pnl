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

  const m = naive.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return new Date(NaN);

  const [, y, mo, d, h, mi, s] = m;
  const guess = Date.UTC(+y, +mo - 1, +d, +h, +mi, +(s ?? 0));

  // Reject calendar values `Date.UTC` silently normalizes (e.g. 2026-02-30 →
  // 2026-03-02): re-read the UTC components back and require an exact match
  // before trusting `guess`, so an out-of-range day/month never silently
  // rolls into a different (wrong) date.
  const parsedGuess = new Date(guess);
  if (
    parsedGuess.getUTCFullYear() !== +y ||
    parsedGuess.getUTCMonth() !== +mo - 1 ||
    parsedGuess.getUTCDate() !== +d ||
    parsedGuess.getUTCHours() !== +h ||
    parsedGuess.getUTCMinutes() !== +mi ||
    parsedGuess.getUTCSeconds() !== +(s ?? 0)
  ) {
    return new Date(NaN);
  }

  // Two-pass offset probe (standard `fromZonedTime`-style fixup). A single
  // pass reads the zone's offset AT the naive-as-UTC guess, which can land on
  // the wrong side of a DST transition: e.g. "2026-03-08T03:30:00" in
  // America/Chicago — the guess instant 03:30Z falls before the 08:00Z
  // spring-forward, so a single-pass probe reads the pre-transition CST
  // offset (-6h) even though the intended local time (03:30, post-transition)
  // is CDT (-5h), corrupting the result by exactly 1h. Re-deriving the offset
  // at the corrected instant (second pass) picks the correct side.
  const offset1 = tzOffsetMs(new Date(guess), tz);
  const offset2 = tzOffsetMs(new Date(guess - offset1), tz);
  return new Date(guess - offset2);
}

/**
 * Minimal shape of the `.from().select().eq().maybeSingle()` chain the Revel
 * sync callers use. Type-agnostic (like `restaurantInfo.ts`) so both the real
 * Deno supabase-js client and Vitest stubs satisfy it without a URL import.
 */
interface RestaurantTimeZoneQueryClient {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): {
        maybeSingle(): Promise<{
          data: { timezone?: string | null } | null;
          error: { message: string } | null;
        }>;
      };
    };
  };
}

/**
 * Resolve a restaurant's IANA timezone once per sync run, for the Revel
 * callers (`revel-webhook`, `revel-sync-data`, `revel-bulk-sync`) to pass
 * into `processOrder`/`normalizeOrder`.
 *
 * Degrades to `DEFAULT_TIMEZONE` (never throws) on a missing row, a query
 * error, a null/empty stored timezone, or an invalid IANA identifier —
 * logging a warning in every fallback case so a misconfigured
 * `restaurants.timezone` surfaces in function logs instead of silently
 * mis-attributing sale hours.
 */
export async function resolveRestaurantTimeZone(
  supabase: RestaurantTimeZoneQueryClient,
  restaurantId: string,
): Promise<string> {
  const { data, error } = await supabase
    .from('restaurants')
    .select('timezone')
    .eq('id', restaurantId)
    .maybeSingle();

  if (error || !data) {
    console.warn(
      `resolveRestaurantTimeZone: failed to load restaurants.timezone for ${restaurantId}` +
        (error ? ` (${error.message})` : ' (no row found)') +
        `; falling back to ${DEFAULT_TIMEZONE}`,
    );
    return DEFAULT_TIMEZONE;
  }

  if (!data.timezone) {
    console.warn(
      `resolveRestaurantTimeZone: restaurants.timezone is null for ${restaurantId}; falling back to ${DEFAULT_TIMEZONE}`,
    );
    return DEFAULT_TIMEZONE;
  }

  const tz = safeTz(data.timezone);
  if (tz !== data.timezone) {
    console.warn(
      `resolveRestaurantTimeZone: invalid restaurants.timezone "${data.timezone}" for ${restaurantId}; falling back to ${DEFAULT_TIMEZONE}`,
    );
  }
  return tz;
}
