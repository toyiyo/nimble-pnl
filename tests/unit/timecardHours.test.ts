import { describe, it, expect } from 'vitest';
import { hoursByClockInDay } from '@/utils/timecardHours';

const punch = (type: string, iso: string) => ({
  id: `${type}-${iso}`, employee_id: 'e1', restaurant_id: 'r1',
  punch_type: type, punch_time: iso,
}) as any;

describe('hoursByClockInDay', () => {
  it('attributes an overnight shift entirely to the clock-in local day', () => {
    // Thu 23:00 -> Fri 07:00 (8h). Buffered punches may include neighbours.
    const days = [new Date(2026, 6, 9), new Date(2026, 6, 10)]; // Thu, Fri (local)
    const punches = [
      punch('clock_in', new Date(2026, 6, 9, 23, 0).toISOString()),
      punch('clock_out', new Date(2026, 6, 10, 7, 0).toISOString()),
    ];
    const map = hoursByClockInDay(punches, days);
    expect(map.get('2026-07-09')!.netHours).toBeCloseTo(8, 5);
    expect(map.get('2026-07-10')!.netHours).toBeCloseTo(0, 5);
  });

  it('subtracts breaks from the same clock-in day', () => {
    const days = [new Date(2026, 6, 9)];
    const punches = [
      punch('clock_in', new Date(2026, 6, 9, 9, 0).toISOString()),
      punch('break_start', new Date(2026, 6, 9, 12, 0).toISOString()),
      punch('break_end', new Date(2026, 6, 9, 12, 30).toISOString()),
      punch('clock_out', new Date(2026, 6, 9, 17, 0).toISOString()),
    ];
    const d = hoursByClockInDay(punches, days).get('2026-07-09')!;
    expect(d.totalHours).toBeCloseTo(8, 5);
    expect(d.breakHours).toBeCloseTo(0.5, 5);
    expect(d.netHours).toBeCloseTo(7.5, 5);
  });

  it('ignores shifts whose clock-in day is outside the displayed range', () => {
    const days = [new Date(2026, 6, 10)];
    const punches = [
      punch('clock_in', new Date(2026, 6, 9, 9, 0).toISOString()),
      punch('clock_out', new Date(2026, 6, 9, 17, 0).toISOString()),
    ];
    expect(hoursByClockInDay(punches, days).get('2026-07-10')!.netHours).toBeCloseTo(0, 5);
  });
});
