import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toDateOnlyString } from '@/lib/dateOnly';
import { aggregateFinancialCOGSByDate } from '@/services/cogsCalculations';
import { fetchFinancialCOGSRows } from '@/services/cogsFetch';
import { keepDataUnlessRestaurantChanged } from '@/lib/react-query-config';

export interface FinancialCOGSData {
  date: string;
  total_cost: number;
}

export interface FinancialCOGSResult {
  dailyCosts: FinancialCOGSData[];
  totalCost: number;
  capped: boolean;
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
// The query key for this hook's data. Export it so other hooks that need to
// watch this exact query (for example, an isFetching signal) build the same
// key instead of copying the literal string. Return fromStr and toStr beside
// the key, so a caller reads them by name instead of a tuple position.
export function cogsFinancialsKey(
  restaurantId: string | null,
  dateFrom: Date,
  dateTo: Date,
) {
  const fromStr = toDateOnlyString(dateFrom);
  const toStr = toDateOnlyString(dateTo);
  return {
    key: ['cogs-financials', restaurantId, fromStr, toStr] as const,
    fromStr,
    toStr,
  };
}

export function useCOGSFromFinancials(
  restaurantId: string | null,
  dateFrom: Date,
  dateTo: Date
): FinancialCOGSResult {
  const { key, fromStr, toStr } = cogsFinancialsKey(restaurantId, dateFrom, dateTo);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: key,
    queryFn: async () => {
      if (!restaurantId) return null;

      const { bankTxns, splitItems, parentDateMap, pendingTxns, capped } =
        await fetchFinancialCOGSRows(supabase, restaurantId, fromStr, toStr);

      const dateMap = aggregateFinancialCOGSByDate({ bankTxns, splitItems, parentDateMap, pendingTxns });

      const dailyCosts: FinancialCOGSData[] = Array.from(dateMap.entries())
        .map(([date, total_cost]) => ({ date, total_cost }))
        .sort((a, b) => a.date.localeCompare(b.date));

      const totalCost = dailyCosts.reduce((sum, day) => sum + day.total_cost, 0);

      return { dailyCosts, totalCost, capped };
    },
    enabled: !!restaurantId,
    staleTime: 30000,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
    placeholderData: keepDataUnlessRestaurantChanged(restaurantId),
  });

  return {
    dailyCosts: data?.dailyCosts || [],
    totalCost: data?.totalCost || 0,
    capped: data?.capped || false,
    isLoading,
    error,
    refetch: () => { void refetch(); },
  };
}
