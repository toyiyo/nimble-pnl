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

  orderedKeys.sort((a, b) => a.localeCompare(b));
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

/** One node in `buildSankey`'s output. */
export interface SankeyNode {
  name: string;
}

/** One link in `buildSankey`'s output. `source`/`target` are node indexes. */
export interface SankeyLink {
  source: number;
  target: number;
  value: number;
}

/** Nodes and links for the Flow (Sankey) chart mode. */
export interface SankeyData {
  nodes: SankeyNode[];
  links: SankeyLink[];
}

const SANKEY_TOP_PAYEE_COUNT = 5;

/**
 * Build Sankey nodes and links for the Flow chart mode.
 * Left: top inflow payees plus `Transfers in`.
 * Center: `Money in`.
 * Right: top outflow payees plus `Transfers out` and `Net savings`.
 * The sum of left link values equals the sum of right link values.
 */
export function buildSankey(rows: CashFlowRow[]): SankeyData {
  const inflowRows = rows.filter((row) => row.amount >= 0 && !row.is_transfer);
  const outflowRows = rows.filter((row) => row.amount < 0 && !row.is_transfer);

  const transferInTotal = rows
    .filter((row) => row.amount >= 0 && row.is_transfer)
    .reduce((sum, row) => sum + row.amount, 0);
  const transferOutTotal = Math.abs(
    rows.filter((row) => row.amount < 0 && row.is_transfer).reduce((sum, row) => sum + row.amount, 0),
  );

  const inflowEntries = sumByKey(inflowRows, payeeFor).sort((a, b) => b.amount - a.amount);
  const outflowEntries = sumByKey(outflowRows, payeeFor)
    .map(({ key, amount }) => ({ key, amount: Math.abs(amount) }))
    .sort((a, b) => b.amount - a.amount);

  const topInflow = inflowEntries.slice(0, SANKEY_TOP_PAYEE_COUNT);
  const otherIncome = inflowEntries.slice(SANKEY_TOP_PAYEE_COUNT).reduce((sum, entry) => sum + entry.amount, 0);

  const topOutflow = outflowEntries.slice(0, SANKEY_TOP_PAYEE_COUNT);
  const otherExpenses = outflowEntries.slice(SANKEY_TOP_PAYEE_COUNT).reduce((sum, entry) => sum + entry.amount, 0);

  const nodes: SankeyNode[] = [];
  const links: SankeyLink[] = [];
  const addNode = (name: string): number => nodes.push({ name }) - 1;

  const centerIndex = addNode('Money in');

  for (const entry of topInflow) {
    links.push({ source: addNode(entry.key), target: centerIndex, value: entry.amount });
  }
  if (otherIncome > 0) {
    links.push({ source: addNode('Other income'), target: centerIndex, value: otherIncome });
  }
  if (transferInTotal > 0) {
    links.push({ source: addNode('Transfers in'), target: centerIndex, value: transferInTotal });
  }

  for (const entry of topOutflow) {
    links.push({ source: centerIndex, target: addNode(entry.key), value: entry.amount });
  }
  if (otherExpenses > 0) {
    links.push({ source: centerIndex, target: addNode('Other expenses'), value: otherExpenses });
  }
  if (transferOutTotal > 0) {
    links.push({ source: centerIndex, target: addNode('Transfers out'), value: transferOutTotal });
  }

  // Keep the diagram flow-conserving in a loss period too: a positive net
  // becomes a `Net savings` link out of the center; a negative net becomes
  // a `From savings` link into the center, so left and right totals match.
  const net = computeTotals(rows).net;
  if (net > 0) {
    links.push({ source: centerIndex, target: addNode('Net savings'), value: net });
  } else if (net < 0) {
    links.push({ source: addNode('From savings'), target: centerIndex, value: Math.abs(net) });
  }

  return { nodes, links };
}

/** One deterministic insight for the Narrative panel. */
export interface CashFlowInsight {
  id: string;
  title: string;
  body: string;
}

interface YearMonth {
  year: number;
  month: number; // 0-indexed
}

const SUBSCRIPTION_MIN_CHARGES = 3;
const SUBSCRIPTION_WINDOW_DAYS = 90;
const SUBSCRIPTION_CADENCE_MIN_DAYS = 25;
const SUBSCRIPTION_CADENCE_MAX_DAYS = 35;
const SUBSCRIPTION_VARIANCE_MAX = 0.1;
const TOP_SOURCE_DELTA_MIN = 0.2;
const PRECEDING_MONTH_COUNT = 3;

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Format a signed amount as whole-dollar USD, for insight text and the cashflow UI. */
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(
    amount,
  );
}

function monthKeyFromDateStr(dateStr: string): string {
  return dateStr.slice(0, 7);
}

function shiftMonth({ year, month }: YearMonth, delta: number): YearMonth {
  const total = year * 12 + month + delta;
  return { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 };
}

function monthKeyFromYearMonth({ year, month }: YearMonth): string {
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}

function monthLabel(ym: YearMonth): string {
  return `${MONTH_NAMES[ym.month]} ${ym.year}`;
}

/**
 * The most recent calendar month that has fully elapsed by `to`.
 * When `to` lands on the last day of its month, that month counts as full.
 */
function lastFullCalendarMonth(to: Date): YearMonth {
  const year = to.getFullYear();
  const month = to.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  if (to.getDate() === daysInMonth) return { year, month };
  return shiftMonth({ year, month }, -1);
}

/**
 * Count outflow payees that look like subscriptions: 3+ charges in the
 * trailing 90 days before `to`, a 25-35 day cadence between every charge,
 * and under 10% variance across their amounts.
 */
function countSubscriptionPayees(rows: CashFlowRow[], to: Date): number {
  const toMidnight = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  const windowStart = new Date(toMidnight);
  windowStart.setDate(windowStart.getDate() - SUBSCRIPTION_WINDOW_DAYS);

  const byPayee = new Map<string, { date: Date; amount: number }[]>();
  for (const row of rows) {
    if (row.is_transfer || row.amount >= 0) continue;
    const rowDate = parseDateKey(row.transaction_date);
    if (rowDate < windowStart || rowDate > toMidnight) continue;

    const key = payeeFor(row);
    const charges = byPayee.get(key) ?? [];
    charges.push({ date: rowDate, amount: Math.abs(row.amount) });
    byPayee.set(key, charges);
  }

  let count = 0;
  for (const charges of byPayee.values()) {
    if (charges.length < SUBSCRIPTION_MIN_CHARGES) continue;
    charges.sort((a, b) => a.date.getTime() - b.date.getTime());

    const cadenceOk = charges.every((charge, i) => {
      if (i === 0) return true;
      const gapDays = Math.round((charge.date.getTime() - charges[i - 1].date.getTime()) / MS_PER_DAY);
      return gapDays >= SUBSCRIPTION_CADENCE_MIN_DAYS && gapDays <= SUBSCRIPTION_CADENCE_MAX_DAYS;
    });
    if (!cadenceOk) continue;

    const amounts = charges.map((c) => c.amount);
    const mean = amounts.reduce((sum, a) => sum + a, 0) / amounts.length;
    const variance = mean === 0 ? 0 : (Math.max(...amounts) - Math.min(...amounts)) / mean;
    if (variance < SUBSCRIPTION_VARIANCE_MAX) count += 1;
  }

  return count;
}

/** Sum non-transfer money in for one calendar month (`YYYY-MM`). */
function monthlyRevenue(rows: CashFlowRow[], monthKey: string): number {
  return rows
    .filter((row) => !row.is_transfer && row.amount >= 0 && monthKeyFromDateStr(row.transaction_date) === monthKey)
    .reduce((sum, row) => sum + row.amount, 0);
}

function buildRevenueChangeInsight(
  rows: CashFlowRow[],
  lastFullMonth: YearMonth,
  lastMonthKey: string,
  precedingKeys: string[],
): CashFlowInsight | null {
  const lastMonthRevenue = monthlyRevenue(rows, lastMonthKey);
  const precedingMean =
    precedingKeys.reduce((sum, key) => sum + monthlyRevenue(rows, key), 0) / precedingKeys.length;
  if (precedingMean <= 0) return null;

  const delta = (lastMonthRevenue - precedingMean) / precedingMean;
  const direction = delta >= 0 ? 'increased' : 'decreased';

  return {
    id: 'revenue-change',
    title: `Revenue ${direction}`,
    body: `Money in for ${monthLabel(lastFullMonth)} was ${formatCurrency(lastMonthRevenue)}, versus an average of ${formatCurrency(precedingMean)} over the previous three months.`,
  };
}

function buildTopSourceInsight(
  rows: CashFlowRow[],
  lastMonthKey: string,
  precedingKeys: string[],
): CashFlowInsight | null {
  const lastMonthInflowRows = rows.filter(
    (row) => !row.is_transfer && row.amount >= 0 && monthKeyFromDateStr(row.transaction_date) === lastMonthKey,
  );
  if (lastMonthInflowRows.length === 0) return null;

  const [top] = sumByKey(lastMonthInflowRows, payeeFor).sort((a, b) => b.amount - a.amount);

  const precedingMean =
    precedingKeys.reduce((sum, key) => {
      const monthTotal = rows
        .filter(
          (row) =>
            !row.is_transfer &&
            row.amount >= 0 &&
            monthKeyFromDateStr(row.transaction_date) === key &&
            payeeFor(row) === top.key,
        )
        .reduce((s, row) => s + row.amount, 0);
      return sum + monthTotal;
    }, 0) / precedingKeys.length;
  if (precedingMean <= 0) return null;

  const delta = (top.amount - precedingMean) / precedingMean;
  if (Math.abs(delta) < TOP_SOURCE_DELTA_MIN) return null;

  const direction = delta >= 0 ? 'increased' : 'decreased';

  return {
    id: 'top-source-change',
    title: `${top.key} ${direction}`,
    body: `${top.key} brought in ${formatCurrency(top.amount)} last month, versus an average of ${formatCurrency(precedingMean)} over the previous three months.`,
  };
}

/**
 * Build the deterministic insight list for the Narrative panel.
 * Every time window anchors to `period.to`, never to the caller's clock,
 * so a historical period reads correctly. An insight that fails its data
 * threshold does not render; the caller shows a fallback line when the
 * list comes back empty.
 */
export function computeInsights(rows: CashFlowRow[], period: CashFlowPeriod): CashFlowInsight[] {
  const insights: CashFlowInsight[] = [];

  const subscriptionCount = countSubscriptionPayees(rows, period.to);
  if (subscriptionCount > 0) {
    const isSingleSubscription = subscriptionCount === 1;
    const title = isSingleSubscription ? '1 notable transaction' : `${subscriptionCount} notable transactions`;
    const body = isSingleSubscription
      ? 'We noticed 1 subscription you may want to review'
      : `We noticed ${subscriptionCount} subscriptions you may want to review`;
    insights.push({ id: 'subscriptions', title, body });
  }

  const lastFullMonth = lastFullCalendarMonth(period.to);
  const lastMonthKey = monthKeyFromYearMonth(lastFullMonth);
  const precedingKeys = Array.from({ length: PRECEDING_MONTH_COUNT }, (_, i) =>
    monthKeyFromYearMonth(shiftMonth(lastFullMonth, -(i + 1))),
  );

  const revenueInsight = buildRevenueChangeInsight(rows, lastFullMonth, lastMonthKey, precedingKeys);
  if (revenueInsight) insights.push(revenueInsight);

  const topSourceInsight = buildTopSourceInsight(rows, lastMonthKey, precedingKeys);
  if (topSourceInsight) insights.push(topSourceInsight);

  return insights;
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
