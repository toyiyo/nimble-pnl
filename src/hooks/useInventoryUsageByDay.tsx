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

// The query key for this hook's data. Export it so other hooks that need to
// watch this exact query (for example, an isFetching signal) build the same
// key instead of copying the literal string.
export function inventoryUsageByDayKey(
  restaurantId: string | null,
  dateFrom: Date,
  dateTo: Date,
) {
  return [
    'inventory-usage-by-day',
    restaurantId,
    toDateOnlyString(dateFrom),
    toDateOnlyString(dateTo),
  ] as const;
}

// Call the get_inventory_usage_by_day RPC and map the rows. Shared by this
// hook's queryFn and by useMonthlyMetrics, so both call sites stay in sync.
export async function fetchUsageByDay(
  restaurantId: string,
  fromStr: string,
  toStr: string,
): Promise<UsageByDayData> {
  const { data, error } = await supabase.rpc('get_inventory_usage_by_day', {
    p_restaurant_id: restaurantId,
    p_start_date: fromStr,
    p_end_date: toStr,
  });
  if (error) throw error;
  return mapUsageRows(data ?? []);
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
  const key = inventoryUsageByDayKey(restaurantId, dateFrom, dateTo);
  const [, , fromStr, toStr] = key;

  return useQuery({
    queryKey: key,
    queryFn: () => fetchUsageByDay(restaurantId!, fromStr, toStr),
    enabled: !!restaurantId,
    staleTime: 30000, // 30 seconds
    refetchOnWindowFocus: true,
    refetchOnMount: true,
    placeholderData: keepDataUnlessRestaurantChanged(restaurantId),
  });
}
