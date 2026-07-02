import { describe, it, expect } from 'vitest';
import { computeDayCoverage, isoToLocalMinutes } from '@/lib/shiftCoverage';
import type { CoverageShift } from '@/types/scheduling';

const mk = (id: string, start: string, end: string, extra: Partial<CoverageShift> = {}): CoverageShift => ({
  employee_id: id, start_time: start, end_time: end, position: 'Server', status: 'scheduled',
  area: null, homeArea: null, employee_name: id, ...extra,
} as CoverageShift);

describe('isoToLocalMinutes (exported)', () => {
  it('resolves wall-clock minutes in the given tz regardless of host', () => {
    // 2026-07-11 15:00 in Chicago (UTC-5 in July) = 20:00Z
    expect(isoToLocalMinutes('2026-07-11T20:00:00Z', '2026-07-11', 'America/Chicago')).toBe(15 * 60);
  });
});

describe('computeDayCoverage', () => {
  it('counts overlapping headcount across the window at each step', () => {
    const shifts = [
      mk('a', '2026-07-11T15:00:00Z', '2026-07-11T21:00:00Z'), // 10:00–16:00 CT
      mk('b', '2026-07-11T17:00:00Z', '2026-07-11T23:00:00Z'), // 12:00–18:00 CT
    ];
    const cov = computeDayCoverage(shifts, '2026-07-11', 'America/Chicago', 60, 600, 1080);
    expect(cov.find((c) => c.min === 600)!.count).toBe(1);  // 10:00 → only a
    expect(cov.find((c) => c.min === 720)!.count).toBe(2);  // 12:00 → a+b
    expect(cov.find((c) => c.min === 1020)!.count).toBe(1); // 17:00 → only b
  });
  it('handles an overnight shift crossing midnight (+1440)', () => {
    const shifts = [mk('c', '2026-07-12T03:00:00Z', '2026-07-12T07:00:00Z')]; // 22:00–02:00 CT (Jul 11)
    const cov = computeDayCoverage(shifts, '2026-07-11', 'America/Chicago', 60, 1320, 1560);
    expect(cov.find((c) => c.min === 1380)!.count).toBe(1); // 23:00
    expect(cov.find((c) => c.min === 1500)!.count).toBe(1); // 01:00 next day
  });
  it('excludes cancelled shifts', () => {
    const shifts = [mk('d', '2026-07-11T17:00:00Z', '2026-07-11T21:00:00Z', { status: 'cancelled' })];
    const cov = computeDayCoverage(shifts, '2026-07-11', 'America/Chicago', 60, 600, 1080);
    expect(cov.every((c) => c.count === 0)).toBe(true);
  });
  it('returns [] for a non-positive step instead of looping forever', () => {
    const shifts = [mk('e', '2026-07-11T15:00:00Z', '2026-07-11T21:00:00Z')];
    expect(computeDayCoverage(shifts, '2026-07-11', 'America/Chicago', 0, 600, 1080)).toEqual([]);
    expect(computeDayCoverage(shifts, '2026-07-11', 'America/Chicago', -15, 600, 1080)).toEqual([]);
  });
});
