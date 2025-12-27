import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';

export interface POSTipData {
  date: string;
  totalTipsCents: number;
  transactionCount: number;
  source: 'square' | 'clover' | 'toast' | 'shift4' | 'unified';
}

/**
 * Hook to fetch and aggregate tips from POS sales
 * Note: Currently returns empty results as unified_sales doesn't have a tip column yet.
 * Tips can be derived from raw_data JSON if needed in the future.
 */
export function usePOSTips(restaurantId: string | null, startDate: string, endDate: string) {
  return useQuery({
    queryKey: ['pos-tips', restaurantId, startDate, endDate],
    queryFn: async (): Promise<POSTipData[]> => {
      if (!restaurantId) return [];

      // unified_sales doesn't have a tip_amount column yet
      // Return empty array - tips must be tracked separately or extracted from raw_data
      return [];
    },
    enabled: !!restaurantId && !!startDate && !!endDate,
    staleTime: 60000, // 1 minute
  });
}

/**
 * Hook to get tips for a specific date
 */
export function usePOSTipsForDate(restaurantId: string | null, date: string) {
  const formattedDate = format(new Date(date), 'yyyy-MM-dd');
  const { data: tips } = usePOSTips(restaurantId, formattedDate, formattedDate);
  
  return {
    tipData: tips?.[0] || null,
    hasTips: (tips?.[0]?.totalTipsCents || 0) > 0,
  };
}
