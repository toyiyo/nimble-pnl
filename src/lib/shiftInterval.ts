/**
 * ShiftInterval — pure value object representing a shift's time window.
 *
 * Handles standard and midnight-crossing shifts, validates duration
 * constraints, detects overlaps, and computes rest-hour gaps.
 */
export class ShiftInterval {
  readonly startAt: Date;
  readonly endAt: Date;
  readonly businessDate: string; // YYYY-MM-DD

  private constructor(startAt: Date, endAt: Date, businessDate: string) {
    this.startAt = startAt;
    this.endAt = endAt;
    this.businessDate = businessDate;
  }

  // ---------------------------------------------------------------------------
  // Factories
  // ---------------------------------------------------------------------------

  /**
   * Create from a business date and HH:MM start/end times.
   * Automatically detects midnight crossing (endTime < startTime).
   */
  static create(businessDate: string, startTime: string, endTime: string): ShiftInterval {
    const startAt = new Date(`${businessDate}T${startTime}:00`);

    let endAt: Date;
    if (endTime < startTime) {
      // Midnight crossing — end falls on the next calendar day
      const nextDay = new Date(`${businessDate}T00:00:00`);
      nextDay.setDate(nextDay.getDate() + 1);
      const nextDateStr = formatLocalDate(nextDay);
      endAt = new Date(`${nextDateStr}T${endTime}:00`);
    } else {
      endAt = new Date(`${businessDate}T${endTime}:00`);
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
    if (isNaN(startAt.getTime()) || isNaN(endAt.getTime())) {
      throw new Error('INVALID_DATE');
    }

    const durationMs = endAt.getTime() - startAt.getTime();
    const durationMinutes = durationMs / 60_000;

    if (durationMs <= 0) {
      throw new Error('INVALID_DURATION');
    }
    if (durationMinutes < 15) {
      throw new Error('TOO_SHORT');
    }
    if (durationMinutes > 16 * 60) {
      throw new Error('MAX_ENDURANCE');
    }

    return new ShiftInterval(startAt, endAt, businessDate);
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

  /** True when the shift's end time falls on a different calendar day than the business date. */
  get endsOnNextDay(): boolean {
    return formatLocalDate(this.endAt) !== this.businessDate;
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
