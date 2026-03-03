import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';

const COGS_SUBTYPES = ['food_cost', 'cost_of_goods_sold', 'beverage_cost', 'packaging_cost'];

export interface FinancialCOGSData {
  date: string;
  total_cost: number;
}

export interface FinancialCOGSResult {
  dailyCosts: FinancialCOGSData[];
  totalCost: number;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Query COGS from financial sources: bank transactions, split line items, and pending outflows.
 * Filters for chart-of-accounts subtypes that represent cost of goods sold.
 *
 * This is the "financials" counterpart to useFoodCosts (which reads from inventory_transactions).
 *
 * @param restaurantId - Restaurant ID to filter transactions
 * @param dateFrom - Start date for the period
 * @param dateTo - End date for the period
 * @returns COGS data aggregated by date
 */
export function useCOGSFromFinancials(
  restaurantId: string | null,
  dateFrom: Date,
  dateTo: Date
): FinancialCOGSResult {
  const startDateStr = format(dateFrom, 'yyyy-MM-dd');
  const endDateStr = format(dateTo, 'yyyy-MM-dd');

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['cogs-financials', restaurantId, startDateStr, endDateStr],
    queryFn: async () => {
      if (!restaurantId) return null;

      // ---------------------------------------------------------------
      // Source 1: Non-split bank transactions categorised as COGS
      // ---------------------------------------------------------------
      const { data: bankTxns, error: bankError } = await supabase
        .from('bank_transactions')
        .select(`
          id,
          transaction_date,
          amount,
          is_split,
          chart_of_accounts!category_id(account_subtype)
        `)
        .eq('restaurant_id', restaurantId)
        .in('status', ['posted', 'pending'])
        .eq('is_transfer', false)
        .eq('is_split', false)
        .lt('amount', 0)
        .gte('transaction_date', startDateStr)
        .lte('transaction_date', endDateStr)
        .limit(10000);

      if (bankError) throw bankError;

      // ---------------------------------------------------------------
      // Source 2: Split line items for split parent transactions
      // ---------------------------------------------------------------
      const { data: splitParents, error: splitParentError } = await supabase
        .from('bank_transactions')
        .select('id, transaction_date')
        .eq('restaurant_id', restaurantId)
        .eq('is_split', true)
        .in('status', ['posted', 'pending'])
        .eq('is_transfer', false)
        .gte('transaction_date', startDateStr)
        .lte('transaction_date', endDateStr)
        .limit(10000);

      if (splitParentError) throw splitParentError;

      let splitItems: Array<{
        transaction_id: string;
        amount: number;
        chart_of_accounts: { account_subtype?: string } | null;
      }> = [];

      const splitParentIds = (splitParents || []).map((p) => p.id);
      if (splitParentIds.length > 0) {
        const { data: splits, error: splitsError } = await supabase
          .from('bank_transaction_splits')
          .select('transaction_id, amount, chart_of_accounts!category_id(account_subtype)')
          .in('transaction_id', splitParentIds)
          .limit(10000);

        if (splitsError) throw splitsError;
        splitItems = (splits || []) as typeof splitItems;
      }

      // Build a lookup for split parent dates
      const parentDateMap = new Map<string, string>();
      (splitParents || []).forEach((p) => {
        parentDateMap.set(p.id, format(new Date(p.transaction_date), 'yyyy-MM-dd'));
      });

      // ---------------------------------------------------------------
      // Source 3: Pending outflows (unmatched) categorised as COGS
      // ---------------------------------------------------------------
      const { data: pendingTxns, error: pendingError } = await supabase
        .from('pending_outflows')
        .select('id, issue_date, amount, chart_of_accounts!category_id(account_subtype)')
        .eq('restaurant_id', restaurantId)
        .in('status', ['pending', 'stale_30', 'stale_60', 'stale_90'])
        .is('linked_bank_transaction_id', null)
        .gte('issue_date', startDateStr)
        .lte('issue_date', endDateStr)
        .limit(10000);

      if (pendingError) throw pendingError;

      // ---------------------------------------------------------------
      // Aggregate all sources by date
      // ---------------------------------------------------------------
      const dateMap = new Map<string, number>();

      // Source 1: Non-split bank transactions
      (bankTxns || []).forEach((txn) => {
        const account = txn.chart_of_accounts as { account_subtype?: string } | null;
        if (account?.account_subtype && COGS_SUBTYPES.includes(account.account_subtype)) {
          const date = format(new Date(txn.transaction_date), 'yyyy-MM-dd');
          const cost = Math.abs(txn.amount);
          dateMap.set(date, (dateMap.get(date) || 0) + cost);
        }
      });

      // Source 2: Split line items
      splitItems.forEach((split) => {
        const account = split.chart_of_accounts as { account_subtype?: string } | null;
        if (account?.account_subtype && COGS_SUBTYPES.includes(account.account_subtype)) {
          const date = parentDateMap.get(split.transaction_id);
          if (date) {
            const cost = Math.abs(split.amount);
            dateMap.set(date, (dateMap.get(date) || 0) + cost);
          }
        }
      });

      // Source 3: Pending outflows
      (pendingTxns || []).forEach((txn) => {
        const account = txn.chart_of_accounts as { account_subtype?: string } | null;
        if (account?.account_subtype && COGS_SUBTYPES.includes(account.account_subtype)) {
          const date = txn.issue_date;
          const cost = Math.abs(txn.amount);
          dateMap.set(date, (dateMap.get(date) || 0) + cost);
        }
      });

      // Convert to sorted array
      const dailyCosts: FinancialCOGSData[] = Array.from(dateMap.entries())
        .map(([date, total_cost]) => ({ date, total_cost }))
        .sort((a, b) => a.date.localeCompare(b.date));

      const totalCost = dailyCosts.reduce((sum, day) => sum + day.total_cost, 0);

      return { dailyCosts, totalCost };
    },
    enabled: !!restaurantId,
    staleTime: 30000,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });

  return {
    dailyCosts: data?.dailyCosts || [],
    totalCost: data?.totalCost || 0,
    isLoading,
    error: error as Error | null,
    refetch,
  };
}
