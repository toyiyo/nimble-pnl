import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';

export interface POSTipData {
  date: string;
  totalTipsCents: number;
  transactionCount: number;
  source: 'square' | 'clover' | 'toast' | 'shift4' | 'employee_tips';
}

/**
 * Hook to fetch and aggregate tips from employee_tips table
 */
export function usePOSTips(restaurantId: string | null, startDate: string, endDate: string) {
  return useQuery({
    queryKey: ['pos-tips', restaurantId, startDate, endDate],
    queryFn: async (): Promise<POSTipData[]> => {
      if (!restaurantId) return [];

      const { data, error } = await supabase
        .from('employee_tips')
        .select('recorded_at, tip_amount, tip_source')
        .eq('restaurant_id', restaurantId)
        .gte('recorded_at', startDate)
        .lte('recorded_at', endDate + 'T23:59:59')
        .order('recorded_at', { ascending: true });

      if (error) {
        console.error('Error fetching tips:', error);
        return [];
      }

      if (!data || data.length === 0) return [];

      // Aggregate tips by date
      const tipsByDate = new Map<string, { totalTipsCents: number; count: number; source: string }>();
      
      for (const tip of data) {
        const date = format(new Date(tip.recorded_at), 'yyyy-MM-dd');
        const existing = tipsByDate.get(date);
        
        if (existing) {
          existing.totalTipsCents += tip.tip_amount || 0;
          existing.count += 1;
        } else {
          tipsByDate.set(date, {
            totalTipsCents: tip.tip_amount || 0,
            count: 1,
            source: tip.tip_source || 'employee_tips',
          });
        }
      }

      // Convert to array
      const result: POSTipData[] = [];
      tipsByDate.forEach((value, date) => {
        result.push({
          date,
          totalTipsCents: value.totalTipsCents,
          transactionCount: value.count,
          source: 'employee_tips',
        });
      });

      return result.sort((a, b) => a.date.localeCompare(b.date));
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
