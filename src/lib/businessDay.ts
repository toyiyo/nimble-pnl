import { validateTimeZone } from '@/lib/splhAnalytics';

export const DEFAULT_BUSINESS_DAY_START_HOUR = 0;
export const MAX_BUSINESS_DAY_START_HOUR = 11;

/**
 * A restaurant's business-day framing: its IANA zone and its cutoff hour.
 *
 * Threaded through the pure calculation modules (laborCalculations,
 * payrollCalculations, timecardHours), which have no React context access.
 */
export interface BusinessDayConfig {
  tz: string | null | undefined;
  cutoffHour: number | null | undefined;
}

/**
 * Clamp to [0, 11] and coerce null/undefined/NaN to 0.
 *
 * Mirrors the SQL `COALESCE(v_hour, 0)` plus the
 * `CHECK (business_day_start_hour BETWEEN 0 AND 11)` constraint. Truncates a
 * fractional input rather than inventing sub-hour cutoff semantics, which the
 * SMALLINT column cannot represent.
 */
export function safeCutoffHour(hour: number | null | undefined): number {
  if (hour === null || hour === undefined || !Number.isFinite(hour)) {
    return DEFAULT_BUSINESS_DAY_START_HOUR;
  }
  const truncated = Math.trunc(hour);
  if (truncated < DEFAULT_BUSINESS_DAY_START_HOUR) return DEFAULT_BUSINESS_DAY_START_HOUR;
  if (truncated > MAX_BUSINESS_DAY_START_HOUR) return MAX_BUSINESS_DAY_START_HOUR;
  return truncated;
}

/**
 * Cached wall-clock formatter, keyed on the RAW tz argument (so null, undefined
 * and '' each memoize their own resolution to UTC rather than re-validating).
 *
 * This cache is not a micro-optimization. `toBusinessDay` is called once per
 * work period per consumer -- a capped payroll fetch reaches 10,000 periods --
 * and an uncached implementation measured 138us/call, ~60us of it a fresh
 * `new Intl.DateTimeFormat` inside validateTimeZone and ~53us date-fns-tz's
 * `toZonedTime`. That is seconds of blocked main thread on a large period.
 * Keys come from `restaurants.timezone`, a bounded set, so the map cannot grow
 * without bound.
 *
 * `hourCycle: 'h23'` rather than `hour12: false`: some ICU builds render
 * midnight as hour "24" under the latter. The `% 24` below is belt-and-braces.
 */
const wallClockFormatters = new Map<string | null | undefined, Intl.DateTimeFormat>();

function wallClockFormatter(tz: string | null | undefined): Intl.DateTimeFormat {
  const cached = wallClockFormatters.get(tz);
  if (cached) return cached;
  // validateTimeZone already resolves an invalid or empty zone to 'UTC', so
  // this construction cannot throw.
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: validateTimeZone(tz),
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
  });
  wallClockFormatters.set(tz, fmt);
  return fmt;
}

/**
 * Map an instant to its business day, as a YYYY-MM-DD calendar-day token.
 *
 * Returns a STRING, not a Date. A Date would be a local-midnight calendar-day
 * token, and memory/lessons.md 2026-07-28 documents the production incident
 * that follows from one of those meeting `.toISOString()` -- 44
 * schedule_publications rows across 9 restaurants got an 8-day Mon->Mon span.
 * A string return makes that mistake unrepresentable at this boundary.
 * Callers needing a Date for date-fns go through parseDateOnly().
 *
 * Term-by-term correspondence with public.business_day(), which per CLAUDE.md
 * is the authoritative implementation and this the preview:
 *   formatToParts in tz  <-> AT TIME ZONE v_tz  (both yield naive local wall clock)
 *   setUTCHours(h - cut) <-> - make_interval(hours => h)
 *   getUTC* -> YYYY-MM-DD <-> ::date
 *   validateTimeZone     <-> COALESCE(NULLIF(v_tz,'')) + the exception probe
 *   safeCutoffHour       <-> COALESCE(v_hour, 0) + the CHECK constraint
 *
 * ORDER IS LOAD-BEARING: convert first, then subtract. The other order
 * subtracts elapsed rather than wall-clock time and disagrees by a full
 * calendar day inside the fall-back repeated hour. Design doc section 4.1.
 *
 * The subtraction runs in the UTC frame on purpose. Postgres subtracts an
 * interval from a naive TIMESTAMP -- pure calendar arithmetic, no zone rules
 * apply to it. UTC has no DST, so doing it there reproduces that exactly.
 * Doing it in the HOST frame (`d.setHours(d.getHours() - cut)`, the shape this replaced)
 * would let the machine running the code re-apply ITS OWN DST rules to a wall
 * clock that already belongs to the restaurant, so a viewer in a spring-forward
 * hour could read a different business day than the server for the same punch.
 */
export function toBusinessDay(
  instant: Date | string,
  tz: string | null | undefined,
  cutoffHour: number | null | undefined,
): string {
  const asDate = typeof instant === 'string' ? new Date(instant) : instant;
  const parts = wallClockFormatter(tz).formatToParts(asDate);
  let year = 0, month = 1, day = 1, hour = 0;
  for (const { type, value } of parts) {
    if (type === 'year') year = Number(value);
    else if (type === 'month') month = Number(value);
    else if (type === 'day') day = Number(value);
    else if (type === 'hour') hour = Number(value) % 24;
  }

  // The real year goes in BEFORE the hour subtraction, and via setUTCFullYear
  // rather than Date.UTC (which maps years 0-99 into the 1900s). Subtracting
  // first under a placeholder year would resolve a backwards day-roll against
  // that year's calendar: 2026-03-01 01:00 at cutoff 2 lands on Feb 29 under a
  // leap placeholder, and re-stamping the year then normalizes it forward to
  // Mar 1 -- a day late, in exactly the overnight case this feature is about.
  // Seeding from `new Date(0)` (Jan 1) means the three-arg setUTCFullYear never
  // passes through a short month.
  const shifted = new Date(0);
  shifted.setUTCFullYear(year, month - 1, day);
  shifted.setUTCHours(hour - safeCutoffHour(cutoffHour), 0, 0, 0);

  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');
  return `${shifted.getUTCFullYear()}-${m}-${d}`;
}

/** Config-object form of {@link toBusinessDay}, for threaded call sites. */
export function toBusinessDayFor(instant: Date | string, cfg: BusinessDayConfig): string {
  return toBusinessDay(instant, cfg.tz, cfg.cutoffHour);
}

/**
 * The frame that reproduces pre-cutoff bucketing byte for byte: the HOST zone,
 * no cutoff.
 *
 * Only two functions default to this -- calculateEmployeePay and
 * calculatePayrollPeriod -- because ~60 pre-existing test call sites pass three
 * arguments and cannot reach a trailing positional parameter. Every PRODUCTION
 * call site passes a real restaurant frame explicitly; a guard test asserts it.
 *
 * The host zone, not UTC. The code being replaced formatted with date-fns
 * `format()`, which reads the host's local fields -- the browser's zone in
 * production. Defaulting to UTC would therefore be a silent behavior CHANGE for
 * every non-UTC restaurant if a call site were ever missed, and payroll is the
 * wrong place to learn that. Defaulting to the host makes a missed call site
 * degrade to exactly today's numbers instead of to different wrong ones.
 *
 * Resolved once at module load: Intl reports the process zone, which a test
 * runner pins via TZ before any module evaluates.
 */
export const HOST_CALENDAR_DAY_FRAME: BusinessDayConfig = {
  tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
  cutoffHour: DEFAULT_BUSINESS_DAY_START_HOUR,
};
