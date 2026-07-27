import { describe, it, expect } from 'vitest';
import {
  classifyHour,
  impliedLabor,
  laborConsistentSplh,
  buildReceipt,
  chartSummaryLabel,
} from '@/lib/coverageChartModel';
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

  it('BOUNDARY: splh === 0 degrades to pct 0 instead of Infinity', () => {
    const { pct, overTarget } = impliedLabor({ wage: 15, splh: 0, targetLaborPct: 22 });
    expect(pct).toBe(0);
    expect(overTarget).toBe(false);
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

  it('BOUNDARY: targetLaborPct === 0 degrades to 0 instead of Infinity', () => {
    expect(laborConsistentSplh({ wage: 30, targetLaborPct: 0 })).toBe(0);
  });
});

/**
 * Build a minimal CoverageHour fixture for buildReceipt tests. `needed` and
 * `delta` are irrelevant to buildReceipt (which derives its own
 * `needed = max(demand, minStaff)` from `demand`/`minStaff`, same as
 * classifyHour), so they're left null/plausible rather than driving output.
 */
function receiptFixture(opts: {
  demand: number | null;
  scheduled: number;
  scheduledMax?: number;
  projectedSales?: number | null;
}): CoverageHour {
  const {
    demand,
    scheduled,
    scheduledMax = scheduled,
    projectedSales = demand === null ? null : 100,
  } = opts;
  return {
    hour: 10,
    startMin: 600,
    scheduled,
    scheduledMax,
    needed: null,
    demand,
    delta: null,
    projectedSales,
    laborPct: null,
  };
}

describe('buildReceipt', () => {
  it('CRITICAL: nodata — no rows, single explanatory aside using weekdayKey/lookbackWeeks/scheduled', () => {
    const h = receiptFixture({ demand: null, scheduled: 5 });
    const receipt = buildReceipt(h, { minStaff: 2, weekdayKey: 'Monday', wage: 15, lookbackWeeks: 6 });
    expect(receipt.rows).toEqual([]);
    expect(receipt.asides).toEqual([
      'No sales in the last 6 Mondays — no demand target to compare against. (The old chart used to show this hour as 5 / 0.)',
    ]);
  });

  it('CRITICAL: crit — full ledger + implied-SPLH aside (matches design doc worked example)', () => {
    // Avg sales $503, demand 17 (⇒ implied target round(503/17)=$30/hr), minStaff 4
    // (below demand, so needed stays 17), scheduled 14 ⇒ short on demand −3.
    const h = receiptFixture({ demand: 17, scheduled: 14, projectedSales: 503 });
    const receipt = buildReceipt(h, { minStaff: 4, weekdayKey: 'Monday', wage: 15, lookbackWeeks: 6 });

    expect(receipt.rows).toEqual([
      { label: 'Avg Monday sales', value: '$503', tone: 'default' },
      { label: '÷ target', value: '$30/hr', tone: 'default' },
      { label: '= demand', value: '17 people', tone: 'critical' },
      { label: 'min staff', value: '4', tone: 'default' },
      { label: 'needed', value: '17', tone: 'default' },
      { label: 'scheduled', value: '14', tone: 'default' },
      { label: 'Short on demand', value: '-3', tone: 'critical' },
    ]);

    // implied SPLH at the scheduled count: 503/14 = 35.93 → $36/hr;
    // wage 15 / 35.93 * 100 = 41.75% → round 42%.
    expect(receipt.asides).toEqual(['At 14 scheduled, implied SPLH is $36/hr → 42% labor.']);
  });

  it('CRITICAL: floor — min-staff row is amber, last row is "Short on floor", floor aside present', () => {
    // demand=3 (target implied $30/hr from $90 sales), minStaff=5 pulls needed to 5;
    // scheduled=4 meets demand but misses the floor by 1.
    const h = receiptFixture({ demand: 3, scheduled: 4, projectedSales: 90 });
    const receipt = buildReceipt(h, { minStaff: 5, weekdayKey: 'Friday', wage: 15, lookbackWeeks: 4 });

    expect(receipt.rows).toEqual([
      { label: 'Avg Friday sales', value: '$90', tone: 'default' },
      { label: '÷ target', value: '$30/hr', tone: 'default' },
      { label: '= demand', value: '3 people', tone: 'default' },
      { label: 'min staff', value: '5', tone: 'warning' },
      { label: 'needed', value: '5', tone: 'default' },
      { label: 'scheduled', value: '4', tone: 'default' },
      { label: 'Short on floor', value: '-1', tone: 'warning' },
    ]);

    expect(receipt.asides).toEqual([
      // 90/4 = 22.5 → $23/hr; 15/22.5*100 = 66.67% → round 67%.
      'At 4 scheduled, implied SPLH is $23/hr → 67% labor.',
      'Sales only justify 3 here — the rest is your minimum-staff rule.',
    ]);
  });

  it('CRITICAL: ok — last row "On target" / 0, default tone throughout', () => {
    const h = receiptFixture({ demand: 5, scheduled: 5, projectedSales: 150 });
    const receipt = buildReceipt(h, { minStaff: 2, weekdayKey: 'Tuesday', wage: 15, lookbackWeeks: 6 });
    const last = receipt.rows[receipt.rows.length - 1];
    expect(last).toEqual({ label: 'On target', value: '0', tone: 'default' });
    expect(receipt.rows.every((r) => r.tone === 'default')).toBe(true);
  });

  it('CRITICAL: spare — last row "Covered" / +N, positive tone', () => {
    const h = receiptFixture({ demand: 5, scheduled: 7, projectedSales: 150 });
    const receipt = buildReceipt(h, { minStaff: 2, weekdayKey: 'Tuesday', wage: 15, lookbackWeeks: 6 });
    const last = receipt.rows[receipt.rows.length - 1];
    expect(last).toEqual({ label: 'Covered', value: '+2', tone: 'positive' });
  });

  it('BOUNDARY: mid-hour note present only when scheduledMax !== scheduled', () => {
    const steady = receiptFixture({ demand: 5, scheduled: 5, scheduledMax: 5, projectedSales: 150 });
    const dips = receiptFixture({ demand: 5, scheduled: 5, scheduledMax: 8, projectedSales: 150 });

    const steadyReceipt = buildReceipt(steady, { minStaff: 2, weekdayKey: 'Tuesday', wage: 15, lookbackWeeks: 6 });
    const dipsReceipt = buildReceipt(dips, { minStaff: 2, weekdayKey: 'Tuesday', wage: 15, lookbackWeeks: 6 });

    expect(steadyReceipt.asides.some((a) => a.startsWith('Headcount moves'))).toBe(false);
    expect(dipsReceipt.asides).toContain(
      'Headcount moves from 8 to 5 during this hour — the chart counts the lower figure.',
    );
  });

  it('BOUNDARY: demand === 0 (no sales but a rec exists) — "÷ target" row omitted, no implied-SPLH aside at scheduled=0', () => {
    // demand=0, minStaff=2 ⇒ needed=2; scheduled=0 ⇒ floor (0 >= demand(0) but < needed(2)).
    const h = receiptFixture({ demand: 0, scheduled: 0, scheduledMax: 0, projectedSales: 0 });
    const receipt = buildReceipt(h, { minStaff: 2, weekdayKey: 'Sunday', wage: 15, lookbackWeeks: 6 });

    expect(receipt.rows).toEqual([
      { label: 'Avg Sunday sales', value: '$0', tone: 'default' },
      { label: '= demand', value: '0 people', tone: 'default' },
      { label: 'min staff', value: '2', tone: 'warning' },
      { label: 'needed', value: '2', tone: 'default' },
      { label: 'scheduled', value: '0', tone: 'default' },
      { label: 'Short on floor', value: '-2', tone: 'warning' },
    ]);
    expect(receipt.asides).toEqual([
      'Sales only justify 0 here — the rest is your minimum-staff rule.',
    ]);
  });
});

/**
 * Build a minimal CoverageHour fixture for chartSummaryLabel tests, with a
 * distinct `hour`/`startMin` per entry (unlike the single-hour fixtures
 * above) so multi-hour rollups and the per-window list can be asserted.
 * `needed`/`delta` are irrelevant here too — chartSummaryLabel classifies via
 * `classifyHour`, which derives its own `needed` from `demand`/`minStaff`.
 */
function summaryHour(opts: { hour: number; demand: number | null; scheduled: number }): CoverageHour {
  const { hour, demand, scheduled } = opts;
  return {
    hour,
    startMin: hour * 60,
    scheduled,
    scheduledMax: scheduled,
    needed: null,
    demand,
    delta: null,
    projectedSales: demand === null ? null : 100,
    laborPct: null,
  };
}

describe('chartSummaryLabel', () => {
  it('CRITICAL: counts crit/floor hours and rolls them into "N short on demand, M at the floor over K hours"', () => {
    const hours = [
      summaryHour({ hour: 9, demand: 5, scheduled: 3 }), // crit (3 < 5)
      summaryHour({ hour: 10, demand: 3, scheduled: 4 }), // floor (demand=3 met, minStaff=5 -> needed=5, 4<5)
      summaryHour({ hour: 11, demand: 5, scheduled: 5 }), // ok
      summaryHour({ hour: 12, demand: 5, scheduled: 6 }), // spare
      summaryHour({ hour: 13, demand: null, scheduled: 2 }), // nodata
    ];

    const summary = chartSummaryLabel(hours, 5);

    expect(summary.ariaLabel).toBe('1 short on demand, 1 at the floor over 5 hours');
  });

  it('BOUNDARY: totalHours === 1 -> singular "hour"', () => {
    const hours = [summaryHour({ hour: 9, demand: 5, scheduled: 5 })];
    const summary = chartSummaryLabel(hours, 2);
    expect(summary.ariaLabel).toBe('0 short on demand, 0 at the floor over 1 hour');
  });

  it('BOUNDARY: no crit/floor hours -> zero counts, empty windows list', () => {
    const hours = [
      summaryHour({ hour: 9, demand: 5, scheduled: 5 }),
      summaryHour({ hour: 10, demand: null, scheduled: 1 }),
    ];
    const summary = chartSummaryLabel(hours, 2);
    expect(summary.ariaLabel).toBe('0 short on demand, 0 at the floor over 2 hours');
    expect(summary.understaffedWindows).toEqual([]);
  });

  it('CRITICAL: understaffedWindows lists one entry per crit/floor hour, in order, excluding ok/spare/nodata', () => {
    const hours = [
      summaryHour({ hour: 9, demand: 5, scheduled: 3 }), // crit, deficit vs demand = 2
      summaryHour({ hour: 10, demand: 3, scheduled: 4 }), // floor: needed=max(3,5)=5, deficit = 1
      summaryHour({ hour: 11, demand: 5, scheduled: 5 }), // ok - excluded
      summaryHour({ hour: 12, demand: 5, scheduled: 6 }), // spare - excluded
      summaryHour({ hour: 13, demand: null, scheduled: 2 }), // nodata - excluded
    ];

    const summary = chartSummaryLabel(hours, 5);

    expect(summary.understaffedWindows).toEqual([
      { startMin: 9 * 60, label: '9 AM: short 2 on demand' },
      { startMin: 10 * 60, label: '10 AM: short 1 at the floor' },
    ]);
  });
});
