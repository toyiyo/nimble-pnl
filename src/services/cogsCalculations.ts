import { format } from 'date-fns';

/**
 * Canonical set of chart-of-accounts subtypes that represent Cost of Goods Sold.
 * Single source of truth — previously duplicated in useCOGSFromFinancials and useMonthlyMetrics.
 */
export const COGS_SUBTYPES = new Set([
  'food_cost',
  'cost_of_goods_sold',
  'beverage_cost',
  'packaging_cost',
]);

// ---------------------------------------------------------------------------
// Row-shape types (lowest-common-denominator of what each Supabase query returns)
// ---------------------------------------------------------------------------

export interface InventoryTransactionRow {
  created_at: string;
  transaction_date: string | null;
  total_cost: number;
}

export interface BankTransactionRow {
  transaction_date: string;
  amount: number;
  chart_of_accounts: { account_subtype?: string } | null;
}

export interface SplitItemRow {
  transaction_id: string;
  amount: number;
  chart_of_accounts: { account_subtype?: string } | null;
}

export interface PendingOutflowRow {
  issue_date: string;
  amount: number;
  chart_of_accounts: { account_subtype?: string } | null;
}

// ---------------------------------------------------------------------------
// aggregateInventoryCOGSByDate
// ---------------------------------------------------------------------------

/**
 * Given inventory_transaction rows (type='usage'), returns a Map keyed by
 * yyyy-MM-dd date strings → total cost in dollars (positive).
 *
 * Uses transaction_date when present; falls back to created_at date part.
 * Mirrors the logic in useFoodCosts.tsx:54-62.
 */
export function aggregateInventoryCOGSByDate(
  rows: InventoryTransactionRow[]
): Map<string, number> {
  const dailyMap = new Map<string, number>();

  for (const row of rows) {
    const dateKey = row.transaction_date
      ? row.transaction_date
      : format(new Date(row.created_at), 'yyyy-MM-dd');

    const cost = Math.abs(row.total_cost || 0);
    dailyMap.set(dateKey, (dailyMap.get(dateKey) || 0) + cost);
  }

  return dailyMap;
}

// ---------------------------------------------------------------------------
// aggregateFinancialCOGSByDate
// ---------------------------------------------------------------------------

export interface FinancialCOGSInputs {
  bankTxns: BankTransactionRow[];
  splitItems: SplitItemRow[];
  /** Map of split-parent transaction id → yyyy-MM-dd date string */
  parentDateMap: Map<string, string>;
  pendingTxns: PendingOutflowRow[];
}

/**
 * Given the three financial COGS sources, returns a Map keyed by
 * yyyy-MM-dd date strings → total cost in dollars (positive).
 *
 * Filters on COGS_SUBTYPES.has(account_subtype) for each source.
 * Mirrors the logic in useCOGSFromFinancials.tsx:127-157.
 *
 * NOTE: parentDateMap must contain yyyy-MM-dd day keys (not month keys).
 * The useMonthlyMetrics callsite must build day-keyed parent dates and
 * convert to months at the consumer boundary.
 */
export function aggregateFinancialCOGSByDate({
  bankTxns,
  splitItems,
  parentDateMap,
  pendingTxns,
}: FinancialCOGSInputs): Map<string, number> {
  const dateMap = new Map<string, number>();

  // Source 1: Non-split bank transactions
  for (const txn of bankTxns) {
    const account = txn.chart_of_accounts;
    if (account?.account_subtype && COGS_SUBTYPES.has(account.account_subtype)) {
      const date = format(new Date(txn.transaction_date), 'yyyy-MM-dd');
      const cost = Math.abs(txn.amount);
      dateMap.set(date, (dateMap.get(date) || 0) + cost);
    }
  }

  // Source 2: Split line items
  for (const split of splitItems) {
    const account = split.chart_of_accounts;
    if (account?.account_subtype && COGS_SUBTYPES.has(account.account_subtype)) {
      const date = parentDateMap.get(split.transaction_id);
      if (date) {
        const cost = Math.abs(split.amount);
        dateMap.set(date, (dateMap.get(date) || 0) + cost);
      }
    }
  }

  // Source 3: Pending outflows
  for (const txn of pendingTxns) {
    const account = txn.chart_of_accounts;
    if (account?.account_subtype && COGS_SUBTYPES.has(account.account_subtype)) {
      const date = txn.issue_date;
      const cost = Math.abs(txn.amount);
      dateMap.set(date, (dateMap.get(date) || 0) + cost);
    }
  }

  return dateMap;
}
