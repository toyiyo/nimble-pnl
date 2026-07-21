import { useQuery } from '@tanstack/react-query';

import { supabase } from '@/integrations/supabase/client';
import { parseSalesTrends, type SalesTrendsData } from '@/lib/salesTrends';

/**
 * React Query hook wrapping the `get_sales_trends` RPC.
 *
 * Design: docs/superpowers/specs/2026-07-20-pos-sales-trends-design.md §4.2
 *
 * `timeZone` follows the same default as `useHourlySalesPattern`
 * ('America/Chicago') when the caller omits it or passes an empty string —
 * callers are expected to pass `selectedRestaurant.timezone`, which can be
 * null/unset for older restaurants.
 */

const DEFAULT_TIME_ZONE = 'America/Chicago';

export interface UseSalesTrendsOptions {
  startDate?: string;
  endDate?: string;
  timeZone?: string;
}

export function useSalesTrends(restaurantId: string | null, options: UseSalesTrendsOptions = {}) {
  const { startDate, endDate, timeZone } = options;
  const resolvedTimeZone = timeZone || DEFAULT_TIME_ZONE;

  return useQuery({
    queryKey: ['sales-trends', restaurantId, startDate, endDate, resolvedTimeZone],
    queryFn: async (): Promise<SalesTrendsData> => {
      const { data, error } = await supabase.rpc('get_sales_trends', {
        p_restaurant_id: restaurantId as string,
        p_start_date: startDate,
        p_end_date: endDate,
        p_time_zone: resolvedTimeZone,
      });

      if (error) throw error;
      return parseSalesTrends(data);
    },
    enabled: !!restaurantId,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
}
