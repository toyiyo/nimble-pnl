import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, it, expect } from 'vitest';
import { startOfWeek, endOfWeek } from 'date-fns';
import {
  OVERNIGHT_BUFFER_HOURS,
  bufferPunchFetchRange,
  lookaheadPunchFetchRange,
  weekAlignedFetchStart,
  weekAlignedFetchEnd,
  isWithinWindow,
  periodsInWindow,
  incompleteShiftsInWindow,
  sessionsWithClockInInWindow,
} from '@/utils/punchWindow';
import { MAX_SHIFT_GAP_HOURS } from '@/utils/payrollCalculations';
import { WEEK_STARTS_ON } from '@/lib/dateConfig';

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

  // weekAlignedFetchStart / weekAlignedFetchEnd: sound-logic follow-up fix —
  // the OT-banding fetch window must widen on BOTH edges to the full ISO
  // week, not just backward. Local (non-UTC-string) Date constructors are
  // used below so the "mid-week" premise holds under every host TZ the
  // suite runs in.
  it('weekAlignedFetchStart widens backward to the ISO week start when dateFrom falls mid-week', () => {
    const dateFrom = new Date(2026, 6, 22, 12, 0, 0); // 2026-07-22, a Wednesday, local noon
    const fetchStart = dateFrom; // e.g. lookaheadPunchFetchRange keeps the start unchanged
    const result = weekAlignedFetchStart(dateFrom, fetchStart);
    expect(result.getTime()).toBe(startOfWeek(dateFrom, { weekStartsOn: WEEK_STARTS_ON }).getTime());
    expect(result.getTime()).toBeLessThan(fetchStart.getTime());
  });

  it('weekAlignedFetchStart leaves fetchStart unchanged when it already precedes the ISO week start', () => {
    const dateFrom = new Date(2026, 6, 22, 12, 0, 0);
    const earlierFetchStart = new Date(dateFrom.getTime() - 30 * 24 * 3600 * 1000); // a month back
    const result = weekAlignedFetchStart(dateFrom, earlierFetchStart);
    expect(result.getTime()).toBe(earlierFetchStart.getTime());
  });

  it('weekAlignedFetchEnd widens forward to the ISO week end when dateTo falls mid-week', () => {
    const dateTo = new Date(2026, 6, 22, 12, 0, 0); // 2026-07-22, a Wednesday, local noon
    const fetchEnd = dateTo;
    const result = weekAlignedFetchEnd(dateTo, fetchEnd);
    expect(result.getTime()).toBe(endOfWeek(dateTo, { weekStartsOn: WEEK_STARTS_ON }).getTime());
    expect(result.getTime()).toBeGreaterThan(fetchEnd.getTime());
  });

  it('weekAlignedFetchEnd leaves fetchEnd unchanged when it already follows the ISO week end', () => {
    const dateTo = new Date(2026, 6, 22, 12, 0, 0);
    const laterFetchEnd = new Date(dateTo.getTime() + 30 * 24 * 3600 * 1000); // a month ahead
    const result = weekAlignedFetchEnd(dateTo, laterFetchEnd);
    expect(result.getTime()).toBe(laterFetchEnd.getTime());
  });
});
