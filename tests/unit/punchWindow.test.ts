import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, it, expect } from 'vitest';
import {
  OVERNIGHT_BUFFER_HOURS,
  bufferPunchFetchRange,
  lookaheadPunchFetchRange,
  isWithinWindow,
  periodsInWindow,
  periodsInBusinessDayWindow,
  incompleteShiftsInWindow,
  incompleteShiftsInBusinessDayWindow,
  sessionsWithClockInInWindow,
  businessDayPunchFetchRange,
} from '@/utils/punchWindow';
import { MAX_SHIFT_GAP_HOURS } from '@/utils/payrollCalculations';
import {
  toBusinessDayFor,
  businessDayStartInstant,
  MAX_BUSINESS_DAY_START_HOUR,
} from '@/lib/businessDay';
import { formatLocalDate } from '@/lib/shiftInterval';

const start = new Date('2026-07-06T00:00:00Z'); // Mon
const end = new Date('2026-07-12T23:59:59.999Z'); // Sun

describe('punchWindow', () => {
  it('buffer constant never drifts below the pairing gap cap', () => {
    expect(OVERNIGHT_BUFFER_HOURS).toBeGreaterThanOrEqual(MAX_SHIFT_GAP_HOURS);
  });

  it('bufferPunchFetchRange widens by ±18h in epoch ms', () => {
    const { fetchStart, fetchEnd } = bufferPunchFetchRange(start, end);
    expect(start.getTime() - fetchStart.getTime()).toBe(18 * 3600 * 1000);
    expect(fetchEnd.getTime() - end.getTime()).toBe(18 * 3600 * 1000);
  });

  it('lookaheadPunchFetchRange widens only the end, keeps the start', () => {
    const { fetchStart, fetchEnd } = lookaheadPunchFetchRange(start, end);
    expect(fetchStart.getTime()).toBe(start.getTime()); // NO look-back
    expect(fetchEnd.getTime() - end.getTime()).toBe(18 * 3600 * 1000);
  });

  it('periodsInWindow filters by clockIn when present (falls back to startTime)', () => {
    // A post-break work segment whose startTime is out-of-window but whose
    // shift clockIn is in-window must be KEPT (attributed to the clock-in period).
    const periods = [
      { startTime: new Date('2026-07-13T01:00:00Z'), clockIn: new Date('2026-07-12T20:00:00Z') }, // keep
      { startTime: new Date('2026-07-07T09:00:00Z'), clockIn: new Date('2026-07-13T01:00:00Z') }, // drop
    ];
    const kept = periodsInWindow(periods, start, end);
    expect(kept).toHaveLength(1);
    expect(kept[0].clockIn.toISOString()).toBe('2026-07-12T20:00:00.000Z');
  });

  it('Deno LABOR_FETCH_LOOKAHEAD_HOURS stays in parity with OVERNIGHT_BUFFER_HOURS', () => {
    // The Deno edge module can't import the TS client constant, so guard the
    // two independent literals against silent drift.
    const denoSrc = readFileSync(
      resolve(process.cwd(), 'supabase/functions/_shared/laborCalculations.ts'),
      'utf8',
    );
    const m = denoSrc.match(/LABOR_FETCH_LOOKAHEAD_HOURS\s*=\s*(\d+)/);
    expect(m, 'LABOR_FETCH_LOOKAHEAD_HOURS declaration not found').not.toBeNull();
    expect(Number(m![1])).toBe(OVERNIGHT_BUFFER_HOURS);
  });

  it('isWithinWindow is inclusive on both boundaries', () => {
    expect(isWithinWindow(start, start, end)).toBe(true);
    expect(isWithinWindow(end, start, end)).toBe(true);
    expect(isWithinWindow(new Date(start.getTime() - 1), start, end)).toBe(false);
    expect(isWithinWindow(new Date(end.getTime() + 1), start, end)).toBe(false);
  });

  it('periodsInWindow keeps by startTime, drops out-of-window', () => {
    const periods = [
      { startTime: new Date('2026-07-05T20:00:00Z') }, // before start → drop
      { startTime: new Date('2026-07-07T09:00:00Z') }, // in → keep
      { startTime: new Date('2026-07-13T01:00:00Z') }, // after end → drop
    ];
    expect(periodsInWindow(periods, start, end)).toHaveLength(1);
  });

  it('incompleteShiftsInWindow keeps by punchTime', () => {
    const shifts = [
      { punchTime: new Date('2026-07-05T23:00:00Z') }, // drop
      { punchTime: new Date('2026-07-08T02:00:00Z') }, // keep
    ];
    expect(incompleteShiftsInWindow(shifts, start, end)).toHaveLength(1);
  });

  it('sessionsWithClockInInWindow keeps by clock_in', () => {
    const sessions = [
      { clock_in: new Date('2026-07-07T18:00:00Z') }, // keep
      { clock_in: new Date('2026-07-13T00:30:00Z') }, // drop (next period)
    ];
    expect(sessionsWithClockInInWindow(sessions, start, end)).toHaveLength(1);
  });
});

describe('business-day windowing', () => {
  // Host-local calendar-day tokens, the shape Payroll.tsx builds from
  // startOfWeek/endOfWeek. Their local fields read back unchanged in any zone.
  const weekStart = new Date(2026, 6, 6); // Mon Jul 6
  const weekEnd = new Date(2026, 6, 12, 23, 59, 59, 999); // Sun Jul 12
  const TZ = 'America/Chicago';

  it('keeps a 01:00 Monday shift on the week whose business day owns it', () => {
    // 2026-07-13T06:00Z = Mon Jul 13, 01:00 CDT -> business day Sun Jul 12.
    const periods = [{ startTime: new Date('2026-07-13T06:00:00Z'), clockIn: new Date('2026-07-13T06:00:00Z') }];

    expect(periodsInBusinessDayWindow(periods, weekStart, weekEnd, { tz: TZ, cutoffHour: 2 })).toHaveLength(1);
    // At cutoff 0 it really is the next week's, and the raw-instant filter
    // agrees with both -- which is why this only shows up above cutoff 0.
    expect(periodsInBusinessDayWindow(periods, weekStart, weekEnd, { tz: TZ, cutoffHour: 0 })).toHaveLength(0);
    expect(periodsInWindow(periods, weekStart, weekEnd)).toHaveLength(0);
  });

  it('drops a 23:00 Sunday-before shift the raw-instant filter would also drop', () => {
    // 2026-07-06T04:00Z = Sun Jul 5, 23:00 CDT -> business day Jul 5 at any cutoff.
    const periods = [{ startTime: new Date('2026-07-06T04:00:00Z'), clockIn: new Date('2026-07-06T04:00:00Z') }];
    for (let cutoffHour = 0; cutoffHour <= MAX_BUSINESS_DAY_START_HOUR; cutoffHour++) {
      expect(periodsInBusinessDayWindow(periods, weekStart, weekEnd, { tz: TZ, cutoffHour })).toHaveLength(0);
    }
  });

  it('falls back to startTime when clockIn is absent, like periodsInWindow', () => {
    const periods = [{ startTime: new Date('2026-07-13T06:00:00Z') }];
    expect(periodsInBusinessDayWindow(periods, weekStart, weekEnd, { tz: TZ, cutoffHour: 2 })).toHaveLength(1);
  });

  it('incompleteShiftsInBusinessDayWindow windows by the anchor punch', () => {
    const shifts = [
      { punchTime: new Date('2026-07-13T06:00:00Z') }, // Jul 13 01:00 CDT -> Jul 12
      { punchTime: new Date('2026-07-06T04:00:00Z') }, // Jul 5 23:00 CDT -> Jul 5
    ];
    const kept = incompleteShiftsInBusinessDayWindow(shifts, weekStart, weekEnd, { tz: TZ, cutoffHour: 2 });
    expect(kept).toHaveLength(1);
    expect(kept[0].punchTime.toISOString()).toBe('2026-07-13T06:00:00.000Z');
  });

  /**
   * The invariant that makes the business-day filter safe: everything the
   * filter can KEEP must have been FETCHED. Anything it keeps that the fetch
   * missed is not merely mis-attributed -- the next period's filter rejects it
   * too, on a day token that starts later still, so those hours are paid on no
   * check at all.
   *
   * Stated on the fetch END: its business day must be strictly LATER than the
   * period's last day, so the whole of that last day was covered.
   * toBusinessDayFor is monotone in the instant, so the one comparison covers
   * the entire range below it. Mirrored on the fetch START.
   *
   * A fixed-hour buffer cannot satisfy this in general, which is why
   * businessDayPunchFetchRange exists: the bounds are day tokens in the
   * BROWSER's zone, the business day is resolved in the RESTAURANT's, and the
   * pairs below span 21 hours (Pacific/Auckland viewer, US-Pacific restaurant)
   * against an 18h buffer. The zone spread does not appear in the
   * business-day-anchored arithmetic at all.
   */
  it('the payroll fetch range covers every business day the filter selects', () => {
    // Winter and summer, so each zone is exercised on both sides of its DST
    // transition -- and Jan 4 / Jul 5 are Sundays, the shape startOfWeek gives.
    const WEEKS: ReadonlyArray<readonly [Date, Date]> = [
      [new Date(2026, 0, 4), new Date(2026, 0, 10, 23, 59, 59, 999)],
      [new Date(2026, 6, 5), new Date(2026, 6, 11, 23, 59, 59, 999)],
      // Spanning a US spring-forward (Mar 8) and a fall-back (Nov 1).
      [new Date(2026, 2, 8), new Date(2026, 2, 14, 23, 59, 59, 999)],
      [new Date(2026, 9, 25), new Date(2026, 9, 31, 23, 59, 59, 999)],
    ];
    for (const tz of ['America/Chicago', 'America/Los_Angeles', 'Pacific/Auckland', 'Asia/Kolkata', 'UTC']) {
      for (let cutoffHour = 0; cutoffHour <= MAX_BUSINESS_DAY_START_HOUR; cutoffHour++) {
        for (const [start, end] of WEEKS) {
          const cfg = { tz, cutoffHour };
          const { fetchStart, fetchEnd } = businessDayPunchFetchRange(start, end, cfg);
          const where = `${tz} @ cutoff ${cutoffHour}, week of ${formatLocalDate(start)}`;
          expect(
            toBusinessDayFor(fetchEnd, cfg) > formatLocalDate(end),
            `${where}: fetch stops inside the last business day`,
          ).toBe(true);
          expect(
            toBusinessDayFor(fetchStart, cfg) < formatLocalDate(start),
            `${where}: fetch starts inside the first business day`,
          ).toBe(true);
        }
      }
    }
  });

  it('leaves at least MAX_SHIFT_GAP_HOURS of pairing slack past the last business day', () => {
    // The buffer's remaining job: a clock-in in the last minute of the period's
    // last business day must have its clock_out fetched too, or the shift pairs
    // as incomplete and its hours are lost. OVERNIGHT_BUFFER_HOURS equals that
    // cap exactly, so there is no room to spare -- which is what
    // DST_SLACK_HOURS is for, and why the spring-forward row below is not
    // the same assertion twice.
    const CASES = [
      // Ordinary week: the day boundary is a real instant.
      { cutoffHour: 6, start: new Date(2026, 6, 5), end: new Date(2026, 6, 11, 23, 59, 59, 999), nextDay: '2026-07-12' },
      // The last business day ENDS at the skipped 02:00 of Mar 8, where
      // businessDayStartInstant necessarily lands an hour early.
      { cutoffHour: 2, start: new Date(2026, 2, 1), end: new Date(2026, 2, 7, 23, 59, 59, 999), nextDay: '2026-03-08' },
      // ...and at the doubled 01:00 of Nov 1, where it lands an hour LATE.
      { cutoffHour: 1, start: new Date(2026, 9, 26), end: new Date(2026, 9, 31, 23, 59, 59, 999), nextDay: '2026-11-01' },
    ];
    for (const { cutoffHour, start, end, nextDay } of CASES) {
      const cfg = { tz: 'America/Chicago', cutoffHour };
      const { fetchEnd } = businessDayPunchFetchRange(start, end, cfg);
      // The TRUE end of the last business day, not the possibly-early instant:
      // the first moment that reads as the next day.
      const nominal = businessDayStartInstant(nextDay, cfg);
      const trueEnd = toBusinessDayFor(nominal, cfg) === nextDay
        ? nominal
        : new Date(nominal.getTime() + 3_600_000);
      const slackHours = (fetchEnd.getTime() - trueEnd.getTime()) / 3_600_000;
      expect(slackHours, `cutoff ${cutoffHour}`).toBeGreaterThanOrEqual(MAX_SHIFT_GAP_HOURS);
    }
  });
});
