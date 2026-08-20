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

/** One row's signed total for a category, from `topCategories`. */
export interface CategoryTotal {
  name: string;
  amount: number;
}

/** Direction filter for `breakdown`. */
export type CashFlowDirection = 'in' | 'out';

/** Group key for `breakdown`. */
export type BreakdownBy = 'payee' | 'category';

/** One row in a `breakdown` table. */
export interface BreakdownRow {
  label: string;
  amount: number;
  pctOfTotal: number;
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

const TOP_CATEGORY_COUNT = 5;
const TOP_BREAKDOWN_COUNT = 8;

/**
 * Pick a display name for a transaction's other party.
 * Falls back through `normalized_payee`, `merchant_name`, `description`,
 * then `'Unknown'` when all three are null.
 */
export function payeeFor(row: CashFlowRow): string {
  return row.normalized_payee ?? row.merchant_name ?? row.description ?? 'Unknown';
}

function sumByKey(rows: CashFlowRow[], keyFor: (row: CashFlowRow) => string): { key: string; amount: number }[] {
  const sums = new Map<string, number>();
  const order: string[] = [];

  for (const row of rows) {
    const key = keyFor(row);
    if (!sums.has(key)) {
      sums.set(key, 0);
      order.push(key);
    }
    sums.set(key, sums.get(key)! + row.amount);
  }

  return order.map((key) => ({ key, amount: sums.get(key)! }));
}

/**
 * Sum rows by category. Returns the five largest by absolute sum;
 * the rest fold into `Other`.
 */
export function topCategories(rows: CashFlowRow[]): CategoryTotal[] {
  const entries = sumByKey(rows, categoryLabel).sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));

  const top = entries.slice(0, TOP_CATEGORY_COUNT).map(({ key, amount }) => ({ name: key, amount }));
  const rest = entries.slice(TOP_CATEGORY_COUNT);

  if (rest.length > 0) {
    const otherAmount = rest.reduce((sum, entry) => sum + entry.amount, 0);
    top.push({ name: 'Other', amount: otherAmount });
  }

  return top;
}

/**
 * Sum rows in one direction (money in or money out), grouped by payee or
 * category. Returns the top eight rows by absolute amount, the rest folded
 * into a `Remaining` row, each with `pctOfTotal`.
 */
export function breakdown(rows: CashFlowRow[], direction: CashFlowDirection, by: BreakdownBy): BreakdownRow[] {
  const filtered = rows.filter((row) => (direction === 'in' ? row.amount >= 0 : row.amount < 0));
  const keyFor = by === 'payee' ? payeeFor : categoryLabel;

  const total = filtered.reduce((sum, row) => sum + Math.abs(row.amount), 0);
  const pctOfTotal = (amount: number) => (total === 0 ? 0 : (Math.abs(amount) / total) * 100);

  const entries = sumByKey(filtered, keyFor).sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));

  const top = entries
    .slice(0, TOP_BREAKDOWN_COUNT)
    .map(({ key, amount }) => ({ label: key, amount, pctOfTotal: pctOfTotal(amount) }));
  const rest = entries.slice(TOP_BREAKDOWN_COUNT);

  if (rest.length > 0) {
    const remainingAmount = rest.reduce((sum, entry) => sum + entry.amount, 0);
    top.push({ label: 'Remaining', amount: remainingAmount, pctOfTotal: pctOfTotal(remainingAmount) });
  }

  return top;
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
