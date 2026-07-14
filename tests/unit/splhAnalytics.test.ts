import { describe, it, expect } from 'vitest';
import { validateTimeZone, distributeWorkedHours, buildSplhGrid, classifySplh, buildSplhTimeseries, summarizeSplh, summarizeSplhTotals } from '@/lib/splhAnalytics';
import type { WorkSession } from '@/utils/timePunchProcessing';

describe('validateTimeZone', () => {
  it('passes through a valid IANA zone', () => {
    expect(validateTimeZone('America/New_York')).toBe('America/New_York');
  });
  it('falls back to UTC for an invalid zone', () => {
    expect(validateTimeZone('Not/AZone')).toBe('UTC');
    expect(validateTimeZone('')).toBe('UTC');
    expect(validateTimeZone(undefined)).toBe('UTC');
  });
});

function session(partial: Partial<WorkSession>): WorkSession {
  return {
    sessionId: 's', employee_id: 'e', employee_name: 'n',
    clock_in: new Date(), clock_out: undefined, breaks: [],
    total_minutes: 0, break_minutes: 0, worked_minutes: 0,
    is_complete: false, has_anomalies: false, anomalies: [],
    ...partial,
  };
}

describe('distributeWorkedHours', () => {
  const tz = 'America/New_York'; // UTC-4 in July (DST)

  it('returns [] for an incomplete session', () => {
    expect(distributeWorkedHours(session({ clock_in: new Date(Date.UTC(2026,6,1,20,0)) }), tz)).toEqual([]);
  });

  it('buckets a 2h15m single-day session by local hour', () => {
    // 17:00–19:15 local EDT = 21:00Z–23:15Z on 2026-07-01
    const s = session({
      clock_in: new Date(Date.UTC(2026,6,1,21,0)),
      clock_out: new Date(Date.UTC(2026,6,1,23,15)),
      is_complete: true,
    });
    const c = distributeWorkedHours(s, tz);
    expect(c.map(x => [x.hour, Math.round(x.hours*100)/100])).toEqual([[17,1],[18,1],[19,0.25]]);
    expect(c.every(x => x.localDate === '2026-07-01')).toBe(true);
    expect(c[0].dow).toBe(3); // 2026-07-01 is a Wednesday
  });

  it('excludes a complete break from the buckets', () => {
    // 17:00–19:00 local, 30-min break 17:30–18:00 → worked hour17=0.5, hour18=1
    const s = session({
      clock_in: new Date(Date.UTC(2026,6,1,21,0)),
      clock_out: new Date(Date.UTC(2026,6,1,23,0)),
      breaks: [{ break_start: new Date(Date.UTC(2026,6,1,21,30)), break_end: new Date(Date.UTC(2026,6,1,22,0)), duration_minutes: 30, is_complete: true }],
      is_complete: true,
    });
    const c = distributeWorkedHours(s, tz);
    const byHour = Object.fromEntries(c.map(x => [x.hour, Math.round(x.hours*100)/100]));
    expect(byHour).toEqual({ 17: 0.5, 18: 1 });
  });

  it('splits an overnight shift across two dates/dows', () => {
    // 22:00 Wed → 02:00 Thu local = 02:00Z Thu → 06:00Z Thu
    const s = session({
      clock_in: new Date(Date.UTC(2026,6,2,2,0)),
      clock_out: new Date(Date.UTC(2026,6,2,6,0)),
      is_complete: true,
    });
    const c = distributeWorkedHours(s, tz);
    const dates = new Set(c.map(x => x.localDate));
    expect(dates.has('2026-07-01')).toBe(true); // 22:00,23:00 Wed
    expect(dates.has('2026-07-02')).toBe(true); // 00:00,01:00 Thu
  });
});

describe('classifySplh', () => {
  it('classifies vs target with ±15% band', () => {
    expect(classifySplh(60, 60)).toBe('balanced');
    expect(classifySplh(80, 60)).toBe('lean');   // above target
    expect(classifySplh(40, 60)).toBe('slack');  // below target
  });
});

describe('buildSplhGrid', () => {
  const tz = 'UTC';
  it('computes cell SPLH = sales/hours and state', () => {
    const sales = [{ sale_date: '2026-07-01', sale_time: null, sold_at: '2026-07-01T17:00:00Z', total_price: 300 }];
    const sessions = [session({
      clock_in: new Date(Date.UTC(2026,6,1,17,0)),
      clock_out: new Date(Date.UTC(2026,6,1,20,0)),
      is_complete: true,
    })];
    const grid = buildSplhGrid(sales, sessions, tz, 60);
    const cell = grid.find(c => c.hour === 17 && c.dow === 3)!; // Wed 17:00
    expect(cell.totalSales).toBe(300);
    expect(cell.totalHours).toBeCloseTo(1, 5);
    expect(cell.splh).toBe(300);
    expect(cell.state).toBe('lean');
  });

  it('marks sales-without-labor as no-labor (never Infinity)', () => {
    const sales = [{ sale_date: '2026-07-01', sale_time: null, sold_at: '2026-07-01T17:00:00Z', total_price: 100 }];
    const grid = buildSplhGrid(sales, [], tz, 60);
    const cell = grid.find(c => c.totalSales > 0)!; // dow=3 (Wed), hour=17
    expect(cell.hour).toBe(17);
    expect(cell.dow).toBe(3);
    expect(cell.splh).toBeNull();
    expect(cell.state).toBe('no-labor');
  });

  it('marks hours with neither sales nor labor as closed', () => {
    const grid = buildSplhGrid([], [], tz, 60);
    const cell = grid.find(c => c.hour === 3 && c.dow === 0)!;
    expect(cell.totalSales).toBe(0);
    expect(cell.totalHours).toBe(0);
    expect(cell.splh).toBeNull();
    expect(cell.state).toBe('closed');
  });

  it('returns a full 7x24 grid', () => {
    const grid = buildSplhGrid([], [], tz, 60);
    expect(grid).toHaveLength(7 * 24);
  });

  it('spreads a date\'s total evenly across business hours when NO sale has a derivable hour (design §6)', () => {
    // Neither sold_at nor sale_time present — e.g. CSV-imported sales.
    const sales = [
      { sale_date: '2026-07-01', sale_time: null, sold_at: null, total_price: 1300 }, // Wed
    ];
    const sessions = [session({
      clock_in: new Date(Date.UTC(2026, 6, 1, 17, 0)),
      clock_out: new Date(Date.UTC(2026, 6, 1, 18, 0)),
      worked_minutes: 60,
      is_complete: true,
    })];
    const grid = buildSplhGrid(sales, sessions, tz, 60);

    // 1300 spread across the 9am-10pm (13h) fallback window = 100/hr.
    const spreadCells = grid.filter(c => c.dow === 3 && c.hour >= 9 && c.hour < 22);
    expect(spreadCells).toHaveLength(13);
    for (const cell of spreadCells) expect(cell.totalSales).toBeCloseTo(100, 5);

    // Total across the grid still equals the full day's sales — no silent
    // drop to totalSales=0 (the bug this regression guards against).
    const totalSales = grid.reduce((sum, c) => sum + c.totalSales, 0);
    expect(totalSales).toBeCloseTo(1300, 5);

    // The real punch data still lands in its actual (dow, hour) bucket —
    // only the sales side is spread.
    const laborCell = grid.find(c => c.dow === 3 && c.hour === 17)!;
    expect(laborCell.totalHours).toBeCloseTo(1, 5);
  });

  it('does NOT spread when at least one sale in the window has a derivable hour (mixed data keeps real buckets)', () => {
    const sales = [
      { sale_date: '2026-07-01', sale_time: null, sold_at: '2026-07-01T17:00:00Z', total_price: 300 },
      { sale_date: '2026-07-02', sale_time: null, sold_at: null, total_price: 500 }, // no derivable hour — dropped, not spread
    ];
    const grid = buildSplhGrid(sales, [], tz, 60);
    const totalSales = grid.reduce((sum, c) => sum + c.totalSales, 0);
    // Only the $300 sale (with a real hour) is counted; the $500 sale is
    // skipped since the fallback only engages when NO sale has an hour.
    expect(totalSales).toBeCloseTo(300, 5);
  });

  it('CRITICAL: does not throw on a malformed sold_at — the row is dropped, other rows still bucket normally', () => {
    // `Intl.DateTimeFormat.formatToParts` throws a RangeError on an Invalid
    // Date; `new Date('not-a-real-timestamp')` produces one. Regression guard
    // for buildSplhGrid crashing on any sale row with a malformed sold_at.
    //
    // `hourOfSale` gives `sold_at` priority whenever it's present (even a
    // malformed one) and does NOT fall back to `sale_time` in that case —
    // that's the pre-existing, intentional contract this fix preserves; it
    // only stops the crash, it doesn't change which source wins.
    const sales = [
      // Valid sold_at -> bucketed normally (Wed 2026-07-01, hour 18).
      { sale_date: '2026-07-01', sale_time: null, sold_at: '2026-07-01T18:00:00Z', total_price: 150 },
      // Malformed sold_at, even with a usable sale_time alongside it -> the
      // row has no derivable hour (sold_at wins but can't be parsed) and is
      // dropped, matching the documented "sales without an hour are skipped"
      // contract. The bug being guarded against is a crash here, not a
      // fallback to sale_time.
      { sale_date: '2026-07-02', sale_time: '12:00:00', sold_at: 'not-a-real-timestamp', total_price: 250 },
    ];
    expect(() => buildSplhGrid(sales, [], tz, 60)).not.toThrow();
    const grid = buildSplhGrid(sales, [], tz, 60);
    const cell = grid.find(c => c.dow === 3 && c.hour === 18)!;
    expect(cell.totalSales).toBeCloseTo(150, 5);
    const totalSales = grid.reduce((sum, c) => sum + c.totalSales, 0);
    expect(totalSales).toBeCloseTo(150, 5);
  });
});

describe('buildSplhTimeseries', () => {
  const tz = 'UTC';
  const sales = [
    { sale_date: '2026-07-01', sale_time: null, sold_at: '2026-07-01T17:00:00Z', total_price: 200 },
    { sale_date: '2026-07-02', sale_time: null, sold_at: '2026-07-02T17:00:00Z', total_price: 400 },
  ];
  const sessions = [
    session({ clock_in: new Date(Date.UTC(2026,6,1,17,0)), clock_out: new Date(Date.UTC(2026,6,1,21,0)), is_complete: true }),
    session({ clock_in: new Date(Date.UTC(2026,6,2,17,0)), clock_out: new Date(Date.UTC(2026,6,2,21,0)), is_complete: true }),
  ];
  it('daily buckets: one point per date with splh = sales/hours', () => {
    const pts = buildSplhTimeseries(sales, sessions, tz, 'day');
    const p1 = pts.find(p => p.bucketStart === '2026-07-01')!;
    expect(p1.totalSales).toBe(200);
    expect(p1.totalHours).toBeCloseTo(4, 5);
    expect(p1.splh).toBe(50);
  });
  it('weekly buckets group by Monday-start week', () => {
    const pts = buildSplhTimeseries(sales, sessions, tz, 'week');
    // 2026-06-29 is the Monday of the week containing Jul 1–2
    expect(pts).toHaveLength(1);
    expect(pts[0].bucketStart).toBe('2026-06-29');
    expect(pts[0].totalSales).toBe(600);
    expect(pts[0].splh).toBe(75); // 600 / 8h
  });
});

describe('summarizeSplh', () => {
  it('headline SPLH, verdict tone, and labor% when wage provided', () => {
    const grid = [
      { dow: 5, hour: 18, totalSales: 900, totalHours: 10, splh: 90, state: 'lean' as const },
      { dow: 5, hour: 19, totalSales: 900, totalHours: 10, splh: 90, state: 'lean' as const },
    ];
    const s = summarizeSplh(grid, 60, 1500);
    expect(s.actualSplh).toBe(90);
    expect(s.verdictTone).toBe('lean');
    // labor% = (20h * $15) / $1800 = 16.67%
    expect(s.laborPct).toBeCloseTo(16.67, 1);
    expect(s.hireHours).toContainEqual({ dow: 5, hour: 18 });
  });
  it('labor% is null with no wage', () => {
    const s = summarizeSplh([{ dow: 1, hour: 12, totalSales: 60, totalHours: 1, splh: 60, state: 'balanced' }], 60, null);
    expect(s.laborPct).toBeNull();
    expect(s.verdictTone).toBe('balanced');
  });
  it('empty grid → null actualSplh, none tone', () => {
    const s = summarizeSplh([], 60, 1500);
    expect(s.actualSplh).toBeNull();
    expect(s.verdictTone).toBe('none');
  });
});

describe('summarizeSplhTotals', () => {
  it('matches summarizeSplh(buildSplhGrid(...)) without building the grid (dashboard-card fast path)', () => {
    const tz = 'UTC';
    const sales = [
      { sale_date: '2026-07-01', sale_time: null, sold_at: '2026-07-01T17:00:00Z', total_price: 900 },
    ];
    const sessions = [session({
      clock_in: new Date(Date.UTC(2026, 6, 1, 17, 0)),
      clock_out: new Date(Date.UTC(2026, 6, 1, 20, 0)),
      worked_minutes: 180,
      is_complete: true,
    })];

    const viaGrid = summarizeSplh(buildSplhGrid(sales, sessions, tz, 60), 60, 1500);
    const viaTotals = summarizeSplhTotals(sales, sessions, 60, 1500);

    expect(viaTotals.actualSplh).toBe(300); // 900 / 3h
    expect(viaTotals.actualSplh).toBe(viaGrid.actualSplh);
    expect(viaTotals.laborPct).toBeCloseTo(viaGrid.laborPct!, 5);
    expect(viaTotals.verdictTone).toBe(viaGrid.verdictTone);
    // No per-hour classification is computed in the totals-only path.
    expect(viaTotals.hireHours).toEqual([]);
    expect(viaTotals.trimHours).toEqual([]);
  });

  it('empty inputs → null actualSplh, none tone', () => {
    const s = summarizeSplhTotals([], [], 60, 1500);
    expect(s.actualSplh).toBeNull();
    expect(s.verdictTone).toBe('none');
  });
});
