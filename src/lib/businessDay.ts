import { toZonedTime } from 'date-fns-tz';
import { toDateOnlyString } from '@/lib/dateOnly';
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
 *   toZonedTime          <-> AT TIME ZONE v_tz  (both yield naive local wall clock)
 *   setHours(getHours()-h) <-> - make_interval(hours => h)
 *   toDateOnlyString     <-> ::date
 *   validateTimeZone     <-> COALESCE(NULLIF(v_tz,'')) + the exception probe
 *   safeCutoffHour       <-> COALESCE(v_hour, 0) + the CHECK constraint
 *
 * ORDER IS LOAD-BEARING: convert first, then subtract. The other order
 * subtracts elapsed rather than wall-clock time and disagrees by a full
 * calendar day inside the fall-back repeated hour. Design doc section 4.1.
 */
export function toBusinessDay(
  instant: Date | string,
  tz: string | null | undefined,
  cutoffHour: number | null | undefined,
): string {
  const asDate = typeof instant === 'string' ? new Date(instant) : instant;
  const zoned = toZonedTime(asDate, validateTimeZone(tz));
  zoned.setHours(zoned.getHours() - safeCutoffHour(cutoffHour));
  return toDateOnlyString(zoned);
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
