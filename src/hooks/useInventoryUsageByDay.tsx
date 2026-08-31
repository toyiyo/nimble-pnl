import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toDateOnlyString } from '@/lib/dateOnly';
import { keepDataUnlessRestaurantChanged } from '@/lib/react-query-config';

export interface UsageDayRow {
  day: string;
  food_cost: number;
}

export interface UsageByDayData {
  dailyCosts: { date: string; total_cost: number }[];
  totalCost: number;
}

// Map the RPC rows to the shape the dashboard consumes. The RPC returns the
// rows ordered by day. Pure and exported for the unit test.
export function mapUsageRows(rows: UsageDayRow[]): UsageByDayData {
  const dailyCosts = rows.map((row) => ({
    date: row.day,
    total_cost: Number(row.food_cost),
  }));
  const totalCost = dailyCosts.reduce((sum, day) => sum + day.total_cost, 0);
  return { dailyCosts, totalCost };
}

/**
 * Per-day inventory usage cost from the get_inventory_usage_by_day RPC.
 * The database aggregates, so one request replaces the old page loop.
 */
export function useInventoryUsageByDay(
  restaurantId: string | null,
  dateFrom: Date,
  dateTo: Date
) {
  const fromStr = toDateOnlyString(dateFrom);
  const toStr = toDateOnlyString(dateTo);

  return useQuery({
    queryKey: ['inventory-usage-by-day', restaurantId, fromStr, toStr],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_inventory_usage_by_day', {
        p_restaurant_id: restaurantId!,
        p_start_date: fromStr,
        p_end_date: toStr,
      });
      if (error) throw error;
      return mapUsageRows((data ?? []) as UsageDayRow[]);
    },
    enabled: !!restaurantId,
    staleTime: 30000, // 30 seconds
    refetchOnWindowFocus: true,
    refetchOnMount: true,
    placeholderData: keepDataUnlessRestaurantChanged(restaurantId),
  });
}
