import { useQuery } from '@tanstack/react-query';

import { supabase } from '@/integrations/supabase/client';
import { localWindow } from '@/lib/localDateWindow';

/** The RPC's JSONB return shape (design §5.3). */
export interface LaborSalesAnalytics {
  daily: { sale_date: string; revenue: number }[];
  grid: { dow: number; hour: number; revenue: number }[];
  by_weekday: { dow: number; revenue: number }[];
  has_hourly: boolean;
}

/**
 * One-round-trip sales aggregate for the /labor page. Calls the
 * `get_labor_sales_analytics` RPC over the restaurant-local `weeks` window
 * (same window as `useSplhData` via the shared `localWindow` helper). Replaces
 * the client-side aggregation of ~23,700 raw rows per load. Callers are
 * expected to have already validated `tz` (e.g. via `safeTz`).
 */
export function useLaborSalesAnalytics(restaurantId: string | null, tz: string, weeks: number) {
  return useQuery({
    queryKey: ['labor-sales-analytics', restaurantId, tz, weeks],
    queryFn: async (): Promise<LaborSalesAnalytics> => {
      const { startStr, endStr } = localWindow(tz, weeks);
      const { data, error } = await supabase.rpc('get_labor_sales_analytics', {
        p_restaurant_id: restaurantId!,
        p_start_date: startStr,
        p_end_date: endStr,
        p_time_zone: tz,
      });
      if (error) throw error;
      return data as unknown as LaborSalesAnalytics;
    },
    enabled: !!restaurantId,
    staleTime: 60000,
    refetchOnWindowFocus: true,
  });
}
