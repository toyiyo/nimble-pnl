import type { SupabaseClient } from '@supabase/supabase-js';

import {
  toUtcDayKey,
  type BankTransactionRow,
  type PendingOutflowRow,
  type SplitItemRow,
} from '@/services/cogsCalculations';
import { fetchAllRows } from '@/utils/fetchAllRows';

// COGS windows can exceed the default 20-page budget (a 90-day window held
// 31,813 inventory rows in production). 50 pages covers 50,000 rows.
export const COGS_MAX_PAGES = 50;

export interface FinancialCOGSRows {
  bankTxns: BankTransactionRow[];
  splitItems: SplitItemRow[];
  parentDateMap: Map<string, string>;
  pendingTxns: PendingOutflowRow[];
  capped: boolean;
}

interface SplitParentRow {
  id: string;
  transaction_date: string;
}

// One financial COGS fetch for useCOGSFromFinancials and useMonthlyMetrics.
// The `client` parameter stays on the untyped SupabaseClient generic so the
// fetchAllRows<T> generics type-check (see fetchMonthRevenueTotals).
export async function fetchFinancialCOGSRows(
  client: SupabaseClient,
  restaurantId: string,
  startDateStr: string,
  endDateStr: string
): Promise<FinancialCOGSRows> {
  // bank, parents, and pending are independent queries — run them together
  // instead of one round trip at a time. splits still waits on parents,
  // since it needs the parent ids.
  const [bank, parents, pending] = await Promise.all([
    fetchAllRows<BankTransactionRow>(
      (from, to) =>
        client
          .from('bank_transactions')
          .select('transaction_date, amount, chart_of_accounts!category_id(account_subtype)')
          .eq('restaurant_id', restaurantId)
          .in('status', ['posted', 'pending'])
          .eq('is_transfer', false)
          .eq('is_split', false)
          .lt('amount', 0)
          .gte('transaction_date', startDateStr)
          .lte('transaction_date', endDateStr)
          .order('transaction_date', { ascending: true })
          .order('id')
          // The untyped client infers the many-to-one join as an array.
          // PostgREST returns a single object — assert the declared row
          // type. A type-only cast, so test mocks need no extra method.
          .range(from, to) as unknown as PromiseLike<{
          data: BankTransactionRow[] | null;
          error: unknown;
        }>,
      { maxPages: COGS_MAX_PAGES }
    ),
    fetchAllRows<SplitParentRow>(
      (from, to) =>
        client
          .from('bank_transactions')
          .select('id, transaction_date')
          .eq('restaurant_id', restaurantId)
          .eq('is_split', true)
          .in('status', ['posted', 'pending'])
          .eq('is_transfer', false)
          .gte('transaction_date', startDateStr)
          .lte('transaction_date', endDateStr)
          .order('transaction_date', { ascending: true })
          .order('id')
          .range(from, to),
      { maxPages: COGS_MAX_PAGES }
    ),
    fetchAllRows<PendingOutflowRow>(
      (from, to) =>
        client
          .from('pending_outflows')
          .select('issue_date, amount, chart_of_accounts!category_id(account_subtype)')
          .eq('restaurant_id', restaurantId)
          .in('status', ['pending', 'stale_30', 'stale_60', 'stale_90'])
          .is('linked_bank_transaction_id', null)
          .gte('issue_date', startDateStr)
          .lte('issue_date', endDateStr)
          .order('issue_date', { ascending: true })
          .order('id')
          .range(from, to) as unknown as PromiseLike<{
          data: PendingOutflowRow[] | null;
          error: unknown;
        }>,
      { maxPages: COGS_MAX_PAGES }
    ),
  ]);

  const parentDateMap = new Map<string, string>();
  for (const parent of parents.rows) {
    parentDateMap.set(parent.id, toUtcDayKey(parent.transaction_date));
  }

  let splits: { rows: SplitItemRow[]; capped: boolean } = { rows: [], capped: false };
  if (parents.rows.length > 0) {
    const parentIds = parents.rows.map((parent) => parent.id);
    splits = await fetchAllRows<SplitItemRow>(
      (from, to) =>
        client
          .from('bank_transaction_splits')
          .select('transaction_id, amount, chart_of_accounts!category_id(account_subtype)')
          .in('transaction_id', parentIds)
          .order('id')
          .range(from, to) as unknown as PromiseLike<{
          data: SplitItemRow[] | null;
          error: unknown;
        }>,
      { maxPages: COGS_MAX_PAGES }
    );
  }

  return {
    bankTxns: bank.rows,
    splitItems: splits.rows,
    parentDateMap,
    pendingTxns: pending.rows,
    capped: bank.capped || parents.capped || splits.capped || pending.capped,
  };
}
