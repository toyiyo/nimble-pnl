/**
 * ShiftInterval — pure value object representing a shift's time window.
 *
 * Handles standard and midnight-crossing shifts, validates duration
 * constraints, detects overlaps, and computes rest-hour gaps.
 */
import { toZonedTime } from 'date-fns-tz';

import { addDaysToDateStr, parseWallClock } from '@/lib/restaurantClock';

export interface DurationWarning {
  code: 'TOO_SHORT' | 'MAX_ENDURANCE';
  message: string;
}

export class ShiftInterval {
  readonly startAt: Date;
  readonly endAt: Date;
  readonly businessDate: string; // YYYY-MM-DD
  readonly durationWarnings: DurationWarning[];

  private constructor(startAt: Date, endAt: Date, businessDate: string, durationWarnings: DurationWarning[] = []) {
    this.startAt = startAt;
    this.endAt = endAt;
    this.businessDate = businessDate;
    this.durationWarnings = durationWarnings;
  }

  // ---------------------------------------------------------------------------
  // Factories
  // ---------------------------------------------------------------------------

  /**
   * Create from a business date and HH:MM start/end times, resolved against
   * the restaurant's timezone (`tz`, required and positional — every call
   * site names its zone explicitly rather than falling back to the host's).
   * Automatically detects midnight crossing (endTime < startTime).
   */
  static create(businessDate: string, startTime: string, endTime: string, tz: string): ShiftInterval {
    const startAt = wallClockToInstant(businessDate, startTime, tz);

    let endAt: Date;
    if (endTime < startTime) {
      // Midnight crossing — end falls on the next calendar day. Roll the
      // date with UTC field arithmetic (never `setDate` on a host-local
      // `Date`, which would drift under a host TZ offset from UTC), then
      // resolve the rolled date's wall clock in `tz`.
      const nextDateStr = addDaysToDateStr(businessDate, 1);
      endAt = wallClockToInstant(nextDateStr, endTime, tz);
    } else {
      endAt = wallClockToInstant(businessDate, endTime, tz);
    }

    return ShiftInterval.validateAndConstruct(startAt, endAt, businessDate);
  }

  /**
   * Create from full ISO-8601 timestamp strings (e.g. from the database).
   */
  static fromTimestamps(startIso: string, endIso: string, businessDate: string): ShiftInterval {
    const startAt = new Date(startIso);
    const endAt = new Date(endIso);
    return ShiftInterval.validateAndConstruct(startAt, endAt, businessDate);
  }

  // ---------------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------------

  private static validateAndConstruct(
    startAt: Date,
    endAt: Date,
    businessDate: string,
  ): ShiftInterval {
    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
      throw new TypeError('INVALID_DATE');
    }

    const durationMs = endAt.getTime() - startAt.getTime();
    const durationMinutes = durationMs / 60_000;

    if (durationMs <= 0) {
      throw new Error('INVALID_DURATION');
    }

    const warnings: DurationWarning[] = [];
    if (durationMinutes < 15) {
      warnings.push({ code: 'TOO_SHORT', message: `Shift is only ${durationMinutes} minutes (minimum 15)` });
    }
    if (durationMinutes > 16 * 60) {
      warnings.push({ code: 'MAX_ENDURANCE', message: `Shift is ${(durationMinutes / 60).toFixed(1)}h (maximum 16h)` });
    }

    return new ShiftInterval(startAt, endAt, businessDate, warnings);
  }

  // ---------------------------------------------------------------------------
  // Computed properties
  // ---------------------------------------------------------------------------

  get durationInMinutes(): number {
    return (this.endAt.getTime() - this.startAt.getTime()) / 60_000;
  }

  get durationInHours(): number {
    return this.durationInMinutes / 60;
  }

  /**
   * True when the shift's end time falls on a different calendar day than
   * the business date, evaluated in `tz` (the restaurant's timezone) rather
   * than the browser's — a method, not a getter, because "which calendar
   * day" is timezone-dependent and there is no host-local answer.
   */
  endsOnNextDay(tz: string): boolean {
    return formatLocalDateInTz(this.endAt, tz) !== this.businessDate;
  }

  // ---------------------------------------------------------------------------
  // Overlap & gap analysis
  // ---------------------------------------------------------------------------

  /** Two intervals overlap when A.start < B.end AND B.start < A.end. */
  overlapsWith(other: ShiftInterval): boolean {
    return this.startAt < other.endAt && other.startAt < this.endAt;
  }

  /**
   * Hours of rest between this shift's end and the other shift's start.
   * Returns 0 when shifts overlap or abut.
   */
  restHoursUntil(other: ShiftInterval): number {
    const gapMs = other.startAt.getTime() - this.endAt.getTime();
    if (gapMs <= 0) return 0;
    return gapMs / 3_600_000;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format YYYY-MM-DD as a readable label like "Mon, Mar 3". Uses noon anchor to avoid timezone edge cases. */
export function formatDayLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

/** Format a Date as YYYY-MM-DD using the local timezone (avoids UTC-shift bugs). */
export function formatLocalDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Format a Date as YYYY-MM-DD using an explicit IANA timezone (e.g. the
 * restaurant's), not the browser's local timezone. Use this (instead of
 * `formatLocalDate`) whenever bucketing a UTC instant (shift.start_time) by
 * calendar day needs to agree with restaurant-tz-aware server logic (e.g.
 * `(start_time AT TIME ZONE p_tz)::date` in shift_template_assigned_count) —
 * `formatLocalDate(new Date(iso))` uses the viewer's browser timezone and can
 * bucket a shift under the wrong day when the two timezones differ near
 * local midnight.
 */
export function formatLocalDateInTz(date: Date, tz: string): string {
  return formatLocalDate(toZonedTime(date, tz));
}

/**
 * Extract wall-clock HH:MM:SS from a UTC ISO string in an explicit IANA
 * timezone (e.g. the restaurant's), not the browser's. Companion to
 * `formatLocalDateInTz`: use this (instead of the browser-local
 * `formatLocalTime`) when matching a shift's time-of-day against a template's
 * `start_time`/`end_time`, which are stored in restaurant-local wall clock.
 * A viewer in a different timezone would otherwise derive the wrong HH:MM:SS
 * and mis-match (or fail to match) the legacy fallback.
 */
export function formatLocalTimeInTz(isoString: string, tz: string): string {
  const d = toZonedTime(new Date(isoString), tz);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM_RE = /^\d{2}:\d{2}$/;

/** True when `tz` is non-empty and accepted by `Intl.DateTimeFormat`. */
function isValidTz(tz: string): boolean {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve a restaurant-local wall clock (a calendar date + HH:MM, as entered
 * in a shift form) to the UTC instant it names, with Postgres-identical DST
 * semantics. The inverse of `formatLocalDateInTz` + `formatLocalTimeInTz`.
 *
 * A thin adapter over `restaurantClock.ts::parseWallClock`, which owns the
 * actual DST-resolution algorithm (see its doc comment). This wrapper's own
 * validation is load-bearing, not decorative: `parseWallClock` cannot be
 * relied on for either check it performs here.
 *
 * - `tz`: `parseWallClock` opens with `safeTz()`, which maps an empty or
 *   invalid zone to `America/Chicago` *silently*. Delegating without this
 *   check would relocate the timezone bug rather than fix it, so an
 *   empty/invalid `tz` throws here before `parseWallClock` ever runs.
 * - `dateStr` / `timeHHMM`: `parseWallClock` routes malformed input through a
 *   `reject()` helper that throws in DEV/test but, in production, logs and
 *   returns a fallback instant. `ShiftInterval`'s existing contract is a
 *   throw in every environment (see `shiftInterval.test.ts`'s
 *   `ShiftInterval.create` validation cases), so this adapter regex-gates
 *   its own inputs to preserve that contract regardless of environment.
 *
 * Returns a `Date` (unlike `parseWallClock`, which returns an ISO string).
 */
export function wallClockToInstant(dateStr: string, timeHHMM: string, tz: string): Date {
  if (!DATE_ONLY_RE.test(dateStr) || !HHMM_RE.test(timeHHMM)) {
    throw new TypeError('INVALID_DATE');
  }
  if (!isValidTz(tz)) {
    throw new TypeError('INVALID_DATE');
  }

  return new Date(parseWallClock(`${dateStr}T${timeHHMM}`, tz));
}
