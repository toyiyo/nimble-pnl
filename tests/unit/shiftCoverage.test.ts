import { describe, it, expect } from 'vitest';
import { capacityFloor, computeSlotCoverage } from '@/lib/shiftCoverage';
import type { CoverageShift } from '@/types/scheduling';

const mk = (emp: string, startIso: string, endIso: string, position = 'Server'): CoverageShift => ({
  employee_id: emp, start_time: startIso, end_time: endIso, position, status: 'scheduled',
});

describe('capacityFloor', () => {
  it('coerces 0/NaN/<1 to 1, passes valid through', () => {
    expect(capacityFloor(0)).toBe(1);
    expect(capacityFloor(Number.NaN)).toBe(1);
    expect(capacityFloor(-3)).toBe(1);
    expect(capacityFloor(3)).toBe(3);
  });
});

describe('computeSlotCoverage — min-concurrent', () => {
  // America/Chicago, 2026-06-27 (CDT, UTC-5). 14:00 local = 19:00Z.
  const tz = 'America/Chicago';
  const D = '2026-06-27';

  it('two fill-ins whose union covers a cap-1 window => 0 open, 100%', () => {
    // window 14:00-18:00 (4h, cap 1). A covers 14-15 (1h), B covers 15-18 (3h).
    const shifts = [
      mk('A', '2026-06-27T19:00:00Z', '2026-06-27T20:00:00Z'), // 14:00-15:00 CDT
      mk('B', '2026-06-27T20:00:00Z', '2026-06-27T23:00:00Z'), // 15:00-18:00 CDT
    ];
    const c = computeSlotCoverage('14:00:00', '18:00:00', 1, D, shifts, 'Server', tz);
    expect(c.minConcurrent).toBe(1);
    expect(c.openSpots).toBe(0);
    expect(c.coveragePct).toBe(100);
  });

  it('same-hour overlap leaves a gap => needs staff', () => {
    // both cover only 14-15 of a 14-18 cap-1 window
    const shifts = [
      mk('A', '2026-06-27T19:00:00Z', '2026-06-27T20:00:00Z'),
      mk('B', '2026-06-27T19:00:00Z', '2026-06-27T20:00:00Z'),
    ];
    const c = computeSlotCoverage('14:00:00', '18:00:00', 1, D, shifts, 'Server', tz);
    expect(c.minConcurrent).toBe(0);
    expect(c.openSpots).toBe(1);
  });

  it('mid-shift fill-in (non-matching window) covers the open template', () => {
    // template 10:00-16:30 cap 1; fill-in works 10:00-16:30 (exactly covering window)
    const shifts = [
      mk('A', '2026-06-27T15:00:00Z', '2026-06-27T21:30:00Z'), // 10:00-16:30 CDT
    ];
    const c = computeSlotCoverage('10:00:00', '16:30:00', 1, D, shifts, 'Server', tz);
    expect(c.openSpots).toBe(0);
  });

  it('distinct-employee dedup: one person, two overlapping shifts counts once', () => {
    const shifts = [
      mk('A', '2026-06-27T19:00:00Z', '2026-06-27T21:00:00Z'), // 14:00-16:00
      mk('A', '2026-06-27T20:00:00Z', '2026-06-27T22:00:00Z'), // 15:00-17:00 (same emp)
    ];
    const c = computeSlotCoverage('14:00:00', '17:00:00', 2, D, shifts, 'Server', tz);
    expect(c.minConcurrent).toBe(1); // not 2
    expect(c.openSpots).toBe(1);
  });

  it('position mismatch is ignored', () => {
    const shifts = [mk('A', '2026-06-27T19:00:00Z', '2026-06-27T23:00:00Z', 'Cook')];
    const c = computeSlotCoverage('14:00:00', '18:00:00', 1, D, shifts, 'Server', tz);
    expect(c.openSpots).toBe(1);
  });
});

describe('computeSlotCoverage — overnight + capacity>1', () => {
  const tz = 'America/Chicago';
  const D = '2026-06-27';

  it('overnight window 22:00-02:00 covered by an overnight shift', () => {
    // CDT is UTC-5. 22:00 CDT = 03:00Z next day. 02:00 CDT = 07:00Z next day.
    const shifts = [mk('A', '2026-06-28T03:00:00Z', '2026-06-28T07:00:00Z')]; // 22:00-02:00 CDT
    const c = computeSlotCoverage('22:00:00', '02:00:00', 1, D, shifts, 'Server', tz);
    expect(c.openSpots).toBe(0);
  });

  it('capacity 3 with one early-leaver leaves a gap', () => {
    // window 16:00-23:30 (7.5h, cap 3). A+B work full window; C leaves at 19:30.
    // CDT UTC-5: 16:00=21:00Z, 23:30=04:30Z, 19:30=00:30Z(+1)
    const shifts = [
      mk('A', '2026-06-27T21:00:00Z', '2026-06-28T04:30:00Z'), // 16:00-23:30 CDT
      mk('B', '2026-06-27T21:00:00Z', '2026-06-28T04:30:00Z'), // 16:00-23:30 CDT
      mk('C', '2026-06-27T21:00:00Z', '2026-06-28T00:30:00Z'), // 16:00-19:30 CDT
    ];
    const c = computeSlotCoverage('16:00:00', '23:30:00', 3, D, shifts, 'Server', tz);
    expect(c.minConcurrent).toBe(2);
    expect(c.openSpots).toBe(1);
    // covered = 3.5h (16-19:30) when n=3. gap = 4h (19:30-23:30) when n=2.
    // coveragePct = round(3.5/7.5 * 100) = round(46.67) = 47
    expect(c.coveragePct).toBe(47);
  });
});

describe('computeSlotCoverage — covering employees + segments', () => {
  it('reports covering employees with names and gap segments', () => {
    const tz = 'America/Chicago';
    const D = '2026-06-27';
    // CDT UTC-5. 16:00=21:00Z, 23:30=04:30Z, 19:30=00:30Z+1
    const shifts = [
      { ...mk('A', '2026-06-27T21:00:00Z', '2026-06-28T04:30:00Z'), employee_name: 'Jodi' },
      { ...mk('B', '2026-06-27T21:00:00Z', '2026-06-28T00:30:00Z'), employee_name: 'Shy' },
    ];
    const c = computeSlotCoverage('16:00:00', '23:30:00', 2, D, shifts, 'Server', tz);
    expect(c.coveringEmployees.map((e) => e.employeeName)).toContain('Jodi');
    expect(c.segments.some((s) => !s.covered)).toBe(true); // gap after Shy leaves
  });
});
