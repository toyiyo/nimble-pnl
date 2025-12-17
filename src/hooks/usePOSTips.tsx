import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';

export interface POSTipData {
  date: string;
  totalTipsCents: number;
  transactionCount: number;
  source: 'square' | 'clover' | 'toast' | 'shift4' | 'unified';
}

/**
 * Hook to fetch and aggregate tips from POS sales
 * Queries unified_sales for tip amounts and groups by date
 */
export function usePOSTips(restaurantId: string | null, startDate: string, endDate: string) {
  return useQuery({
    queryKey: ['pos-tips', restaurantId, startDate, endDate],
    queryFn: async () => {
      if (!restaurantId) return [];

      // Query unified_sales for tips
      const { data, error } = await supabase
        .from('unified_sales')
        .select('sale_date, tip_amount, source')
        .eq('restaurant_id', restaurantId)
        .gte('sale_date', startDate)
        .lte('sale_date', endDate)
        .gt('tip_amount', 0) // Only sales with tips
        .order('sale_date', { ascending: false });

      if (error) throw error;

      // Group by date
      const tipsByDate = new Map<string, POSTipData>();

      data?.forEach((sale) => {
        const dateKey = sale.sale_date;
        
        if (!tipsByDate.has(dateKey)) {
          tipsByDate.set(dateKey, {
            date: dateKey,
            totalTipsCents: 0,
            transactionCount: 0,
            source: sale.source as any,
          });
        }

        const dayData = tipsByDate.get(dateKey)!;
        dayData.totalTipsCents += sale.tip_amount;
        dayData.transactionCount += 1;
      });

      return Array.from(tipsByDate.values()).sort((a, b) => 
        b.date.localeCompare(a.date)
      );
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
