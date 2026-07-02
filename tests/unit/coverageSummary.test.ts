import { describe, it, expect } from 'vitest';
import { summarizeCoverageHours, buildVerdict } from '@/lib/coverageSummary';

// window 10:00–13:00 (600–780), 15-min samples
const win = { startMin: 600, endMin: 780 };
const coverage = [
  { min: 600, count: 2 }, { min: 615, count: 2 }, { min: 630, count: 1 }, { min: 645, count: 2 }, // hr10 min=1
  { min: 660, count: 3 }, { min: 675, count: 3 }, { min: 690, count: 3 }, { min: 705, count: 3 }, // hr11 min=3
  { min: 720, count: 2 }, { min: 735, count: 2 }, { min: 750, count: 2 }, { min: 765, count: 2 }, // hr12 min=2
  { min: 780, count: 2 },
];
const demand = [
  { min: 600, target: 1 }, { min: 660, target: 3 }, { min: 720, target: 4 },
];

describe('summarizeCoverageHours', () => {
  it('aggregates scheduled as the per-hour minimum and aligns needed', () => {
    const hrs = summarizeCoverageHours(coverage, demand, win);
    expect(hrs.map((h) => h.hour)).toEqual([10, 11, 12]);
    expect(hrs[0]).toMatchObject({ scheduled: 1, needed: 1, delta: 0 });   // covered (met)
    expect(hrs[1]).toMatchObject({ scheduled: 3, needed: 3, delta: 0 });
    expect(hrs[2]).toMatchObject({ scheduled: 2, needed: 4, delta: -2 });  // short 2
  });
  it('yields null needed/delta when demand is null', () => {
    const hrs = summarizeCoverageHours(coverage, null, win);
    expect(hrs[0].needed).toBeNull();
    expect(hrs[0].delta).toBeNull();
    expect(hrs[0].scheduled).toBe(1);
  });
});

describe('buildVerdict', () => {
  it('counts short hours and picks the worst', () => {
    const hrs = summarizeCoverageHours(coverage, demand, win);
    const v = buildVerdict(hrs);
    expect(v.metAll).toBe(false);
    expect(v.shortHours).toBe(1);
    expect(v.worst).toEqual({ hour: 12, delta: -2 });
  });
  it('reports metAll when nothing is short', () => {
    const hrs = summarizeCoverageHours(
      [{ min: 600, count: 5 }, { min: 660, count: 5 }], [{ min: 600, target: 1 }], { startMin: 600, endMin: 720 },
    );
    expect(buildVerdict(hrs).metAll).toBe(true);
    expect(buildVerdict(hrs).worst).toBeNull();
  });
  it('metAll is false-ish / worst null when demand absent', () => {
    const hrs = summarizeCoverageHours([{ min: 600, count: 2 }], null, { startMin: 600, endMin: 660 });
    const v = buildVerdict(hrs);
    expect(v.hasDemand).toBe(false);
    expect(v.shortHours).toBe(0);
  });
});
