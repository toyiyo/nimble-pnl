import { describe, it, expect } from 'vitest';
import { minutesToIso, snapToStep } from '@/lib/shiftTimeMath';

// ---------------------------------------------------------------------------
// minutesToIso — restaurant-local minutes -> UTC ISO
// ---------------------------------------------------------------------------
// DST reference (America/Chicago, 2026):
//   Spring-forward: 2026-03-08, 02:00 CST -> 03:00 CDT (2am-3am does not exist)
//   Fall-back:      2026-11-01, 02:00 CDT -> 01:00 CST (1am-2am occurs twice)
//
// Fixtures use TZ-portable inputs (plain date strings / minute counts) per the
// 2026-05-10 lesson — no reliance on the process TZ.

describe('minutesToIso', () => {
  describe('standard (non-DST) days', () => {
    it('converts a simple morning time to UTC ISO (CST, UTC-6)', () => {
      // 2026-01-15 09:00 CST -> 15:00 UTC
      const iso = minutesToIso('2026-01-15', 9 * 60, 'America/Chicago');
      expect(iso).toBe(new Date('2026-01-15T15:00:00.000Z').toISOString());
    });

    it('converts a simple time to UTC ISO (CDT, UTC-5)', () => {
      // 2026-06-15 09:00 CDT -> 14:00 UTC
      const iso = minutesToIso('2026-06-15', 9 * 60, 'America/Chicago');
      expect(iso).toBe(new Date('2026-06-15T14:00:00.000Z').toISOString());
    });

    it('handles midnight (0 minutes)', () => {
      const iso = minutesToIso('2026-01-15', 0, 'America/Chicago');
      expect(iso).toBe(new Date('2026-01-15T06:00:00.000Z').toISOString());
    });
  });

  describe('overnight rollover (minutes > 1440)', () => {
    it('rolls a shift ending at 01:00 the next day forward one calendar day (CST)', () => {
      // businessDate 2026-01-15, 25:00 (=01:00 on 2026-01-16) CST -> UTC
      const iso = minutesToIso('2026-01-15', 25 * 60, 'America/Chicago');
      expect(iso).toBe(new Date('2026-01-16T07:00:00.000Z').toISOString());
    });

    it('rolls a shift spanning more than 24h (e.g. 1500 min = 25:00) correctly', () => {
      const iso = minutesToIso('2026-06-15', 1500, 'America/Chicago');
      // 1500 min = 25:00 = 01:00 next day (CDT, UTC-5) -> 2026-06-16T06:00:00Z
      expect(iso).toBe(new Date('2026-06-16T06:00:00.000Z').toISOString());
    });

    it('rolls forward multiple days for minutes >= 2880 (48h+)', () => {
      // 2900 minutes = 48h20m -> businessDate + 2 days, 00:20
      const iso = minutesToIso('2026-01-15', 2900, 'America/Chicago');
      expect(iso).toBe(new Date('2026-01-17T06:20:00.000Z').toISOString());
    });
  });

  describe('DST spring-forward (America/Chicago, 2026-03-08)', () => {
    it('converts a time before the transition (01:30 CST)', () => {
      const iso = minutesToIso('2026-03-08', 1 * 60 + 30, 'America/Chicago');
      // 01:30 CST = UTC-6 -> 07:30 UTC
      expect(iso).toBe(new Date('2026-03-08T07:30:00.000Z').toISOString());
    });

    it('converts a time after the transition (03:30 CDT) on the same calendar day', () => {
      const iso = minutesToIso('2026-03-08', 3 * 60 + 30, 'America/Chicago');
      // 03:30 CDT = UTC-5 -> 08:30 UTC
      expect(iso).toBe(new Date('2026-03-08T08:30:00.000Z').toISOString());
    });

    it('an overnight shift starting the night before crosses spring-forward correctly', () => {
      // businessDate 2026-03-07, 22:00 (CST) + 8h -> overnight end at 06:00 the
      // *next* day, which is 2026-03-08 (spring-forward day, now CDT).
      const startIso = minutesToIso('2026-03-07', 22 * 60, 'America/Chicago');
      const endIso = minutesToIso('2026-03-07', 30 * 60, 'America/Chicago'); // 22:00 + 8h = 30:00
      expect(startIso).toBe(new Date('2026-03-08T04:00:00.000Z').toISOString()); // 22:00 CST -> +6h
      expect(endIso).toBe(new Date('2026-03-08T11:00:00.000Z').toISOString()); // 06:00 CDT -> +5h
      // Wall-clock duration reads as 8h, but elapsed UTC duration is 7h because
      // the clocks skipped forward an hour during the shift.
      const elapsedMs = new Date(endIso).getTime() - new Date(startIso).getTime();
      expect(elapsedMs).toBe(7 * 60 * 60 * 1000);
    });
  });

  describe('DST fall-back (America/Chicago, 2026-11-01)', () => {
    it('converts a time before the transition (00:30 CDT)', () => {
      const iso = minutesToIso('2026-11-01', 0 * 60 + 30, 'America/Chicago');
      // 00:30 CDT = UTC-5 -> 05:30 UTC
      expect(iso).toBe(new Date('2026-11-01T05:30:00.000Z').toISOString());
    });

    it('converts a time after the transition (03:30 CST) on the same calendar day', () => {
      const iso = minutesToIso('2026-11-01', 3 * 60 + 30, 'America/Chicago');
      // 03:30 CST = UTC-6 -> 09:30 UTC
      expect(iso).toBe(new Date('2026-11-01T09:30:00.000Z').toISOString());
    });

    it('COMBINED: an overnight shift (minutes > 1440) starting the night before fall-back', () => {
      // businessDate 2026-10-31, 23:00 (CDT) + 5h -> overnight end at 04:00 the
      // next day, 2026-11-01 (fall-back day, now CST). The extra repeated hour
      // must be absorbed by fromZonedTime without double-counting or
      // under-counting the elapsed time.
      const startIso = minutesToIso('2026-10-31', 23 * 60, 'America/Chicago');
      const endIso = minutesToIso('2026-10-31', 28 * 60, 'America/Chicago'); // 23:00 + 5h = 28:00 = 04:00 next day
      expect(startIso).toBe(new Date('2026-11-01T04:00:00.000Z').toISOString()); // 23:00 CDT -> +5h
      expect(endIso).toBe(new Date('2026-11-01T10:00:00.000Z').toISOString()); // 04:00 CST -> +6h
      // Wall-clock duration reads as 5h, but elapsed UTC duration is 6h because
      // the clocks fell back an hour (extra hour repeated) during the shift.
      const elapsedMs = new Date(endIso).getTime() - new Date(startIso).getTime();
      expect(elapsedMs).toBe(6 * 60 * 60 * 1000);
    });
  });
});

// ---------------------------------------------------------------------------
// snapToStep
// ---------------------------------------------------------------------------
describe('snapToStep', () => {
  it('snaps down to the nearest step when below the midpoint', () => {
    expect(snapToStep(7, 15)).toBe(0);
  });

  it('snaps up to the nearest step when above the midpoint', () => {
    expect(snapToStep(8, 15)).toBe(15);
  });

  it('leaves an exact multiple of step unchanged', () => {
    expect(snapToStep(30, 15)).toBe(30);
  });

  it('uses the default step (15) when no step is provided', () => {
    expect(snapToStep(22)).toBe(15);
    expect(snapToStep(23)).toBe(30);
  });

  it('handles 0 minutes', () => {
    expect(snapToStep(0, 15)).toBe(0);
  });

  it('handles values beyond 1440 (overnight) the same way', () => {
    expect(snapToStep(1500 + 7, 15)).toBe(1500);
    expect(snapToStep(1500 + 8, 15)).toBe(1515);
  });

  it('rounds half-step exactly at the midpoint up (round-half-up)', () => {
    // 7.5 is exactly halfway between 0 and 15 for step=15
    expect(snapToStep(7.5, 15)).toBe(15);
  });

  it('handles negative minutes by snapping toward the nearest step', () => {
    expect(snapToStep(-7, 15)).toBe(0);
    expect(snapToStep(-8, 15)).toBe(-15);
  });
});
