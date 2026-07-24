import { describe, it, expect } from 'vitest';
import { classifyHour } from '@/lib/coverageChartModel';
import type { CoverageHour } from '@/lib/coverageSummary';

/**
 * Build a minimal CoverageHour fixture for classifyHour tests. `needed` and
 * `delta` are irrelevant to classifyHour (which derives its own
 * `needed = max(demand, minStaff)` per the design doc), so they're filled
 * with plausible values rather than driving the classification.
 */
function hourFixture(opts: { demand: number | null; scheduled: number }): CoverageHour {
  const { demand, scheduled } = opts;
  const needed = demand === null ? null : demand;
  return {
    hour: 10,
    startMin: 600,
    scheduled,
    scheduledMax: scheduled,
    needed,
    demand,
    delta: needed === null ? null : scheduled - needed,
    projectedSales: demand === null ? null : 100,
    laborPct: null,
  };
}

describe('classifyHour', () => {
  it('CRITICAL: demand === null → nodata, regardless of scheduled/minStaff', () => {
    const h = hourFixture({ demand: null, scheduled: 5 });
    expect(classifyHour(h, 2)).toBe('nodata');
  });

  it('CRITICAL: scheduled < demand → crit', () => {
    const h = hourFixture({ demand: 5, scheduled: 4 });
    expect(classifyHour(h, 1)).toBe('crit');
  });

  it('CRITICAL: scheduled >= demand && scheduled < needed → floor', () => {
    // demand=3, minStaff=5 → needed=5; scheduled=4 is >= demand but < needed
    const h = hourFixture({ demand: 3, scheduled: 4 });
    expect(classifyHour(h, 5)).toBe('floor');
  });

  it('CRITICAL: scheduled === needed → ok', () => {
    // demand=5, minStaff=2 → needed=5; scheduled=5
    const h = hourFixture({ demand: 5, scheduled: 5 });
    expect(classifyHour(h, 2)).toBe('ok');
  });

  it('CRITICAL: scheduled > needed → spare', () => {
    // demand=5, minStaff=2 → needed=5; scheduled=6
    const h = hourFixture({ demand: 5, scheduled: 6 });
    expect(classifyHour(h, 2)).toBe('spare');
  });

  it('BOUNDARY: scheduled === demand (and demand >= minStaff) → not crit (floor or ok)', () => {
    // demand=5, minStaff=2 → needed=5; scheduled=5 === demand === needed → ok, never crit
    const h = hourFixture({ demand: 5, scheduled: 5 });
    expect(classifyHour(h, 2)).not.toBe('crit');
    expect(classifyHour(h, 2)).toBe('ok');
  });

  it('BOUNDARY: demand < minStaff — needed is pulled up to minStaff, not left at demand', () => {
    // demand=2, minStaff=6 → needed=6. scheduled=2 meets demand exactly but is far
    // under the floor, so this must be `floor`, not `ok`.
    const h = hourFixture({ demand: 2, scheduled: 2 });
    expect(classifyHour(h, 6)).toBe('floor');
  });

  it('BOUNDARY: demand < minStaff and scheduled below demand → still crit (demand check wins)', () => {
    const h = hourFixture({ demand: 2, scheduled: 1 });
    expect(classifyHour(h, 6)).toBe('crit');
  });

  it('BOUNDARY: demand === 0 with scheduled === 0 and minStaff === 0 → ok (not crit/floor)', () => {
    const h = hourFixture({ demand: 0, scheduled: 0 });
    expect(classifyHour(h, 0)).toBe('ok');
  });
});
