/**
 * Pure selectors for the POS Sales Trends panel.
 *
 * Design: docs/superpowers/specs/2026-07-20-pos-sales-trends-design.md §4.2
 *
 * `get_sales_trends` (the RPC) returns `Json`. Everything here is pure and
 * unit-tested in isolation — no React, no Supabase client — so the panel's
 * charts/KPIs/insights logic never has to render `POSSales.tsx` (~30 hooks)
 * to be exercised (lesson 2026-05-xx).
 *
 * `pos_system` is intentionally typed `string` (not `POSSystemType`) here:
 * the RPC payload is untyped `Json` at the boundary, and `parseSalesTrends`
 * is the runtime guard that stands in for a compile-time contract — narrowing
 * to `POSSystemType` at this layer would let a malformed/legacy value pass
 * TypeScript while still blowing up at runtime. `posColor`/`posLabel` (in
 * `./posColors`) already fall back gracefully for values outside the known
 * union, so consumers of these selectors get a safe display regardless.
 */

import { formatCurrency } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types (mirror the get_sales_trends RPC JSON contract, §4.1)
// ---------------------------------------------------------------------------

export interface SalesTrendsDayRow {
  sale_date: string;
  pos_system: string;
  revenue: number;
  orders: number;
}

export interface SalesTrendsHourRow {
  hour: number;
  pos_system: string;
  revenue: number;
  day_count: number;
}

export interface SalesTrendsWeekdayRow {
  /** 0=Sun..6=Sat, matches Postgres EXTRACT(DOW). */
  dow: number;
  pos_system: string;
  revenue: number;
}

export interface SalesTrendsProductRow {
  item_name: string;
  pos_system: string;
  revenue: number;
  quantity: number;
}

export interface SalesTrendsData {
  /** Distinct pos_system values present in range, revenue desc. */
  pos_systems: string[];
  by_day: SalesTrendsDayRow[];
  by_hour: SalesTrendsHourRow[];
  by_weekday: SalesTrendsWeekdayRow[];
  by_product: SalesTrendsProductRow[];
}

/** Selected POS scope for the panel's segmented control. */
export type PosFilter = string | 'all';

// ---------------------------------------------------------------------------
// parseSalesTrends — runtime guard for the untyped RPC `Json` payload
// ---------------------------------------------------------------------------

function fail(path: string, detail: string): never {
  throw new Error(`parseSalesTrends: invalid payload at "${path}" — ${detail}`);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asString(v: unknown, path: string): string {
  if (typeof v !== 'string') fail(path, `expected a string, got ${typeof v}`);
  return v;
}

function asFiniteNumber(v: unknown, path: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    fail(path, `expected a finite number, got ${typeof v}`);
  }
  return v;
}

function asArray(v: unknown, path: string): unknown[] {
  if (!Array.isArray(v)) fail(path, `expected an array, got ${typeof v}`);
  return v;
}

function parseDayRow(v: unknown, path: string): SalesTrendsDayRow {
  if (!isPlainObject(v)) fail(path, 'expected an object');
  return {
    sale_date: asString(v.sale_date, `${path}.sale_date`),
    pos_system: asString(v.pos_system, `${path}.pos_system`),
    revenue: asFiniteNumber(v.revenue, `${path}.revenue`),
    orders: asFiniteNumber(v.orders, `${path}.orders`),
  };
}

function parseHourRow(v: unknown, path: string): SalesTrendsHourRow {
  if (!isPlainObject(v)) fail(path, 'expected an object');
  const hour = asFiniteNumber(v.hour, `${path}.hour`);
  if (hour < 0 || hour > 23) fail(`${path}.hour`, `expected 0-23, got ${hour}`);
  return {
    hour,
    pos_system: asString(v.pos_system, `${path}.pos_system`),
    revenue: asFiniteNumber(v.revenue, `${path}.revenue`),
    day_count: asFiniteNumber(v.day_count, `${path}.day_count`),
  };
}

function parseWeekdayRow(v: unknown, path: string): SalesTrendsWeekdayRow {
  if (!isPlainObject(v)) fail(path, 'expected an object');
  const dow = asFiniteNumber(v.dow, `${path}.dow`);
  if (dow < 0 || dow > 6) fail(`${path}.dow`, `expected 0-6, got ${dow}`);
  return {
    dow,
    pos_system: asString(v.pos_system, `${path}.pos_system`),
    revenue: asFiniteNumber(v.revenue, `${path}.revenue`),
  };
}

function parseProductRow(v: unknown, path: string): SalesTrendsProductRow {
  if (!isPlainObject(v)) fail(path, 'expected an object');
  return {
    item_name: asString(v.item_name, `${path}.item_name`),
    pos_system: asString(v.pos_system, `${path}.pos_system`),
    revenue: asFiniteNumber(v.revenue, `${path}.revenue`),
    quantity: asFiniteNumber(v.quantity, `${path}.quantity`),
  };
}

/**
 * Validate + narrow the `get_sales_trends` RPC's `Json` return into
 * `SalesTrendsData`. Throws (rather than silently coercing) on any
 * structural or type mismatch — callers should surface the error via the
 * hook's `error` state, not swallow it (avoids the `as unknown as`
 * blind-cast trap, lesson 2026-04-xx).
 */
export function parseSalesTrends(json: unknown): SalesTrendsData {
  if (!isPlainObject(json)) {
    fail('$', `expected an object, got ${Array.isArray(json) ? 'array' : typeof json}`);
  }

  const posSystems = asArray(json.pos_systems, '$.pos_systems').map((v, i) =>
    asString(v, `$.pos_systems[${i}]`),
  );
  const byDay = asArray(json.by_day, '$.by_day').map((v, i) => parseDayRow(v, `$.by_day[${i}]`));
  const byHour = asArray(json.by_hour, '$.by_hour').map((v, i) => parseHourRow(v, `$.by_hour[${i}]`));
  const byWeekday = asArray(json.by_weekday, '$.by_weekday').map((v, i) =>
    parseWeekdayRow(v, `$.by_weekday[${i}]`),
  );
  const byProduct = asArray(json.by_product, '$.by_product').map((v, i) =>
    parseProductRow(v, `$.by_product[${i}]`),
  );

  return {
    pos_systems: posSystems,
    by_day: byDay,
    by_hour: byHour,
    by_weekday: byWeekday,
    by_product: byProduct,
  };
}

// ---------------------------------------------------------------------------
// filterByPos — re-scope the whole payload to one POS system (client-side,
// so the segmented control never refetches).
// ---------------------------------------------------------------------------

export function filterByPos(data: SalesTrendsData, pos: PosFilter): SalesTrendsData {
  if (pos === 'all') return data;
  return {
    pos_systems: data.pos_systems.filter((p) => p === pos),
    by_day: data.by_day.filter((r) => r.pos_system === pos),
    by_hour: data.by_hour.filter((r) => r.pos_system === pos),
    by_weekday: data.by_weekday.filter((r) => r.pos_system === pos),
    by_product: data.by_product.filter((r) => r.pos_system === pos),
  };
}

// ---------------------------------------------------------------------------
// buildDailySeries — flat, top-level POS keys so Recharts dataKey + shadcn
// ChartConfig resolve directly (NOT a nested byPos object — see design §4.2).
//
// When `dateRange` is supplied, every calendar date in [start, end] is
// zero-filled up front (mirroring buildHourlySeries' 0-23 hour scaffold),
// so a day with zero net sales across every POS (closed day, pre-integration
// day, etc.) still emits `{ date, total: 0, ... }` instead of being dropped.
// `SalesByDayChart` renders this on a categorical `XAxis dataKey="date"`
// (equal spacing per array entry, not per actual date) — a dropped date
// silently compresses the gap and mis-represents adjacent bars as
// consecutive days.
// ---------------------------------------------------------------------------

export interface DailySeriesRow {
  date: string;
  total: number;
  [posSystem: string]: number | string;
}

/** Inclusive list of `YYYY-MM-DD` dates from `start` to `end`, UTC-safe (no local-timezone drift). */
function eachDateInRange(start: string, end: string): string[] {
  const [sy, sm, sd] = start.split('-').map(Number);
  const [ey, em, ed] = end.split('-').map(Number);
  const startMs = Date.UTC(sy, sm - 1, sd);
  const endMs = Date.UTC(ey, em - 1, ed);
  const dates: string[] = [];
  for (let ms = startMs; ms <= endMs; ms += 24 * 60 * 60 * 1000) {
    const d = new Date(ms);
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    dates.push(`${yyyy}-${mm}-${dd}`);
  }
  return dates;
}

export function buildDailySeries(
  rows: SalesTrendsDayRow[],
  posSystems: string[],
  dateRange?: { start: string; end: string },
): DailySeriesRow[] {
  const byDate = new Map<string, DailySeriesRow>();

  function getOrCreate(date: string): DailySeriesRow {
    let entry = byDate.get(date);
    if (!entry) {
      entry = { date, total: 0 };
      for (const pos of posSystems) entry[pos] = 0;
      byDate.set(date, entry);
    }
    return entry;
  }

  if (dateRange) {
    for (const date of eachDateInRange(dateRange.start, dateRange.end)) {
      getOrCreate(date);
    }
  }

  for (const row of rows) {
    const entry = getOrCreate(row.sale_date);
    entry[row.pos_system] = ((entry[row.pos_system] as number) ?? 0) + row.revenue;
  }
  const result = Array.from(byDate.values());
  for (const entry of result) {
    entry.total = posSystems.reduce((sum, pos) => sum + ((entry[pos] as number) ?? 0), 0);
  }
  result.sort((a, b) => a.date.localeCompare(b.date));
  return result;
}

// ---------------------------------------------------------------------------
// buildHourlySeries — flat POS keys + cumulativePct (right-axis overlay).
// Always a full 0-23 axis (when there is any data) so the chart's x-axis is
// stable regardless of which hours actually had sales.
// ---------------------------------------------------------------------------

export interface HourlySeriesRow {
  hour: number;
  total: number;
  cumulativePct: number;
  [posSystem: string]: number;
}

export function buildHourlySeries(rows: SalesTrendsHourRow[], posSystems: string[]): HourlySeriesRow[] {
  if (rows.length === 0) return [];

  const byHour = new Map<number, HourlySeriesRow>();
  for (let hour = 0; hour < 24; hour++) {
    const entry: HourlySeriesRow = { hour, total: 0, cumulativePct: 0 };
    for (const pos of posSystems) entry[pos] = 0;
    byHour.set(hour, entry);
  }
  for (const row of rows) {
    const entry = byHour.get(row.hour);
    if (!entry) continue; // out-of-range hour already rejected by parseSalesTrends
    entry[row.pos_system] = (entry[row.pos_system] ?? 0) + row.revenue;
  }

  const result = Array.from(byHour.values()).sort((a, b) => a.hour - b.hour);
  for (const entry of result) {
    entry.total = posSystems.reduce((sum, pos) => sum + (entry[pos] ?? 0), 0);
  }

  const grandTotal = result.reduce((sum, r) => sum + r.total, 0);
  let running = 0;
  for (const entry of result) {
    running += entry.total;
    entry.cumulativePct = grandTotal > 0 ? (running / grandTotal) * 100 : 0;
  }
  return result;
}

// ---------------------------------------------------------------------------
// buildWeekdaySeries — Mon-first display order; isPeak flags the top day
// (text badge, not color-only — a11y).
// ---------------------------------------------------------------------------

export interface WeekdaySeriesRow {
  dow: number;
  label: string;
  total: number;
  isPeak: boolean;
}

const WEEKDAY_LABELS: Record<number, string> = {
  0: 'Sun',
  1: 'Mon',
  2: 'Tue',
  3: 'Wed',
  4: 'Thu',
  5: 'Fri',
  6: 'Sat',
};

/** Monday-first display order: 0=Sun sorts last. */
const MON_FIRST_DOWS = [1, 2, 3, 4, 5, 6, 0];

export function buildWeekdaySeries(rows: SalesTrendsWeekdayRow[]): WeekdaySeriesRow[] {
  const totals = new Map<number, number>(MON_FIRST_DOWS.map((dow) => [dow, 0]));
  for (const row of rows) {
    totals.set(row.dow, (totals.get(row.dow) ?? 0) + row.revenue);
  }

  const maxTotal = Math.max(...Array.from(totals.values()));
  const hasPeak = maxTotal > 0;

  return MON_FIRST_DOWS.map((dow) => {
    const total = totals.get(dow) ?? 0;
    return {
      dow,
      label: WEEKDAY_LABELS[dow],
      total,
      isPeak: hasPeak && total === maxTotal,
    };
  });
}

// ---------------------------------------------------------------------------
// buildTopProducts — merge by item_name across POS, rank, share %, sparkline.
//
// The RPC's by_product bucket is aggregated over the whole date range (no
// per-item-per-day breakdown — see §4.1's WITH revenue_rows / GROUP BY
// item_name, pos_system). A true per-item daily trend isn't available from
// this contract, so the sparkline approximates each item's day-by-day shape
// by scaling the (already-computed) daily revenue curve by the item's share
// of total revenue: value[d] = item.revenue * (dayTotal[d] / grandTotal).
// This traces the restaurant's overall sales rhythm at the item's magnitude,
// which is the best signal available without a schema/RPC change (same
// documented-substitution pattern as task-1/task-3 in progress.md).
// ---------------------------------------------------------------------------

export interface TopProductSparklinePoint {
  date: string;
  value: number;
}

export interface TopProductRow {
  item_name: string;
  revenue: number;
  quantity: number;
  sharePct: number;
  sparkline: TopProductSparklinePoint[];
}

export function buildTopProducts(
  productRows: SalesTrendsProductRow[],
  dayRows: SalesTrendsDayRow[],
  n = 7,
): TopProductRow[] {
  if (productRows.length === 0) return [];

  const merged = new Map<string, { revenue: number; quantity: number }>();
  for (const row of productRows) {
    const entry = merged.get(row.item_name) ?? { revenue: 0, quantity: 0 };
    entry.revenue += row.revenue;
    entry.quantity += row.quantity;
    merged.set(row.item_name, entry);
  }

  const grandTotal = Array.from(merged.values()).reduce((sum, r) => sum + r.revenue, 0);

  const dailyTotals = new Map<string, number>();
  for (const row of dayRows) {
    dailyTotals.set(row.sale_date, (dailyTotals.get(row.sale_date) ?? 0) + row.revenue);
  }
  const sortedDates = Array.from(dailyTotals.keys()).sort((a, b) => a.localeCompare(b));
  const dayGrandTotal = Array.from(dailyTotals.values()).reduce((sum, v) => sum + v, 0);

  const ranked = Array.from(merged.entries())
    .map(([item_name, { revenue, quantity }]) => ({ item_name, revenue, quantity }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, n);

  return ranked.map(({ item_name, revenue, quantity }) => {
    const sharePct = grandTotal > 0 ? (revenue / grandTotal) * 100 : 0;
    const itemShare = dayGrandTotal > 0 ? revenue / dayGrandTotal : 0;
    const sparkline: TopProductSparklinePoint[] = sortedDates.map((date) => ({
      date,
      value: (dailyTotals.get(date) ?? 0) * itemShare,
    }));
    return { item_name, revenue, quantity, sharePct, sparkline };
  });
}

// ---------------------------------------------------------------------------
// computeKpis — net sales, orders, avg order, busiest day, peak hour, split.
// ---------------------------------------------------------------------------

export interface PosSplitEntry {
  pos_system: string;
  revenue: number;
  sharePct: number;
}

export interface SalesTrendsKpis {
  netSales: number;
  orders: number;
  avgOrder: number;
  busiestDay: { date: string; revenue: number } | null;
  peakHour: { hour: number; revenue: number } | null;
  posSplit: PosSplitEntry[];
}

export function computeKpis(data: SalesTrendsData): SalesTrendsKpis {
  const netSales = data.by_day.reduce((sum, r) => sum + r.revenue, 0);
  const orders = data.by_day.reduce((sum, r) => sum + r.orders, 0);
  const avgOrder = orders > 0 ? netSales / orders : 0;

  const dayTotals = new Map<string, number>();
  for (const row of data.by_day) {
    dayTotals.set(row.sale_date, (dayTotals.get(row.sale_date) ?? 0) + row.revenue);
  }
  let busiestDay: { date: string; revenue: number } | null = null;
  for (const [date, revenue] of dayTotals) {
    if (!busiestDay || revenue > busiestDay.revenue) busiestDay = { date, revenue };
  }

  const hourTotals = new Map<number, number>();
  for (const row of data.by_hour) {
    hourTotals.set(row.hour, (hourTotals.get(row.hour) ?? 0) + row.revenue);
  }
  let peakHour: { hour: number; revenue: number } | null = null;
  for (const [hour, revenue] of hourTotals) {
    if (!peakHour || revenue > peakHour.revenue) peakHour = { hour, revenue };
  }

  const posTotals = new Map<string, number>();
  for (const row of data.by_day) {
    posTotals.set(row.pos_system, (posTotals.get(row.pos_system) ?? 0) + row.revenue);
  }
  const posSplit: PosSplitEntry[] = Array.from(posTotals.entries())
    .map(([pos_system, revenue]) => ({
      pos_system,
      revenue,
      sharePct: netSales > 0 ? (revenue / netSales) * 100 : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue);

  return { netSales, orders, avgOrder, busiestDay, peakHour, posSplit };
}

// ---------------------------------------------------------------------------
// deriveInsights — plain-language callouts, reused as chart aria-labels
// (WCAG 1.1.1) so accessibility text and displayed insight stay in sync.
// ---------------------------------------------------------------------------

export interface SalesTrendsInsights {
  daily: string;
  hourly: string;
  weekday: string;
  product: string;
}

/**
 * Re-exported (not redefined) so `@/components/pos-sales/salesTrendsFormat.ts`
 * can re-export the same implementation instead of duplicating it — this is
 * the single source of truth for both `deriveInsights`' copy text and the
 * charts' tick/tooltip formatting. `@/lib/utils`'s `formatCurrency` already
 * implements the identical `Intl.NumberFormat('en-US', { style: 'currency',
 * currency: 'USD' })` formatting used project-wide, so it's reused here
 * instead of being reimplemented.
 */
export { formatCurrency };

export function formatHour(hour: number): string {
  const period = hour < 12 ? 'AM' : 'PM';
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}${period}`;
}

export function deriveInsights(data: SalesTrendsData): SalesTrendsInsights {
  const kpis = computeKpis(data);
  const weekday = buildWeekdaySeries(data.by_weekday);
  const hourly = buildHourlySeries(data.by_hour, data.pos_systems);
  const products = buildTopProducts(data.by_product, data.by_day, 1);

  const daily = kpis.busiestDay
    ? (() => {
        const numDays = new Set(data.by_day.map((r) => r.sale_date)).size;
        const avgDay = numDays > 0 ? kpis.netSales / numDays : 0;
        const multiple = avgDay > 0 ? kpis.busiestDay!.revenue / avgDay : 0;
        return `${kpis.busiestDay!.date} was the busiest day with ${formatCurrency(
          kpis.busiestDay!.revenue,
        )}${multiple > 0 ? ` (${multiple.toFixed(1)}x the daily average)` : ''}.`;
      })()
    : 'No sales in this range yet.';

  const halfwayHour = hourly.find((h) => h.cumulativePct >= 50);
  const hourlyInsight = halfwayHour
    ? `Half the day's revenue comes in by ${formatHour(halfwayHour.hour)}.`
    : 'No hourly sales data available for this range.';

  const peakWeekday = weekday.find((w) => w.isPeak);
  const avgWeekdayTotal = weekday.reduce((sum, w) => sum + w.total, 0) / weekday.length;
  const weekdayInsight =
    peakWeekday && avgWeekdayTotal > 0
      ? `${peakWeekday.label}s bring in ${(peakWeekday.total / avgWeekdayTotal).toFixed(1)}x an average day.`
      : 'No weekday pattern yet — not enough sales in this range.';

  const productInsight = products[0]
    ? `Top seller: ${products[0].item_name} (${formatCurrency(products[0].revenue)}, ${products[0].sharePct.toFixed(
        0,
      )}% of revenue).`
    : 'No product sales in this range.';

  return { daily, hourly: hourlyInsight, weekday: weekdayInsight, product: productInsight };
}

// ---------------------------------------------------------------------------
// hourCoverage — fraction of revenue that carried a usable hour (mirrors
// useHourlySalesPattern's hasHourlyBreakdown flag, but as a continuous ratio
// so the panel can surface a "hour data partial" note).
// ---------------------------------------------------------------------------

export function hourCoverage(data: SalesTrendsData): number {
  const dayTotal = data.by_day.reduce((sum, r) => sum + r.revenue, 0);
  if (dayTotal <= 0) return 1;
  const hourTotal = data.by_hour.reduce((sum, r) => sum + r.revenue, 0);
  return Math.min(1, hourTotal / dayTotal);
}
