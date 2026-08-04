/**
 * ShiftInterval — pure value object representing a shift's time window.
 *
 * Handles standard and midnight-crossing shifts, validates duration
 * constraints, detects overlaps, and computes rest-hour gaps.
 */
import { toZonedTime } from 'date-fns-tz';

import { addDaysToDateStr, daysBetweenDateStrs, isValidTimezone, parseWallClock } from '@/lib/restaurantClock';

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
    // `endTime < startTime` is an INFERENCE, and it can only ever infer an
    // offset of 0 or 1 — it is the right default for a form that collects a
    // single date plus two clocks, and wrong for any caller that already
    // knows the real offset. Those callers use `createSpanning` instead.
    return ShiftInterval.createSpanning(
      businessDate,
      startTime,
      endTime,
      endTime < startTime ? 1 : 0,
      tz,
    );
  }

  /**
   * Create from a business date, HH:MM start/end times, and an EXPLICIT
   * end-day offset in whole calendar days, all resolved against `tz`.
   *
   * `create`'s `endTime < startTime` heuristic can only distinguish
   * "same day" from "next day", so it silently collapses any shift whose end
   * lands two or more days out, and — worse — collapses a shift ending on a
   * later day at an equal-or-later wall clock (Mon 09:00 -> Tue 17:00 reads
   * as 09:00 -> 17:00, 8h instead of 32h; Mon 09:00 -> Tue 09:00 reads as a
   * zero-length interval and throws). Those shifts are creatable: ShiftDialog
   * collects the start date and end date independently and only rejects
   * `end <= start`, and a >16h duration is a warning here, never a rejection.
   *
   * So every caller that REPROJECTS an existing shift onto a new date — drag
   * copy, copy week, recurring children — must pass the offset it read off
   * the source instead of letting it be re-inferred from the clocks. Derive
   * it with `localDayOffsetInTz`.
   *
   * Both endpoints are still resolved independently through
   * `wallClockToInstant`, so the DST behaviour is unchanged: a reprojected
   * shift keeps its wall clocks and its calendar span, and its elapsed
   * duration is whatever those imply on the target dates.
   */
  static createSpanning(
    businessDate: string,
    startTime: string,
    endTime: string,
    endDayOffset: number,
    tz: string,
  ): ShiftInterval {
    if (!Number.isInteger(endDayOffset) || endDayOffset < 0) {
      throw new TypeError('INVALID_DATE');
    }

    const startAt = wallClockToInstant(businessDate, startTime, tz);
    // Roll the end date with UTC field arithmetic (never `setDate` on a
    // host-local `Date`, which would drift under a host TZ offset from UTC),
    // then resolve the rolled date's wall clock in `tz`.
    const endDateStr = endDayOffset === 0 ? businessDate : addDaysToDateStr(businessDate, endDayOffset);
    const endAt = wallClockToInstant(endDateStr, endTime, tz);

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

/**
 * Extract wall-clock `HH:MM` (no seconds) from a UTC ISO string in an
 * explicit IANA timezone -- the truncated form every `wallClockToInstant`
 * caller needs. Factors out the `formatLocalTimeInTz(iso, tz).slice(0, 5)`
 * idiom that was duplicated across `ShiftDialog.tsx`, `useShiftCopyDnd.ts`,
 * `copyWeekShifts.ts` and `useShifts.tsx` -- each re-deriving the same
 * assumption about `formatLocalTimeInTz`'s `HH:MM:SS` output shape.
 */
export function formatLocalHHMMInTz(isoString: string, tz: string): string {
  return formatLocalTimeInTz(isoString, tz).slice(0, 5);
}

/**
 * Whole calendar days between two instants, measured on the RESTAURANT's
 * calendar (`tz`), not the viewer's. The third thing a reprojection must
 * carry, alongside the two wall clocks: `formatLocalHHMMInTz` throws away
 * which day each endpoint falls on, and for any shift longer than an
 * overnight that information is not recoverable from the clocks alone.
 *
 * Feed the result to `ShiftInterval.createSpanning` as `endDayOffset`.
 */
export function localDayOffsetInTz(startIso: string, endIso: string, tz: string): number {
  return daysBetweenDateStrs(
    formatLocalDateInTz(new Date(startIso), tz),
    formatLocalDateInTz(new Date(endIso), tz),
  );
}

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM_RE = /^\d{2}:\d{2}$/;

/**
 * True when `YYYY-MM-DD` + `HH:MM` name a wall clock that actually exists on
 * the calendar. The regexes above only check SHAPE: `2026-02-31` and `25:99`
 * both match, and every downstream date constructor -- `Date.UTC`,
 * `new Date(...)`, Postgres' `::timestamp` -- would rather normalise them
 * (to March 3rd, to the next day at 02:39) than complain.
 *
 * Normalising is the dangerous outcome here, not the noisy one. A silently
 * rolled-forward date produces a shift on a day nobody asked for, and it is
 * indistinguishable downstream from a shift that was scheduled there on
 * purpose -- so it survives review, sync and payroll as if it were intended.
 * A throw stops at the call site.
 *
 * Implemented as a `Date.UTC` round trip rather than per-field range tables
 * so leap years stay correct by construction: 2024-02-29 survives the trip,
 * 2025-02-29 becomes March 1st and is caught. Comparing the full year (not
 * its last two digits) also catches `Date.UTC`'s 0-99 => 1900+n remapping.
 */
function isRealWallClock(dateStr: string, timeHHMM: string): boolean {
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hour, minute] = timeHHMM.split(':').map(Number);

  const probe = new Date(Date.UTC(year, month - 1, day, hour, minute));

  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day &&
    probe.getUTCHours() === hour &&
    probe.getUTCMinutes() === minute
  );
}

/**
 * Guard for every `tz`-dependent create/update path: throws
 * `TypeError('INVALID_DATE')` when `tz` is absent, rather than letting a
 * call site silently fall back to the browser's own zone -- the exact class
 * of bug this file's converters exist to fix. Shared by
 * `useValidatedShiftMutations.ts`, `useShiftPlanner.ts` and `useShifts.tsx`,
 * which previously each inlined the identical 3-line check.
 */
export function requireTz(tz: string | null | undefined): asserts tz is string {
  if (!tz) {
    throw new TypeError('INVALID_DATE');
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
 *   empty/invalid `tz` throws here before `parseWallClock` ever runs. The
 *   check itself (`isValidTimezone`) shares `restaurantClock.ts`'s cached
 *   `Intl.DateTimeFormat` construction rather than building a throwaway
 *   formatter of its own -- it still returns a boolean with no fallback, so
 *   the "no silent default" invariant is unchanged, only the underlying
 *   validity check's cost is.
 * - `dateStr` / `timeHHMM`: `parseWallClock` routes malformed input through a
 *   `reject()` helper that throws in DEV/test but, in production, logs and
 *   returns a fallback instant. `ShiftInterval`'s existing contract is a
 *   throw in every environment (see `shiftInterval.test.ts`'s
 *   `ShiftInterval.create` validation cases), so this adapter gates its own
 *   inputs to preserve that contract regardless of environment. The gate is
 *   two-part on purpose: the regexes reject the wrong SHAPE, and
 *   `isRealWallClock` rejects the right shape naming a nonexistent day or
 *   time (`2026-02-31`, `25:99`), which would otherwise be normalised into a
 *   plausible-looking instant on a date nobody asked for.
 *
 * Returns a `Date` (unlike `parseWallClock`, which returns an ISO string).
 */
export function wallClockToInstant(dateStr: string, timeHHMM: string, tz: string): Date {
  if (!DATE_ONLY_RE.test(dateStr) || !HHMM_RE.test(timeHHMM)) {
    throw new TypeError('INVALID_DATE');
  }
  if (!isRealWallClock(dateStr, timeHHMM)) {
    throw new TypeError('INVALID_DATE');
  }
  if (!isValidTimezone(tz)) {
    throw new TypeError('INVALID_DATE');
  }

  return new Date(parseWallClock(`${dateStr}T${timeHHMM}`, tz));
}
