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
