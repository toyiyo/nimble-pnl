/**
 * Unit tests for `pickDefaultHour` — the pure helper that picks the pinned
 * `CoverageReceipt`'s default hour before the manager has explicitly clicked
 * a chart column (design doc §C: "defaults to the worst crit hour, else
 * first hour").
 *
 * Classifies every hour via `classifyHour` (not `h.delta`/`h.needed`) so the
 * default can never disagree with the chart's own kind, including under a
 * live-preview `minStaff` that hasn't round-tripped through the
 * recommendation pipeline.
 */
import { describe, it, expect } from 'vitest';
import { pickDefaultHour } from '@/components/scheduling/ShiftTimeline/ShiftTimelineTab';
import type { CoverageHour } from '@/lib/coverageSummary';

function hourFixture(opts: Partial<CoverageHour> & { demand: number | null; scheduled: number; startMin: number }): CoverageHour {
  const { demand, scheduled, startMin, scheduledMax = scheduled, ...rest } = opts;
  return {
    hour: Math.floor(startMin / 60) % 24,
    startMin,
    scheduled,
    scheduledMax,
    needed: null,
    demand,
    delta: null,
    projectedSales: null,
    laborPct: null,
    ...rest,
  };
}

describe('pickDefaultHour', () => {
  it('returns null when hours is empty', () => {
    expect(pickDefaultHour([], 4)).toBeNull();
  });

  it('returns the first hour when no hour classifies as crit (all ok/spare/floor/nodata)', () => {
    const ok = hourFixture({ startMin: 600, demand: 5, scheduled: 5 }); // ok
    const spare = hourFixture({ startMin: 660, demand: 5, scheduled: 8 }); // spare
    const floor = hourFixture({ startMin: 720, demand: 2, scheduled: 3 }); // floor (minStaff=4 pulls needed to 4)
    expect(pickDefaultHour([ok, spare, floor], 4)).toBe(ok);
  });

  it('CRITICAL: returns the crit hour with the largest demand deficit (demand - scheduled) when multiple crit hours exist', () => {
    const mildCrit = hourFixture({ startMin: 600, demand: 5, scheduled: 4 }); // deficit 1
    const worstCrit = hourFixture({ startMin: 660, demand: 17, scheduled: 14 }); // deficit 3 — the doc's worked example
    const okHour = hourFixture({ startMin: 720, demand: 5, scheduled: 5 });
    expect(pickDefaultHour([mildCrit, worstCrit, okHour], 4)).toBe(worstCrit);
  });

  it('ties on deficit break by earliest startMin', () => {
    const earlier = hourFixture({ startMin: 600, demand: 6, scheduled: 4 }); // deficit 2
    const later = hourFixture({ startMin: 660, demand: 6, scheduled: 4 }); // deficit 2 (tie)
    expect(pickDefaultHour([earlier, later], 4)).toBe(earlier);
  });

  it('ignores nodata hours when picking the worst crit (a nodata hour never counts as crit)', () => {
    const nodata = hourFixture({ startMin: 600, demand: null, scheduled: 0 });
    const crit = hourFixture({ startMin: 660, demand: 5, scheduled: 2 });
    expect(pickDefaultHour([nodata, crit], 4)).toBe(crit);
  });
});
