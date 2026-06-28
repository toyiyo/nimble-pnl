import { describe, it, expect } from 'vitest';
import { assignLoanedOutCell } from '@/lib/loanedOut';
import type { SlotCoverage, CoveringEmployee } from '@/types/scheduling';

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
