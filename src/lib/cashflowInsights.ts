/**
 * Pure aggregation for the Cash Flow Insights view.
 *
 * This file has no side effects and no Supabase calls. `useCashFlowInsights`
 * fetches the rows; this file turns rows into totals and time buckets.
 */

/** One bank transaction row, as read from `bank_transactions`. */
export interface CashFlowRow {
  transaction_date: string; // 'yyyy-MM-dd'
  amount: number; // negative for outflow, positive for inflow
  is_transfer: boolean;
  normalized_payee: string | null;
  merchant_name: string | null;
  description: string | null;
  category: { id: string; name: string } | null;
}

/** The date window the aggregation runs over. */
export interface CashFlowPeriod {
  from: Date;
  to: Date;
}

/** Bucket size for `bucketSeries`. */
export type Interval = 'day' | 'week' | 'month';

/** Options for `computeTotals`. */
export interface ComputeTotalsOptions {
  excludeTransfers?: boolean;
}

/** Totals across a set of rows. */
export interface CashFlowTotals {
  moneyIn: number;
  moneyOut: number;
  net: number;
}

/** One time bucket in `bucketSeries`. */
export interface CashFlowBucket {
  /** Start of the bucket, 'yyyy-MM-dd'. */
  bucketStart: string;
  moneyIn: number;
  moneyOut: number;
  /** Signed sum per category name (negative amounts stay negative). */
  byCategory: Record<string, number>;
}

/** The full aggregate output for the Cash Flow view. */
export interface CashFlowAggregates {
  totals: CashFlowTotals;
  series: CashFlowBucket[];
}

const DAY_INTERVAL_MAX_DAYS = 31;
const WEEK_INTERVAL_MAX_DAYS = 120;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysBetween(period: CashFlowPeriod): number {
  const fromMidnight = new Date(period.from.getFullYear(), period.from.getMonth(), period.from.getDate());
  const toMidnight = new Date(period.to.getFullYear(), period.to.getMonth(), period.to.getDate());
  return Math.round((toMidnight.getTime() - fromMidnight.getTime()) / MS_PER_DAY) + 1;
}

/**
 * Pick the default bucket interval for a period.
 * Day for periods up to 31 days, week up to 120 days, month above.
 */
export function defaultInterval(period: CashFlowPeriod): Interval {
  const days = daysBetween(period);
  if (days <= DAY_INTERVAL_MAX_DAYS) return 'day';
  if (days <= WEEK_INTERVAL_MAX_DAYS) return 'week';
  return 'month';
}

function categoryLabel(row: CashFlowRow): string {
  if (row.is_transfer) return 'Transfers';
  if (row.category?.name) return row.category.name;
  return 'Uncategorized';
}

/** Sum money in, money out, and net across a set of rows. */
export function computeTotals(rows: CashFlowRow[], options: ComputeTotalsOptions = {}): CashFlowTotals {
  const { excludeTransfers = false } = options;
  let moneyIn = 0;
  let moneyOut = 0;

  for (const row of rows) {
    if (excludeTransfers && row.is_transfer) continue;
    if (row.amount >= 0) {
      moneyIn += row.amount;
    } else {
      moneyOut += row.amount;
    }
  }

  return { moneyIn, moneyOut, net: moneyIn + moneyOut };
}

function parseDateKey(dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function startOfWeekMonday(date: Date): Date {
  const day = date.getDay(); // 0 = Sunday
  const diff = day === 0 ? -6 : 1 - day;
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate() + diff);
  return result;
}

function formatDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function bucketStartFor(date: Date, interval: Interval): string {
  if (interval === 'day') return formatDateKey(date);
  if (interval === 'week') return formatDateKey(startOfWeekMonday(date));
  return formatDateKey(new Date(date.getFullYear(), date.getMonth(), 1));
}

/**
 * Group rows into time buckets. Only rows inside the period count.
 * Each bucket carries moneyIn/moneyOut sums and a per-category signed sum.
 */
export function bucketSeries(rows: CashFlowRow[], period: CashFlowPeriod, interval: Interval): CashFlowBucket[] {
  const fromMidnight = new Date(period.from.getFullYear(), period.from.getMonth(), period.from.getDate());
  const toMidnight = new Date(period.to.getFullYear(), period.to.getMonth(), period.to.getDate());

  const bucketsByKey = new Map<string, CashFlowBucket>();
  const orderedKeys: string[] = [];

  for (const row of rows) {
    const rowDate = parseDateKey(row.transaction_date);
    if (rowDate < fromMidnight || rowDate > toMidnight) continue;

    const bucketStart = bucketStartFor(rowDate, interval);
    let bucket = bucketsByKey.get(bucketStart);
    if (!bucket) {
      bucket = { bucketStart, moneyIn: 0, moneyOut: 0, byCategory: {} };
      bucketsByKey.set(bucketStart, bucket);
      orderedKeys.push(bucketStart);
    }

    if (row.amount >= 0) {
      bucket.moneyIn += row.amount;
    } else {
      bucket.moneyOut += row.amount;
    }

    const label = categoryLabel(row);
    bucket.byCategory[label] = (bucket.byCategory[label] ?? 0) + row.amount;
  }

  orderedKeys.sort();
  return orderedKeys.map((key) => bucketsByKey.get(key)!);
}

/** Compute totals and the bucketed series in one call. */
export function computeCashFlowAggregates(
  rows: CashFlowRow[],
  period: CashFlowPeriod,
  interval: Interval,
  options: ComputeTotalsOptions = {},
): CashFlowAggregates {
  return {
    totals: computeTotals(rows, options),
    series: bucketSeries(rows, period, interval),
  };
}
