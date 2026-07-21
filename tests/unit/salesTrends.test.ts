import { describe, it, expect } from 'vitest';
import {
  parseSalesTrends,
  filterByPos,
  buildDailySeries,
  buildHourlySeries,
  buildWeekdaySeries,
  buildTopProducts,
  computeKpis,
  deriveInsights,
  hourCoverage,
  type SalesTrendsData,
} from '@/lib/salesTrends';

// Fixture mirrors the get_sales_trends RPC's JSON contract
// (docs/superpowers/specs/2026-07-20-pos-sales-trends-design.md §4.1).
const FIXTURE: SalesTrendsData = {
  pos_systems: ['toast', 'square'],
  by_day: [
    { sale_date: '2024-08-01', pos_system: 'toast', revenue: 100, orders: 3 },
    { sale_date: '2024-08-01', pos_system: 'square', revenue: 50, orders: 2 },
    { sale_date: '2024-08-02', pos_system: 'toast', revenue: 200, orders: 4 }, // Friday, busiest
    { sale_date: '2024-08-03', pos_system: 'square', revenue: 30, orders: 1 },
  ],
  by_hour: [
    { hour: 10, pos_system: 'toast', revenue: 40, day_count: 2 },
    { hour: 14, pos_system: 'toast', revenue: 210, day_count: 2 },
    { hour: 14, pos_system: 'square', revenue: 50, day_count: 1 },
    { hour: 18, pos_system: 'toast', revenue: 50, day_count: 1 },
  ],
  by_weekday: [
    // 2024-08-01 = Thursday(4), 2024-08-02 = Friday(5), 2024-08-03 = Saturday(6)
    { dow: 4, pos_system: 'toast', revenue: 100 },
    { dow: 4, pos_system: 'square', revenue: 50 },
    { dow: 5, pos_system: 'toast', revenue: 200 },
    { dow: 6, pos_system: 'square', revenue: 30 },
  ],
  by_product: [
    { item_name: 'Burger', pos_system: 'toast', revenue: 180, quantity: 20 },
    { item_name: 'Burger', pos_system: 'square', revenue: 20, quantity: 2 },
    { item_name: 'Fries', pos_system: 'toast', revenue: 100, quantity: 40 },
    { item_name: 'Soda', pos_system: 'square', revenue: 60, quantity: 30 },
    { item_name: 'Salad', pos_system: 'toast', revenue: 20, quantity: 5 },
  ],
};

const EMPTY: SalesTrendsData = {
  pos_systems: [],
  by_day: [],
  by_hour: [],
  by_weekday: [],
  by_product: [],
};

describe('parseSalesTrends', () => {
  it('parses a well-formed RPC payload', () => {
    const parsed = parseSalesTrends(FIXTURE as unknown);
    expect(parsed).toEqual(FIXTURE);
  });

  it('accepts a payload with all-empty buckets', () => {
    expect(parseSalesTrends(EMPTY as unknown)).toEqual(EMPTY);
  });

  it.each([null, undefined, 'nope', 42, []])('rejects non-object input %p', (bad) => {
    expect(() => parseSalesTrends(bad as unknown)).toThrow();
  });

  it('rejects a payload missing pos_systems', () => {
    const { pos_systems: _drop, ...rest } = FIXTURE;
    expect(() => parseSalesTrends(rest as unknown)).toThrow();
  });

  it('rejects a payload where by_day is not an array', () => {
    expect(() => parseSalesTrends({ ...FIXTURE, by_day: 'nope' } as unknown)).toThrow();
  });

  it('rejects a by_day row with a non-numeric revenue', () => {
    const bad = { ...FIXTURE, by_day: [{ sale_date: '2024-08-01', pos_system: 'toast', revenue: '100', orders: 3 }] };
    expect(() => parseSalesTrends(bad as unknown)).toThrow();
  });

  it('rejects a by_hour row missing the hour field', () => {
    const bad = { ...FIXTURE, by_hour: [{ pos_system: 'toast', revenue: 40, day_count: 2 }] };
    expect(() => parseSalesTrends(bad as unknown)).toThrow();
  });

  it('rejects a by_product row missing item_name', () => {
    const bad = { ...FIXTURE, by_product: [{ pos_system: 'toast', revenue: 40, quantity: 2 }] };
    expect(() => parseSalesTrends(bad as unknown)).toThrow();
  });

  it('rejects a by_weekday row with an out-of-range dow', () => {
    const bad = { ...FIXTURE, by_weekday: [{ dow: 7, pos_system: 'toast', revenue: 1 }] };
    expect(() => parseSalesTrends(bad as unknown)).toThrow();
  });
});

describe('filterByPos', () => {
  it('returns the data unchanged for "all"', () => {
    expect(filterByPos(FIXTURE, 'all')).toEqual(FIXTURE);
  });

  it('narrows every bucket + pos_systems to the selected pos', () => {
    const filtered = filterByPos(FIXTURE, 'toast');
    expect(filtered.pos_systems).toEqual(['toast']);
    expect(filtered.by_day.every((r) => r.pos_system === 'toast')).toBe(true);
    expect(filtered.by_hour.every((r) => r.pos_system === 'toast')).toBe(true);
    expect(filtered.by_weekday.every((r) => r.pos_system === 'toast')).toBe(true);
    expect(filtered.by_product.every((r) => r.pos_system === 'toast')).toBe(true);
    expect(filtered.by_day).toHaveLength(2);
  });

  it('returns empty buckets for a pos with no matching rows', () => {
    const filtered = filterByPos(FIXTURE, 'clover');
    expect(filtered).toEqual(EMPTY);
  });
});

describe('buildDailySeries', () => {
  it('builds flat per-pos keyed rows with a total, sorted by date', () => {
    const series = buildDailySeries(FIXTURE.by_day, FIXTURE.pos_systems);
    expect(series.map((r) => r.date)).toEqual(['2024-08-01', '2024-08-02', '2024-08-03']);

    const aug1 = series[0];
    expect(aug1.toast).toBe(100);
    expect(aug1.square).toBe(50);
    expect(aug1.total).toBe(150);

    // 2024-08-02 has no square revenue -> defaults to 0, not missing.
    const aug2 = series[1];
    expect(aug2.toast).toBe(200);
    expect(aug2.square).toBe(0);
    expect(aug2.total).toBe(200);
  });

  it('returns an empty array for empty input', () => {
    expect(buildDailySeries([], [])).toEqual([]);
  });

  it('zero-fills a day with no sales when dateRange is supplied (no gap in the axis)', () => {
    // 2024-08-02 has no rows for any POS in this fixture slice.
    const rows = FIXTURE.by_day.filter((r) => r.sale_date !== '2024-08-02');
    const series = buildDailySeries(rows, FIXTURE.pos_systems, {
      start: '2024-08-01',
      end: '2024-08-03',
    });
    expect(series.map((r) => r.date)).toEqual(['2024-08-01', '2024-08-02', '2024-08-03']);

    const aug2 = series[1];
    expect(aug2.toast).toBe(0);
    expect(aug2.square).toBe(0);
    expect(aug2.total).toBe(0);
  });

  it('without dateRange, still drops a day that has no rows (legacy/no-range behavior)', () => {
    const rows = FIXTURE.by_day.filter((r) => r.sale_date !== '2024-08-02');
    const series = buildDailySeries(rows, FIXTURE.pos_systems);
    expect(series.map((r) => r.date)).toEqual(['2024-08-01', '2024-08-03']);
  });
});

describe('buildHourlySeries', () => {
  it('builds a 0-23 hour axis with flat pos keys, total, and cumulativePct', () => {
    const series = buildHourlySeries(FIXTURE.by_hour, FIXTURE.pos_systems);
    expect(series).toHaveLength(24);
    expect(series.map((r) => r.hour)).toEqual(Array.from({ length: 24 }, (_, i) => i));

    const hour10 = series.find((r) => r.hour === 10)!;
    expect(hour10.toast).toBe(40);
    expect(hour10.square).toBe(0);
    expect(hour10.total).toBe(40);

    const hour0 = series.find((r) => r.hour === 0)!;
    expect(hour0.total).toBe(0);
  });

  it('cumulativePct is non-decreasing and reaches ~100 by the last hour', () => {
    const series = buildHourlySeries(FIXTURE.by_hour, FIXTURE.pos_systems);
    for (let i = 1; i < series.length; i++) {
      expect(series[i].cumulativePct).toBeGreaterThanOrEqual(series[i - 1].cumulativePct);
    }
    expect(series[23].cumulativePct).toBeCloseTo(100, 5);
  });

  it('returns an empty array for empty input (no scaffold)', () => {
    expect(buildHourlySeries([], [])).toEqual([]);
  });
});

describe('buildWeekdaySeries', () => {
  it('orders Monday-first and sums revenue across pos systems per day', () => {
    const series = buildWeekdaySeries(FIXTURE.by_weekday);
    expect(series.map((r) => r.dow)).toEqual([1, 2, 3, 4, 5, 6, 0]);
    expect(series.map((r) => r.label)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);

    const thu = series.find((r) => r.dow === 4)!;
    expect(thu.total).toBe(150); // 100 toast + 50 square
  });

  it('flags exactly the max-total day as isPeak', () => {
    const series = buildWeekdaySeries(FIXTURE.by_weekday);
    const peaks = series.filter((r) => r.isPeak);
    expect(peaks).toHaveLength(1);
    expect(peaks[0].dow).toBe(5); // Friday, 200
  });

  it('marks no day as peak when all totals are zero', () => {
    const series = buildWeekdaySeries([]);
    expect(series).toHaveLength(7);
    expect(series.every((r) => r.total === 0)).toBe(true);
    expect(series.some((r) => r.isPeak)).toBe(false);
  });
});

describe('buildTopProducts', () => {
  it('merges the same item across POS systems and ranks by revenue desc', () => {
    const top = buildTopProducts(FIXTURE.by_product, FIXTURE.by_day, 7);
    expect(top.map((r) => r.item_name)).toEqual(['Burger', 'Fries', 'Soda', 'Salad']);
    expect(top[0].revenue).toBe(200); // 180 + 20
    expect(top[0].quantity).toBe(22);
  });

  it('respects the n cap', () => {
    const top = buildTopProducts(FIXTURE.by_product, FIXTURE.by_day, 2);
    expect(top).toHaveLength(2);
    expect(top.map((r) => r.item_name)).toEqual(['Burger', 'Fries']);
  });

  it('computes sharePct relative to total revenue across all products', () => {
    const top = buildTopProducts(FIXTURE.by_product, FIXTURE.by_day, 7);
    // grand total = 180+20+100+60+20 = 380; Burger = 200/380 = 52.63%
    expect(top[0].sharePct).toBeCloseTo((200 / 380) * 100, 2);
  });

  it('returns a sparkline point per distinct day present in dayRows', () => {
    const top = buildTopProducts(FIXTURE.by_product, FIXTURE.by_day, 7);
    expect(top[0].sparkline).toHaveLength(3); // 08-01, 08-02, 08-03
    expect(top[0].sparkline.map((p) => p.date)).toEqual(['2024-08-01', '2024-08-02', '2024-08-03']);
    expect(top[0].sparkline.every((p) => p.value >= 0)).toBe(true);
  });

  it('returns an empty array for empty input', () => {
    expect(buildTopProducts([], [], 7)).toEqual([]);
  });
});

describe('computeKpis', () => {
  it('computes net sales, orders, and avg order from the full dataset', () => {
    const kpis = computeKpis(FIXTURE);
    expect(kpis.netSales).toBe(380); // 100+50+200+30
    expect(kpis.orders).toBe(10); // 3+2+4+1
    expect(kpis.avgOrder).toBeCloseTo(38, 5);
  });

  it('identifies the busiest day (summed across pos systems)', () => {
    const kpis = computeKpis(FIXTURE);
    expect(kpis.busiestDay).toEqual({ date: '2024-08-02', revenue: 200 });
  });

  it('identifies the peak hour (summed across pos systems)', () => {
    const kpis = computeKpis(FIXTURE);
    expect(kpis.peakHour).toEqual({ hour: 14, revenue: 260 }); // 210 + 50
  });

  it('computes a per-pos split summing back to net sales', () => {
    const kpis = computeKpis(FIXTURE);
    const total = kpis.posSplit.reduce((sum, p) => sum + p.revenue, 0);
    expect(total).toBeCloseTo(kpis.netSales, 5);
    const pctTotal = kpis.posSplit.reduce((sum, p) => sum + p.sharePct, 0);
    expect(pctTotal).toBeCloseTo(100, 5);
  });

  it('returns zeroed-out KPIs for empty data', () => {
    const kpis = computeKpis(EMPTY);
    expect(kpis.netSales).toBe(0);
    expect(kpis.orders).toBe(0);
    expect(kpis.avgOrder).toBe(0);
    expect(kpis.busiestDay).toBeNull();
    expect(kpis.peakHour).toBeNull();
    expect(kpis.posSplit).toEqual([]);
  });
});

describe('deriveInsights', () => {
  it('returns a non-empty, distinct callout for each of the four charts', () => {
    const insights = deriveInsights(FIXTURE);
    expect(insights.daily.length).toBeGreaterThan(0);
    expect(insights.hourly.length).toBeGreaterThan(0);
    expect(insights.weekday.length).toBeGreaterThan(0);
    expect(insights.product.length).toBeGreaterThan(0);
  });

  it('mentions the busiest day and top product by name', () => {
    const insights = deriveInsights(FIXTURE);
    expect(insights.daily).toContain('2024-08-02');
    expect(insights.product).toContain('Burger');
  });

  it('returns sensible fallback text for empty data instead of throwing', () => {
    expect(() => deriveInsights(EMPTY)).not.toThrow();
    const insights = deriveInsights(EMPTY);
    expect(insights.daily.length).toBeGreaterThan(0);
    expect(insights.hourly.length).toBeGreaterThan(0);
    expect(insights.weekday.length).toBeGreaterThan(0);
    expect(insights.product.length).toBeGreaterThan(0);
  });
});

describe('hourCoverage', () => {
  it('returns the fraction of day revenue that carried a usable hour', () => {
    // by_hour revenue total = 40+210+50+50 = 350; by_day revenue total = 380
    expect(hourCoverage(FIXTURE)).toBeCloseTo(350 / 380, 5);
  });

  it('returns 1 for empty data (nothing missing)', () => {
    expect(hourCoverage(EMPTY)).toBe(1);
  });

  it('returns 1 when hour revenue fully accounts for day revenue', () => {
    const full: SalesTrendsData = {
      ...EMPTY,
      pos_systems: ['toast'],
      by_day: [{ sale_date: '2024-08-01', pos_system: 'toast', revenue: 100, orders: 1 }],
      by_hour: [{ hour: 10, pos_system: 'toast', revenue: 100, day_count: 1 }],
    };
    expect(hourCoverage(full)).toBe(1);
  });
});
