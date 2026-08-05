import { describe, it, expect } from 'vitest';
import { hoursByClockInDay } from '@/utils/timecardHours';

const punch = (type: string, iso: string) => ({
  id: `${type}-${iso}`, employee_id: 'e1', restaurant_id: 'r1',
  punch_type: type, punch_time: iso,
}) as any;

// Every fixture below is an explicit UTC instant, and the restaurant zone is
// pinned, so the expected days are the same in every host TZ. The `days` array
// still uses `new Date(y, m, d)` because those are calendar-day tokens — the
// map's keys — not instants.
const TZ = 'America/Chicago';

describe('hoursByClockInDay', () => {
  it('attributes an overnight shift entirely to the clock-in restaurant day', () => {
    // Thu Jul 9 23:00 CDT -> Fri Jul 10 07:00 CDT (8h).
    const days = [new Date(2026, 6, 9), new Date(2026, 6, 10)]; // Thu, Fri
    const punches = [
      punch('clock_in', '2026-07-10T04:00:00Z'),
      punch('clock_out', '2026-07-10T12:00:00Z'),
    ];
    const map = hoursByClockInDay(punches, days, TZ);
    expect(map.get('2026-07-09')!.netHours).toBeCloseTo(8, 5);
    expect(map.get('2026-07-10')!.netHours).toBeCloseTo(0, 5);
  });

  it('subtracts breaks from the same clock-in day', () => {
    const days = [new Date(2026, 6, 9)];
    const punches = [
      punch('clock_in', '2026-07-09T14:00:00Z'), // 09:00 CDT
      punch('break_start', '2026-07-09T17:00:00Z'), // 12:00 CDT
      punch('break_end', '2026-07-09T17:30:00Z'), // 12:30 CDT
      punch('clock_out', '2026-07-09T22:00:00Z'), // 17:00 CDT
    ];
    const d = hoursByClockInDay(punches, days, TZ).get('2026-07-09')!;
    expect(d.totalHours).toBeCloseTo(8, 5);
    expect(d.breakHours).toBeCloseTo(0.5, 5);
    expect(d.netHours).toBeCloseTo(7.5, 5);
  });

  it('ignores shifts whose clock-in day is outside the displayed range', () => {
    const days = [new Date(2026, 6, 10)];
    const punches = [
      punch('clock_in', '2026-07-09T14:00:00Z'), // Jul 9 09:00 CDT
      punch('clock_out', '2026-07-09T22:00:00Z'), // Jul 9 17:00 CDT
    ];
    expect(hoursByClockInDay(punches, days, TZ).get('2026-07-10')!.netHours).toBeCloseTo(0, 5);
  });

  it('attributes by the restaurant day, not the viewer local day', () => {
    // Wed Jul 8 21:30 CDT -> Thu Jul 9 01:30 CDT (4h). The clock-in instant is
    // Jul 9 in UTC (which is what CI runs) and in Pacific/Auckland, so reading
    // the host's calendar fields would file these hours under Thursday.
    const days = [new Date(2026, 6, 8), new Date(2026, 6, 9)]; // Wed, Thu
    const punches = [
      punch('clock_in', '2026-07-09T02:30:00Z'),
      punch('clock_out', '2026-07-09T06:30:00Z'),
    ];
    const map = hoursByClockInDay(punches, days, TZ);
    expect(map.get('2026-07-08')!.netHours).toBeCloseTo(4, 5);
    expect(map.get('2026-07-09')!.netHours).toBeCloseTo(0, 5);
  });

  it('attributes an overnight shift across US spring-forward DST to the clock-in day', () => {
    // US DST spring-forward: Sun 2026-03-08 02:00 -> 03:00 in Chicago. Clock in
    // Sat Mar 7 23:00 CST (05:00Z Mar 8), clock out Sun Mar 8 07:00 CDT (12:00Z)
    // -- 7 wall-clock-labelled hours apart but 7h of real elapsed time, since
    // the 02:00 hour never happened.
    const days = [new Date(2026, 2, 7), new Date(2026, 2, 8)]; // Sat, Sun
    const punches = [
      punch('clock_in', '2026-03-08T05:00:00Z'),
      punch('clock_out', '2026-03-08T12:00:00Z'),
    ];
    const map = hoursByClockInDay(punches, days, TZ);
    expect(map.get('2026-03-07')!.netHours).toBeCloseTo(7, 5); // whole shift on Mar 7
    expect(map.get('2026-03-08')!.netHours).toBeCloseTo(0, 5); // nothing bled to Mar 8
  });
});
