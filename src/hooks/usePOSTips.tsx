import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';

export interface POSTipData {
  date: string;
  totalTipsCents: number;
  transactionCount: number;
  source: 'square' | 'clover' | 'toast' | 'shift4' | 'employee_tips' | 'pos';
}

/**
 * Hook to fetch and aggregate tips from both employee_tips table and categorized POS sales
 */
export function usePOSTips(restaurantId: string | null, startDate: string, endDate: string) {
  return useQuery({
    queryKey: ['pos-tips', restaurantId, startDate, endDate],
    queryFn: async (): Promise<POSTipData[]> => {
      if (!restaurantId) return [];

      // Fetch employee-declared tips
      const { data: employeeTips, error: employeeError } = await supabase
        .from('employee_tips')
        .select('recorded_at, tip_amount, tip_source')
        .eq('restaurant_id', restaurantId)
        .gte('recorded_at', startDate)
        .lte('recorded_at', endDate + 'T23:59:59')
        .order('recorded_at', { ascending: true });

      if (employeeError) {
        console.error('Error fetching employee tips:', employeeError);
      }

      // Fetch categorized POS tips using the new aggregation function
      const { data: posTips, error: posError } = await supabase
        .rpc('get_pos_tips_by_date', {
          p_restaurant_id: restaurantId,
          p_start_date: startDate,
          p_end_date: endDate,
        });

      if (posError) {
        console.error('Error fetching POS tips:', posError);
      }

      // Aggregate tips by date
      const tipsByDate = new Map<string, { totalTipsCents: number; count: number; source: string }>();
      
      // Add employee-declared tips
      if (employeeTips && employeeTips.length > 0) {
        for (const tip of employeeTips) {
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
      }

      // Add categorized POS tips
      if (posTips && posTips.length > 0) {
        for (const tip of posTips) {
          const date = tip.tip_date;
          const existing = tipsByDate.get(date);
          
          if (existing) {
            existing.totalTipsCents += tip.total_amount_cents || 0;
            existing.count += tip.transaction_count || 0;
          } else {
            tipsByDate.set(date, {
              totalTipsCents: tip.total_amount_cents || 0,
              count: tip.transaction_count || 0,
              source: tip.pos_source || 'pos',
            });
          }
        }
      }

      // Convert to array
      const result: POSTipData[] = [];
      tipsByDate.forEach((value, date) => {
        result.push({
          date,
          totalTipsCents: value.totalTipsCents,
          transactionCount: value.count,
          source: value.source as any,
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
