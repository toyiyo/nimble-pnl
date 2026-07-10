import { describe, it, expect } from 'vitest';
import {
  OVERNIGHT_BUFFER_HOURS,
  bufferPunchFetchRange,
  isWithinWindow,
  periodsInWindow,
  incompleteShiftsInWindow,
  sessionsWithClockInInWindow,
} from '@/utils/punchWindow';
import { MAX_SHIFT_GAP_HOURS } from '@/utils/payrollCalculations';

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
