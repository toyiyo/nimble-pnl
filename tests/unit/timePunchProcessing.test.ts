import { describe, it, expect } from 'vitest';
import { processPunchesForPeriod } from '@/utils/timePunchProcessing';
import type { TimePunch } from '@/types/timeTracking';

const mk = (
  id: string,
  employee_id: string,
  punch_type: 'clock_in' | 'clock_out' | 'break_start' | 'break_end',
  punch_time: string,
): TimePunch =>
  ({
    id,
    restaurant_id: 'rest-1',
    employee_id,
    punch_type,
    punch_time,
    employee: { id: employee_id, name: employee_id, position: '' },
  }) as unknown as TimePunch;

const open = (s: { is_complete: boolean }) => !s.is_complete;

describe('normalizePunches — noise detection is per employee', () => {
  it('keeps both employees complete when they share identical in/out timestamps', () => {
    // Mirrors the production "Alexia vs Colin" case: imported punches with
    // identical round timestamps must not collapse across employees.
    const punches = [
      mk('a-in', 'empA', 'clock_in', '2026-06-22T15:00:00Z'),
      mk('b-in', 'empB', 'clock_in', '2026-06-22T15:00:00Z'),
      mk('a-out', 'empA', 'clock_out', '2026-06-22T19:00:00Z'),
      mk('b-out', 'empB', 'clock_out', '2026-06-22T19:00:00Z'),
    ];
    const { sessions } = processPunchesForPeriod(punches);
    expect(sessions).toHaveLength(2);
    expect(sessions.filter(open)).toHaveLength(0);
  });

  it('does not orphan a clock-in into a false open session when another employee punches within 60s', () => {
    // empB clock_in is first in the 15:00 cluster (survives) and empB clock_out
    // is second in the 19:00 cluster — under the old global logic empB's
    // clock_out was dropped, orphaning empB into a false "open session".
    const punches = [
      mk('b-in', 'empB', 'clock_in', '2026-06-22T15:00:00Z'),
      mk('a-in', 'empA', 'clock_in', '2026-06-22T15:00:30Z'),
      mk('a-out', 'empA', 'clock_out', '2026-06-22T19:00:00Z'),
      mk('b-out', 'empB', 'clock_out', '2026-06-22T19:00:30Z'),
    ];
    const { sessions } = processPunchesForPeriod(punches);
    expect(sessions.filter(open)).toHaveLength(0);
    expect(sessions.filter((s) => s.is_complete)).toHaveLength(2);
  });

  it('three employees clocking in the same second keep all three sessions', () => {
    const punches = [
      mk('a-in', 'empA', 'clock_in', '2026-06-22T15:00:00Z'),
      mk('b-in', 'empB', 'clock_in', '2026-06-22T15:00:00Z'),
      mk('c-in', 'empC', 'clock_in', '2026-06-22T15:00:00Z'),
      mk('a-out', 'empA', 'clock_out', '2026-06-22T19:00:00Z'),
      mk('b-out', 'empB', 'clock_out', '2026-06-22T19:00:00Z'),
      mk('c-out', 'empC', 'clock_out', '2026-06-22T19:00:00Z'),
    ];
    const { sessions, totalNoisePunches } = processPunchesForPeriod(punches);
    expect(sessions).toHaveLength(3);
    expect(sessions.filter((s) => s.is_complete)).toHaveLength(3);
    expect(totalNoisePunches).toBe(0);
  });

  it('still de-duplicates the SAME employee double-tapping within 60s', () => {
    const punches = [
      mk('in1', 'empA', 'clock_in', '2026-06-22T15:00:00Z'),
      mk('in2', 'empA', 'clock_in', '2026-06-22T15:00:10Z'), // duplicate
      mk('out', 'empA', 'clock_out', '2026-06-22T19:00:00Z'),
    ];
    const { sessions, totalNoisePunches } = processPunchesForPeriod(punches);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].is_complete).toBe(true);
    expect(totalNoisePunches).toBe(1);
  });
});

describe('normalizePunches — break_start→clock_in cancels the break', () => {
  it('marks break_start as noise when followed by clock_in within 60s', () => {
    // A break_start immediately cancelled by a clock_in within 60s (noise=break canceled).
    // The standalone clock_in + clock_out produces one complete session.
    const punches = [
      mk('in', 'empA', 'clock_in', '2026-06-22T09:00:00Z'),
      mk('out', 'empA', 'clock_out', '2026-06-22T10:00:00Z'),
      mk('bs', 'empA', 'break_start', '2026-06-22T11:00:00Z'),
      mk('ci', 'empA', 'clock_in', '2026-06-22T11:00:30Z'), // within 60s → break canceled
      mk('out2', 'empA', 'clock_out', '2026-06-22T15:00:00Z'),
    ];
    const { processedPunches, sessions } = processPunchesForPeriod(punches);
    const breakStartPunch = processedPunches.find(p => p.punch_type === 'break_start');
    expect(breakStartPunch?.is_noise).toBe(true);
    expect(breakStartPunch?.noise_reason).toBe('Break canceled');
    // Two complete sessions (pre-break and post-break)
    expect(sessions.filter(s => s.is_complete)).toHaveLength(2);
  });
});

describe('identifyWorkSessions — break handling', () => {
  it('records a complete break within a session', () => {
    const punches = [
      mk('in', 'empA', 'clock_in', '2026-06-22T09:00:00Z'),
      mk('bs', 'empA', 'break_start', '2026-06-22T12:00:00Z'),
      mk('be', 'empA', 'break_end', '2026-06-22T12:30:00Z'),
      mk('out', 'empA', 'clock_out', '2026-06-22T17:00:00Z'),
    ];
    const { sessions } = processPunchesForPeriod(punches);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].is_complete).toBe(true);
    expect(sessions[0].breaks).toHaveLength(1);
    expect(sessions[0].breaks[0].duration_minutes).toBe(30);
    expect(sessions[0].break_minutes).toBe(30);
    expect(sessions[0].worked_minutes).toBe(sessions[0].total_minutes - 30);
  });

  it('flags very short sessions (< 3 minutes) as anomalies', () => {
    const punches = [
      mk('in', 'empA', 'clock_in', '2026-06-22T09:00:00Z'),
      mk('out', 'empA', 'clock_out', '2026-06-22T09:01:00Z'), // only 1 minute
    ];
    const { sessions } = processPunchesForPeriod(punches);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].is_complete).toBe(true);
    expect(sessions[0].has_anomalies).toBe(true);
    expect(sessions[0].anomalies).toContain('Very short session (< 3 min) - possible error');
  });

  it('flags an incomplete break when session closes before break_end', () => {
    const punches = [
      mk('in', 'empA', 'clock_in', '2026-06-22T09:00:00Z'),
      mk('bs', 'empA', 'break_start', '2026-06-22T12:00:00Z'),
      // No break_end — session closes with a break still open
      mk('out', 'empA', 'clock_out', '2026-06-22T17:00:00Z'),
    ];
    const { sessions } = processPunchesForPeriod(punches);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].has_anomalies).toBe(true);
    expect(sessions[0].anomalies).toContain('Incomplete break (missing break end)');
    expect(sessions[0].breaks).toHaveLength(1);
    expect(sessions[0].breaks[0].is_complete).toBe(false);
  });
});

describe('identifyWorkSessions — does not skip the next clock-in', () => {
  it('keeps the real session after an orphan leading clock-in', () => {
    // zachary case: a stray midnight clock-in must not swallow the real
    // 10:02–14:03 session that follows it.
    const punches = [
      mk('orphan', 'empZ', 'clock_in', '2026-06-22T00:00:00Z'),
      mk('in', 'empZ', 'clock_in', '2026-06-22T10:02:00Z'),
      mk('out', 'empZ', 'clock_out', '2026-06-22T14:03:00Z'),
    ];
    const { sessions } = processPunchesForPeriod(punches);
    expect(sessions).toHaveLength(2);
    const complete = sessions.filter((s) => s.is_complete);
    expect(complete).toHaveLength(1);
    expect(complete[0].clock_in.toISOString()).toBe('2026-06-22T10:02:00.000Z');
    expect(complete[0].clock_out?.toISOString()).toBe('2026-06-22T14:03:00.000Z');
    // the orphan correctly remains a single open session
    expect(sessions.filter((s) => !s.is_complete)).toHaveLength(1);
  });

  it('keeps both back-to-back complete sessions for one employee', () => {
    const punches = [
      mk('in1', 'empA', 'clock_in', '2026-06-22T09:00:00Z'),
      mk('out1', 'empA', 'clock_out', '2026-06-22T12:00:00Z'),
      mk('in2', 'empA', 'clock_in', '2026-06-22T13:00:00Z'),
      mk('out2', 'empA', 'clock_out', '2026-06-22T17:00:00Z'),
    ];
    const { sessions } = processPunchesForPeriod(punches);
    expect(sessions).toHaveLength(2);
    expect(sessions.filter((s) => s.is_complete)).toHaveLength(2);
  });
});
