import { describe, it, expect } from 'vitest';
import { hoursByClockInDay, punchesByBusinessDay } from '@/utils/timecardHours';
import { HOST_LOCAL_FRAME } from './fixtures/businessDayFixtures';

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
    const map = hoursByClockInDay(punches, days, HOST_LOCAL_FRAME);
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
    const d = hoursByClockInDay(punches, days, HOST_LOCAL_FRAME).get('2026-07-09')!;
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
    expect(hoursByClockInDay(punches, days, HOST_LOCAL_FRAME).get('2026-07-10')!.netHours).toBeCloseTo(0, 5);
  });

  it('attributes an overnight shift across US spring-forward DST to the clock-in local day', () => {
    // US DST spring-forward: Sun 2026-03-08 02:00 → 03:00. Shift clock-in the
    // evening before (Sat Mar 7 23:00 local) → Sun Mar 8 07:00 local crosses the
    // transition. `new Date(y, m, d, h)` pins to local time in any process TZ, so
    // this asserts attribution lands on the clock-in local day regardless of TZ.
    const days = [new Date(2026, 2, 7), new Date(2026, 2, 8)]; // Sat, Sun (local)
    const punches = [
      punch('clock_in', new Date(2026, 2, 7, 23, 0).toISOString()),
      punch('clock_out', new Date(2026, 2, 8, 7, 0).toISOString()),
    ];
    const map = hoursByClockInDay(punches, days, HOST_LOCAL_FRAME);
    expect(map.get('2026-03-07')!.netHours).toBeGreaterThan(0); // whole shift on Mar 7
    expect(map.get('2026-03-08')!.netHours).toBeCloseTo(0, 5);   // nothing bled to Mar 8
  });
});

/**
 * Cutoff-aware behaviour. The fixtures above use HOST_LOCAL_FRAME to pin the
 * pre-cutoff contract; these name a real restaurant zone and exercise the
 * cutoff, which is the whole point of the feature.
 */
const TZ = 'America/Chicago';

describe('hoursByClockInDay with a cutoff', () => {
  it('rolls a 1 AM shift back onto the prior business day at cutoff 2', () => {
    const days = [new Date(2026, 6, 28), new Date(2026, 6, 29)];
    const punches = [
      punch('clock_in', '2026-07-29T06:00:00.000Z'),  // 01:00 CDT Jul 29
      punch('clock_out', '2026-07-29T12:00:00.000Z'), // 07:00 CDT Jul 29
    ];

    const atTwo = hoursByClockInDay(punches, days, { tz: TZ, cutoffHour: 2 });
    expect(atTwo.get('2026-07-28')!.netHours).toBeCloseTo(6, 5);
    expect(atTwo.get('2026-07-29')!.netHours).toBeCloseTo(0, 5);

    // Cutoff 0 is the restaurant-local calendar day -- the shift stays put.
    const atZero = hoursByClockInDay(punches, days, { tz: TZ, cutoffHour: 0 });
    expect(atZero.get('2026-07-28')!.netHours).toBeCloseTo(0, 5);
    expect(atZero.get('2026-07-29')!.netHours).toBeCloseTo(6, 5);
  });

  it('conserves hours across every cutoff', () => {
    // A window wide enough that no shift falls off either edge.
    const days = Array.from({ length: 5 }, (_, i) => new Date(2026, 6, 27 + i));
    const punches = [
      punch('clock_in', '2026-07-28T23:00:00.000Z'),  // 18:00 -> 03:00 overnight
      punch('clock_out', '2026-07-29T08:00:00.000Z'),
      punch('clock_in', '2026-07-30T06:00:00.000Z'),  // 01:00 -> 07:00
      punch('clock_out', '2026-07-30T12:00:00.000Z'),
    ];

    for (let cutoffHour = 0; cutoffHour <= 11; cutoffHour++) {
      const map = hoursByClockInDay(punches, days, { tz: TZ, cutoffHour });
      const total = [...map.values()].reduce((sum, d) => sum + d.netHours, 0);
      expect(total, `cutoff ${cutoffHour} lost or invented hours`).toBeCloseTo(15, 5);
    }
  });
});

describe('punchesByBusinessDay', () => {
  const days = [new Date(2026, 6, 28), new Date(2026, 6, 29)];

  it("keeps an overnight shift's clock-out on the row its hours landed on", () => {
    // 18:00 CDT Jul 28 -> 03:00 CDT Jul 29. At cutoff 2 the clock-out instant
    // is its OWN business day (Jul 29), but it belongs to Jul 28's shift.
    const punches = [
      punch('clock_in', '2026-07-28T23:00:00.000Z'),
      punch('clock_out', '2026-07-29T08:00:00.000Z'),
    ];
    const frame = { tz: TZ, cutoffHour: 2 };
    const grouped = punchesByBusinessDay(punches, days, frame);

    expect(grouped.get('2026-07-28')!).toHaveLength(2);
    expect(grouped.get('2026-07-29')!).toHaveLength(0);

    // The contract this test exists for: rows agree with their totals.
    const hours = hoursByClockInDay(punches, days, frame);
    expect(hours.get('2026-07-29')!.netHours).toBeCloseTo(0, 5);
    expect(hours.get('2026-07-28')!.netHours).toBeCloseTo(9, 5);
  });

  it('keeps break punches with their shift', () => {
    const punches = [
      punch('clock_in', '2026-07-28T23:00:00.000Z'),
      punch('break_start', '2026-07-29T04:00:00.000Z'),  // 23:00 CDT Jul 28
      punch('break_end', '2026-07-29T04:30:00.000Z'),
      punch('clock_out', '2026-07-29T08:00:00.000Z'),
    ];
    const grouped = punchesByBusinessDay(punches, days, { tz: TZ, cutoffHour: 2 });
    expect(grouped.get('2026-07-28')!).toHaveLength(4);
    expect(grouped.get('2026-07-29')!).toHaveLength(0);
  });

  it('places an orphaned punch on its own business day rather than dropping it', () => {
    const punches = [punch('clock_out', '2026-07-29T08:00:00.000Z')]; // 03:00 CDT
    const grouped = punchesByBusinessDay(punches, days, { tz: TZ, cutoffHour: 2 });
    expect(grouped.get('2026-07-29')!).toHaveLength(1);
  });

  it('sorts defensively -- unordered input groups identically', () => {
    const ordered = [
      punch('clock_in', '2026-07-28T23:00:00.000Z'),
      punch('clock_out', '2026-07-29T08:00:00.000Z'),
    ];
    const frame = { tz: TZ, cutoffHour: 2 };
    const reversed = punchesByBusinessDay([...ordered].reverse(), days, frame);
    expect(reversed.get('2026-07-28')!).toHaveLength(2);
  });

  it('drops a shift whose business day is outside the displayed range', () => {
    const punches = [
      punch('clock_in', '2026-07-27T15:00:00.000Z'),
      punch('clock_out', '2026-07-27T23:00:00.000Z'),
    ];
    const grouped = punchesByBusinessDay(punches, days, { tz: TZ, cutoffHour: 0 });
    expect([...grouped.values()].flat()).toHaveLength(0);
  });
});
