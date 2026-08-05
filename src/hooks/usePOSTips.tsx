import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useRestaurantClock } from '@/hooks/useRestaurantClock';
import { businessDayRangeToInstants } from '@/lib/restaurantClock';

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
  // employee_tips.recorded_at is a moment in time (case b) -- it must bucket
  // by the RESTAURANT's business day, the same day the pos-tips RPC already
  // uses, or the two sides of the merge below disagree on which day a tip
  // belongs to for any viewer/host ahead of the restaurant's timezone.
  const { tz, toBusinessDay } = useRestaurantClock();

  return useQuery({
    queryKey: ['pos-tips', restaurantId, startDate, endDate, tz],
    queryFn: async (): Promise<POSTipData[]> => {
      if (!restaurantId) return [];

      // startDate/endDate are restaurant-local calendar days; the bucketing
      // below already keys them off `tz` via toBusinessDay, so the fetch
      // window must be built from the same zone -- a bare 'YYYY-MM-DD' bound
      // parses against UTC in Postgres, disagreeing with the bucketing and
      // dropping or leaking tips at the edges of the range.
      const { start, end } = businessDayRangeToInstants(startDate, endDate, tz);

      const [employeeResult, posResult] = await Promise.all([
        supabase
          .from('employee_tips')
          .select('recorded_at, tip_amount, tip_source')
          .eq('restaurant_id', restaurantId)
          .gte('recorded_at', start.toISOString())
          .lte('recorded_at', end.toISOString())
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
        const date = toBusinessDay(tip.recorded_at);
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
  // date is already 'yyyy-MM-dd' — don't re-parse through new Date() which
  // shifts the date backward in US timezones (UTC midnight → previous local day)
  const { data: tips } = usePOSTips(restaurantId, date, date);

  return {
    tipData: tips?.[0] || null,
    hasTips: (tips?.[0]?.totalTipsCents || 0) > 0,
  };
}
