import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { aggregateInventoryCOGSByDate, type InventoryTransactionRow } from '@/services/cogsCalculations';
import { COGS_MAX_PAGES } from '@/services/cogsFetch';
import { fetchAllRows } from '@/utils/fetchAllRows';

export interface FoodCostData {
  date: string;
  total_cost: number;
}

export interface FoodCostsResult {
  dailyCosts: FoodCostData[];
  totalCost: number;
  capped: boolean;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Query food costs directly from inventory_transactions (source of truth).
 * Filters for 'usage' transaction type (cost of goods consumed/used).
 * 
 * @param restaurantId - Restaurant ID to filter transactions
 * @param dateFrom - Start date for the period
 * @param dateTo - End date for the period
 * @returns Food cost data aggregated by date
 */
export function useFoodCosts(
  restaurantId: string | null,
  dateFrom: Date,
  dateTo: Date
): FoodCostsResult {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['food-costs', restaurantId, format(dateFrom, 'yyyy-MM-dd'), format(dateTo, 'yyyy-MM-dd')],
    queryFn: async () => {
      if (!restaurantId) return null;

      const fromStr = format(dateFrom, 'yyyy-MM-dd');
      const toStr = format(dateTo, 'yyyy-MM-dd');

      // Page through inventory_transactions with fetchAllRows() to defeat
      // Supabase's default 1000-row cap on unpaginated responses.
      const { rows, capped } = await fetchAllRows<InventoryTransactionRow>(
        (from, to) =>
          supabase
            .from('inventory_transactions')
            .select('created_at, transaction_date, total_cost')
            .eq('restaurant_id', restaurantId)
            .eq('transaction_type', 'usage')
            .or(`transaction_date.gte.${fromStr},and(transaction_date.is.null,created_at.gte.${fromStr})`)
            .or(`transaction_date.lte.${toStr},and(transaction_date.is.null,created_at.lte.${toStr}T23:59:59.999Z)`)
            .order('created_at', { ascending: true })
            .order('id')
            .range(from, to),
        { maxPages: COGS_MAX_PAGES }
      );

      // Aggregate by date using shared pure helper (single source of truth).
      // Use transaction_date when present; fall back to created_at date part.
      // Math.abs() is applied inside the helper (costs may be stored as negatives).
      const dailyMap = aggregateInventoryCOGSByDate(rows);

      const dailyCosts: FoodCostData[] = Array.from(dailyMap.entries())
        .map(([date, total_cost]) => ({ date, total_cost }))
        .sort((a, b) => a.date.localeCompare(b.date));

      const totalCost = dailyCosts.reduce((sum, day) => sum + day.total_cost, 0);

      return { dailyCosts, totalCost, capped };
    },
    enabled: !!restaurantId,
    staleTime: 30000, // 30 seconds
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });

  return {
    dailyCosts: data?.dailyCosts || [],
    totalCost: data?.totalCost || 0,
    capped: data?.capped ?? false,
    isLoading,
    error: error as Error | null,
    refetch,
  };
}
