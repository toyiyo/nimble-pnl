import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { aggregateFinancialCOGSByDate } from '@/services/cogsCalculations';
import { fetchFinancialCOGSRows } from '@/services/cogsFetch';

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

      const { bankTxns, splitItems, parentDateMap, pendingTxns, capped } =
        await fetchFinancialCOGSRows(supabase, restaurantId, startDateStr, endDateStr);

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
