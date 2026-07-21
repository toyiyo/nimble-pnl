import { describe, it, expect } from 'vitest';
import { assignLoanedOutCell, computeLoanedOut } from '@/lib/loanedOut';
import type { SlotCoverage, CoveringEmployee, CoverageShift } from '@/types/scheduling';

function cov(loaned: CoveringEmployee[]): SlotCoverage {
  return { minConcurrent: 0, openSpots: 0, coveragePct: 0, segments: [], coveringEmployees: [], loanedOut: loaned };
}
const e = (over: Partial<CoveringEmployee>): CoveringEmployee => ({
  employeeId: 'e1', employeeName: 'Termora', startMin: 960, endMin: 1410, workArea: "Wetzel's", ...over,
});

describe('assignLoanedOutCell', () => {
  it('places a loaned employee in exactly one cell (greatest overlap wins)', () => {
    // 'open' cell: 30 min overlap; 'close' cell: 450 min overlap. Same day.
    const map = new Map<string, Map<string, SlotCoverage>>([
      ['open', new Map([['2026-07-04', cov([e({ startMin: 960, endMin: 990 })])]])],
      ['close', new Map([['2026-07-04', cov([e({ startMin: 960, endMin: 1410 })])]])],
    ]);
    const starts = new Map([['open', '10:00:00'], ['close', '16:00:00']]);
    const result = assignLoanedOutCell(map, starts);
    expect(result.get('open:2026-07-04')).toBeUndefined();
    expect(result.get('close:2026-07-04')?.map((x) => x.employeeId)).toEqual(['e1']);
  });

  it('tie-breaks equal overlap by earliest template start', () => {
    const map = new Map<string, Map<string, SlotCoverage>>([
      ['b', new Map([['2026-07-04', cov([e({ startMin: 960, endMin: 1410 })])]])],
      ['a', new Map([['2026-07-04', cov([e({ startMin: 960, endMin: 1410 })])]])],
    ]);
    const starts = new Map([['a', '08:00:00'], ['b', '16:00:00']]);
    const result = assignLoanedOutCell(map, starts);
    expect(result.get('a:2026-07-04')).toHaveLength(1);
    expect(result.get('b:2026-07-04')).toBeUndefined();
  });

  it('keeps different employees and different days independent', () => {
    const map = new Map<string, Map<string, SlotCoverage>>([
      ['close', new Map([
        ['2026-07-04', cov([e({ employeeId: 'e1' }), e({ employeeId: 'e2', employeeName: 'Sam' })])],
        ['2026-07-05', cov([e({ employeeId: 'e1' })])],
      ])],
    ]);
    const starts = new Map([['close', '16:00:00']]);
    const result = assignLoanedOutCell(map, starts);
    expect(result.get('close:2026-07-04')).toHaveLength(2);
    expect(result.get('close:2026-07-05')).toHaveLength(1);
  });

  it('returns empty map when there is no loaned-out data', () => {
    const map = new Map<string, Map<string, SlotCoverage>>([
      ['open', new Map([['2026-07-04', cov([])]])],
    ]);
    expect(assignLoanedOutCell(map, new Map()).size).toBe(0);
  });
});

describe('computeLoanedOut', () => {
  // America/Chicago, Wetzel's Close slot 16:00-23:30 on 2026-07-04 (Sat).
  const tz = 'America/Chicago';
  const opts = { position: 'Server', tz, dateStr: '2026-07-04', windowStart: '16:00:00', windowEnd: '23:30:00' };

  function shift(over: Partial<CoverageShift>): CoverageShift {
    return {
      employee_id: 'e1', employee_name: 'Termora',
      start_time: '2026-07-04T21:00:00Z', end_time: '2026-07-05T04:30:00Z',
      position: 'Server', status: 'scheduled', area: "Wetzel's", homeArea: 'Cold Stone',
      ...over,
    };
  }

  it('surfaces an employee whose home area is this slot area but who is working elsewhere', () => {
    // Cold Stone Close slot: Termora's home area matches, but she's working Wetzel's.
    const ghosts = computeLoanedOut([shift({})], { ...opts, area: 'Cold Stone' });
    expect(ghosts).toHaveLength(1);
    expect(ghosts[0].employeeId).toBe('e1');
    expect(ghosts[0].workArea).toBe("Wetzel's");
    expect(ghosts[0].endMin - ghosts[0].startMin).toBeGreaterThan(0);
  });

  it('is empty when slot area is null/undefined (whole-restaurant, back-compat)', () => {
    expect(computeLoanedOut([shift({})], { ...opts, area: null })).toEqual([]);
    expect(computeLoanedOut([shift({})], opts)).toEqual([]);
  });

  it('is empty when the shift is already in its home area (not loaned out)', () => {
    const ghosts = computeLoanedOut(
      [shift({ area: "Wetzel's", homeArea: "Wetzel's" })],
      { ...opts, area: "Wetzel's" },
    );
    expect(ghosts).toEqual([]);
  });

  it('ignores cancelled shifts', () => {
    const ghosts = computeLoanedOut([shift({ status: 'cancelled' })], { ...opts, area: 'Cold Stone' });
    expect(ghosts).toEqual([]);
  });

  it('ignores shifts for a different position', () => {
    const ghosts = computeLoanedOut([shift({ position: 'Cook' })], { ...opts, area: 'Cold Stone' });
    expect(ghosts).toEqual([]);
  });

  it('sorts by startMin and needs the whole-floor set (not just this template bucket)', () => {
    const later = shift({ employee_id: 'e2', employee_name: 'Later', start_time: '2026-07-04T22:00:00Z', end_time: '2026-07-05T04:30:00Z' });
    const earlier = shift({ employee_id: 'e1', employee_name: 'Earlier', start_time: '2026-07-04T21:00:00Z', end_time: '2026-07-04T23:00:00Z' });
    const ghosts = computeLoanedOut([later, earlier], { ...opts, area: 'Cold Stone' });
    expect(ghosts.map((g) => g.employeeId)).toEqual(['e1', 'e2']);
  });
});
