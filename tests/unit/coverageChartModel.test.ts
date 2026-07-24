import { describe, it, expect } from 'vitest';
import { classifyHour, impliedLabor, laborConsistentSplh } from '@/lib/coverageChartModel';
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

describe('impliedLabor', () => {
  it('CRITICAL: pct = wage / splh * 100', () => {
    const { pct } = impliedLabor({ wage: 20, splh: 25, targetLaborPct: 75 });
    expect(pct).toBe(80);
  });

  it('CRITICAL: overTarget is true once pct exceeds targetLaborPct + 0.05', () => {
    // wage/splh*100 = 75; targetLaborPct=74.94 -> threshold 74.99 -> 75 > 74.99
    const { pct, overTarget } = impliedLabor({ wage: 15, splh: 20, targetLaborPct: 74.94 });
    expect(pct).toBe(75);
    expect(overTarget).toBe(true);
  });

  it('CRITICAL: overTarget is false when pct is at or below target', () => {
    // wage/splh*100 = 30; targetLaborPct=30 (well above threshold 30.05)
    const { pct, overTarget } = impliedLabor({ wage: 30, splh: 100, targetLaborPct: 30 });
    expect(pct).toBe(30);
    expect(overTarget).toBe(false);
  });

  it('BOUNDARY: pct exactly equal to targetLaborPct + 0.05 → not overTarget (strict >)', () => {
    // wage/splh*100 = 75; targetLaborPct=74.95 -> threshold 75.0 exactly -> 75 > 75 is false
    const { pct, overTarget } = impliedLabor({ wage: 15, splh: 20, targetLaborPct: 74.95 });
    expect(pct).toBe(75);
    expect(overTarget).toBe(false);
  });

  it('BOUNDARY: pct just 0.01 over threshold → overTarget true', () => {
    // wage/splh*100 = 75; targetLaborPct=74.94 -> threshold 74.99 -> 75 > 74.99 -> true
    const { overTarget } = impliedLabor({ wage: 15, splh: 20, targetLaborPct: 74.94 });
    expect(overTarget).toBe(true);
  });
});

describe('laborConsistentSplh', () => {
  it('CRITICAL: consistent = wage / (targetLaborPct / 100)', () => {
    expect(laborConsistentSplh({ wage: 20, targetLaborPct: 25 })).toBe(80);
  });

  it('CRITICAL: a lower targetLaborPct yields a higher consistent SPLH (inverse relationship)', () => {
    const lower = laborConsistentSplh({ wage: 20, targetLaborPct: 20 });
    const higher = laborConsistentSplh({ wage: 20, targetLaborPct: 40 });
    expect(lower).toBeGreaterThan(higher);
  });

  it('BOUNDARY: targetLaborPct === 100 → consistent === wage', () => {
    expect(laborConsistentSplh({ wage: 30, targetLaborPct: 100 })).toBe(30);
  });
});
