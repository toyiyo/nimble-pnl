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
    const c = computeSlotCoverage('14:00:00', '18:00:00', 1, D, shifts, { position: 'Server', tz });
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
    const c = computeSlotCoverage('14:00:00', '18:00:00', 1, D, shifts, { position: 'Server', tz });
    expect(c.minConcurrent).toBe(0);
    expect(c.openSpots).toBe(1);
  });

  it('mid-shift fill-in (non-matching window) covers the open template', () => {
    // template 10:00-16:30 cap 1.
    // Fill-in: 08:30-18:00 CDT (starts before and ends after the template window).
    // An exact-start/end matcher would fail here; sweep-line correctly sees
    // the fill-in fully covers [10:00, 16:30].
    const shifts = [
      mk('A', '2026-06-27T13:30:00Z', '2026-06-27T23:00:00Z'), // 08:30-18:00 CDT
    ];
    const c = computeSlotCoverage('10:00:00', '16:30:00', 1, D, shifts, { position: 'Server', tz });
    expect(c.openSpots).toBe(0);
  });

  it('distinct-employee dedup: one person, two overlapping shifts counts once', () => {
    const shifts = [
      mk('A', '2026-06-27T19:00:00Z', '2026-06-27T21:00:00Z'), // 14:00-16:00
      mk('A', '2026-06-27T20:00:00Z', '2026-06-27T22:00:00Z'), // 15:00-17:00 (same emp)
    ];
    const c = computeSlotCoverage('14:00:00', '17:00:00', 2, D, shifts, { position: 'Server', tz });
    expect(c.minConcurrent).toBe(1); // not 2
    expect(c.openSpots).toBe(1);
  });

  it('position mismatch is ignored', () => {
    const shifts = [mk('A', '2026-06-27T19:00:00Z', '2026-06-27T23:00:00Z', 'Cook')];
    const c = computeSlotCoverage('14:00:00', '18:00:00', 1, D, shifts, { position: 'Server', tz });
    expect(c.openSpots).toBe(1);
  });
});

describe('computeSlotCoverage — overnight + capacity>1', () => {
  const tz = 'America/Chicago';
  const D = '2026-06-27';

  it('overnight window 22:00-02:00 covered by an overnight shift', () => {
    // CDT is UTC-5. 22:00 CDT = 03:00Z next day. 02:00 CDT = 07:00Z next day.
    const shifts = [mk('A', '2026-06-28T03:00:00Z', '2026-06-28T07:00:00Z')]; // 22:00-02:00 CDT
    const c = computeSlotCoverage('22:00:00', '02:00:00', 1, D, shifts, { position: 'Server', tz });
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
    const c = computeSlotCoverage('16:00:00', '23:30:00', 3, D, shifts, { position: 'Server', tz });
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
    const c = computeSlotCoverage('16:00:00', '23:30:00', 2, D, shifts, { position: 'Server', tz });
    expect(c.coveringEmployees.map((e) => e.employeeName)).toContain('Jodi');
    expect(c.segments.some((s) => !s.covered)).toBe(true); // gap after Shy leaves
  });
});

describe('computeSlotCoverage — area scope (opt-in)', () => {
  const tz = 'America/Chicago'; const D = '2026-06-27';
  const mkA = (emp: string, s: string, e: string, area: string | null): CoverageShift =>
    ({ employee_id: emp, employee_name: emp, start_time: s, end_time: e, position: 'Server', status: 'scheduled', area });

  it('CRITICAL: should count only same-area shifts when options.area is set', () => {
    const shifts = [
      mkA('CS1', '2026-06-27T15:00:00Z', '2026-06-27T21:30:00Z', 'Cold Stone'), // 10:00-16:30 CDT
      mkA('WZ1', '2026-06-27T15:00:00Z', '2026-06-27T21:30:00Z', "Wetzel's"),
    ];
    const c = computeSlotCoverage('10:00:00', '16:30:00', 1, D, shifts, { position: 'Server', tz, area: 'Cold Stone' });
    expect(c.coveringEmployees.map(e => e.employeeId)).toEqual(['CS1']); // WZ1 excluded
    expect(c.openSpots).toBe(0);
  });

  it('CRITICAL: should count all areas when options.area is omitted (back-compat — banner callers unchanged)', () => {
    const shifts = [
      mkA('CS1', '2026-06-27T15:00:00Z', '2026-06-27T21:30:00Z', 'Cold Stone'),
      mkA('WZ1', '2026-06-27T15:00:00Z', '2026-06-27T21:30:00Z', "Wetzel's"),
    ];
    const c = computeSlotCoverage('10:00:00', '16:30:00', 2, D, shifts, { position: 'Server', tz });
    expect(c.coveringEmployees.length).toBe(2);
  });

  it('CRITICAL: should count all areas when options.area is null (template with no area set)', () => {
    const shifts = [mkA('X', '2026-06-27T15:00:00Z', '2026-06-27T21:30:00Z', 'Cold Stone')];
    expect(computeSlotCoverage('10:00:00', '16:30:00', 1, D, shifts, { position: 'Server', tz, area: null }).openSpots).toBe(0);
  });

  it('CRITICAL: should count all areas when options.area is undefined (back-compat — options.area = undefined)', () => {
    // Back-compat: callers that omit area from the options object get whole-restaurant behaviour.
    // options.area evaluates to undefined, which is != null → false → no filter applied.
    const shifts = [
      mkA('CS1', '2026-06-27T15:00:00Z', '2026-06-27T21:30:00Z', 'Cold Stone'),
      mkA('WZ1', '2026-06-27T15:00:00Z', '2026-06-27T21:30:00Z', "Wetzel's"),
    ];
    const c = computeSlotCoverage('10:00:00', '16:30:00', 2, D, shifts, { position: 'Server', tz });
    expect(c.coveringEmployees.length).toBe(2);
    expect(c.openSpots).toBe(0);
  });

  it('CRITICAL: should show partial coverage and gap segment when same-area shift covers only half the window', () => {
    // cap 1, window 16:00-22:30 CDT; one Cold Stone person leaves at 19:30 => gap 19:30-22:30
    // CDT (UTC-5): 16:00=21:00Z, 19:30=00:30Z+1
    const shifts = [mkA('CS1', '2026-06-27T21:00:00Z', '2026-06-28T00:30:00Z', 'Cold Stone')]; // 16:00-19:30 CDT
    const c = computeSlotCoverage('16:00:00', '22:30:00', 1, D, shifts, { position: 'Server', tz, area: 'Cold Stone' });
    expect(c.openSpots).toBe(1);
    expect(c.coveragePct).toBeLessThan(100);
    expect(c.segments.some(s => !s.covered)).toBe(true);
  });
});

import { minutesToCompact } from '@/lib/shiftCoverage';

describe('area facets: covering + loanedOut', () => {
  const tz = 'America/Chicago';
  // Wetzel's Close slot 16:00-23:30 on 2026-07-04 (Sat)
  const slot = ['16:00:00', '23:30:00', 2, '2026-07-04'] as const;

  function shift(over: Partial<CoverageShift>): CoverageShift {
    return {
      employee_id: 'e1', employee_name: 'Termora',
      start_time: '2026-07-04T21:00:00Z', end_time: '2026-07-05T04:30:00Z',
      position: 'Server', status: 'scheduled', area: "Wetzel's", homeArea: 'Cold Stone',
      ...over,
    };
  }

  it('tags coveringEmployees with homeArea and workArea', () => {
    const cov = computeSlotCoverage(...slot, [shift({})], { position: 'Server', tz, area: "Wetzel's" });
    expect(cov.coveringEmployees).toHaveLength(1);
    expect(cov.coveringEmployees[0].homeArea).toBe('Cold Stone');
    expect(cov.coveringEmployees[0].workArea).toBe("Wetzel's");
  });

  it('populates loanedOut for the home-area slot and excludes from openSpots', () => {
    // Cold Stone Close slot, same window. Termora homeArea=Cold Stone, workArea=Wetzel's.
    const cov = computeSlotCoverage('16:00:00', '23:30:00', 4, '2026-07-04', [shift({})], { position: 'Server', tz, area: 'Cold Stone' });
    // She does NOT fill a Cold Stone spot:
    expect(cov.coveringEmployees).toHaveLength(0);
    expect(cov.openSpots).toBe(4);
    // ...but is surfaced as loaned out:
    expect(cov.loanedOut).toHaveLength(1);
    expect(cov.loanedOut[0].employeeId).toBe('e1');
    expect(cov.loanedOut[0].workArea).toBe("Wetzel's");
    expect(cov.loanedOut[0].endMin - cov.loanedOut[0].startMin).toBeGreaterThan(0);
  });

  it('loanedOut is empty when slot area is null (whole-restaurant)', () => {
    const cov = computeSlotCoverage(...slot, [shift({})], { position: 'Server', tz });
    expect(cov.loanedOut).toEqual([]);
  });

  it('same-area shift is neither covering-tagged-cross nor loaned out', () => {
    const cov = computeSlotCoverage(...slot, [shift({ area: "Wetzel's", homeArea: "Wetzel's" })], { position: 'Server', tz, area: "Wetzel's" });
    expect(cov.coveringEmployees[0].homeArea).toBe("Wetzel's");
    expect(cov.loanedOut).toEqual([]);
  });
});

describe('minutesToCompact', () => {
  it('formats on-the-hour minutes: 840 (14:00) => "2p"', () => {
    expect(minutesToCompact(840)).toBe('2p');
  });

  it('formats with minutes: 570 (9:30) => "9:30a"', () => {
    expect(minutesToCompact(570)).toBe('9:30a');
  });

  it('formats midnight: 0 => "12a"', () => {
    expect(minutesToCompact(0)).toBe('12a');
  });

  it('formats noon: 720 => "12p"', () => {
    expect(minutesToCompact(720)).toBe('12p');
  });

  it('normalises overnight minutes: 1500 (25:00, i.e. 01:00 next-day) => "1a"', () => {
    expect(minutesToCompact(1500)).toBe('1a');
  });

  it('normalises negative minutes: -60 (23:00 previous-day) => "11p"', () => {
    expect(minutesToCompact(-60)).toBe('11p');
  });
});
