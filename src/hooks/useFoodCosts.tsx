import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';

export interface FoodCostData {
  date: string;
  total_cost: number;
}

export interface FoodCostsResult {
  dailyCosts: FoodCostData[];
  totalCost: number;
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

      const { data, error } = await supabase
        .from('inventory_transactions')
        .select('created_at, total_cost, transaction_type')
        .eq('restaurant_id', restaurantId)
        .eq('transaction_type', 'usage')
        .gte('created_at', format(dateFrom, 'yyyy-MM-dd'))
        .lte('created_at', format(dateTo, 'yyyy-MM-dd') + 'T23:59:59.999Z')
        .order('created_at', { ascending: true });

      if (error) throw error;

      // Aggregate by date (convert timestamp to date)
      const dailyMap = new Map<string, number>();
      
      data?.forEach((transaction) => {
        const transactionDate = format(new Date(transaction.created_at), 'yyyy-MM-dd');
        // Use Math.abs() because inventory costs may be stored as negative values (accounting convention)
        // but profit calculations expect positive cost values
        const cost = Math.abs(transaction.total_cost || 0);
        dailyMap.set(transactionDate, (dailyMap.get(transactionDate) || 0) + cost);
      });

      const dailyCosts: FoodCostData[] = Array.from(dailyMap.entries())
        .map(([date, total_cost]) => ({ date, total_cost }))
        .sort((a, b) => a.date.localeCompare(b.date));

      const totalCost = dailyCosts.reduce((sum, day) => sum + day.total_cost, 0);

      return { dailyCosts, totalCost };
    },
    enabled: !!restaurantId,
    staleTime: 30000, // 30 seconds
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
