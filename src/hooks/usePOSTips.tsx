import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';

export interface POSTipData {
  date: string;
  totalTipsCents: number;
  transactionCount: number;
  source: 'square' | 'clover' | 'toast' | 'shift4' | 'employee_tips' | 'pos' | 'combined';
}

interface TipBucket {
  totalTipsCents: number;
  count: number;
  source: POSTipData['source'];
}

function mergeTip(
  map: Map<string, TipBucket>,
  date: string,
  amountCents: number,
  count: number,
  source: POSTipData['source'],
): void {
  const existing = map.get(date);
  if (existing) {
    existing.totalTipsCents += amountCents;
    existing.count += count;
    if (existing.source !== source) {
      existing.source = 'combined';
    }
  } else {
    map.set(date, { totalTipsCents: amountCents, count, source });
  }
}

export function usePOSTips(restaurantId: string | null, startDate: string, endDate: string) {
  return useQuery({
    queryKey: ['pos-tips', restaurantId, startDate, endDate],
    queryFn: async (): Promise<POSTipData[]> => {
      if (!restaurantId) return [];

      const [employeeResult, posResult] = await Promise.all([
        supabase
          .from('employee_tips')
          .select('recorded_at, tip_amount, tip_source')
          .eq('restaurant_id', restaurantId)
          .gte('recorded_at', startDate)
          .lte('recorded_at', endDate + 'T23:59:59')
          .order('recorded_at', { ascending: true }),
        (supabase.rpc as any)('get_pos_tips_by_date', {
          p_restaurant_id: restaurantId,
          p_start_date: startDate,
          p_end_date: endDate,
        }),
      ]);

      if (employeeResult.error) {
        console.error('Error fetching employee tips:', employeeResult.error);
      }
      if (posResult.error) {
        console.error('Error fetching POS tips:', posResult.error);
      }

      const tipsByDate = new Map<string, TipBucket>();

      for (const tip of employeeResult.data ?? []) {
        const date = format(new Date(tip.recorded_at), 'yyyy-MM-dd');
        const source = (tip.tip_source || 'employee_tips') as POSTipData['source'];
        mergeTip(tipsByDate, date, tip.tip_amount || 0, 1, source);
      }

      for (const tip of (posResult.data ?? []) as any[]) {
        const source = (tip.pos_source || 'pos') as POSTipData['source'];
        mergeTip(tipsByDate, tip.tip_date, tip.total_amount_cents || 0, tip.transaction_count || 0, source);
      }

      return Array.from(tipsByDate, ([date, bucket]) => ({
        date,
        totalTipsCents: bucket.totalTipsCents,
        transactionCount: bucket.count,
        source: bucket.source,
      })).sort((a, b) => a.date.localeCompare(b.date));
    },
    enabled: !!restaurantId && !!startDate && !!endDate,
    staleTime: 60000,
  });
}

export function usePOSTipsForDate(restaurantId: string | null, date: string) {
  const formattedDate = format(new Date(date), 'yyyy-MM-dd');
  const { data: tips } = usePOSTips(restaurantId, formattedDate, formattedDate);

  return {
    tipData: tips?.[0] || null,
    hasTips: (tips?.[0]?.totalTipsCents || 0) > 0,
  };
}
