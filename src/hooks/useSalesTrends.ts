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
  /** Gate the RPC so it only runs when the panel is actually visible. The
   *  `get_sales_trends` RPC does several grouped scans + a product sort, so
   *  fetching while the panel is collapsed (e.g. the default-collapsed mobile
   *  case) is wasted DB/network work. Defaults to true. React Query still
   *  serves cached data instantly on re-expand. */
  enabled?: boolean;
}

export function useSalesTrends(restaurantId: string | null, options: UseSalesTrendsOptions = {}) {
  const { startDate, endDate, timeZone, enabled = true } = options;
  const resolvedTimeZone = timeZone || DEFAULT_TIME_ZONE;
  // Blank strings (e.g. from a "Clear filters" control resetting date state
  // to "") must become undefined so PostgREST omits the RPC arg rather than
  // trying to coerce "" into a DATE, which fails instead of using the RPC's
  // NULL/default 90-day window.
  const resolvedStartDate = startDate || undefined;
  const resolvedEndDate = endDate || undefined;

  return useQuery({
    queryKey: ['sales-trends', restaurantId, resolvedStartDate, resolvedEndDate, resolvedTimeZone],
    queryFn: async (): Promise<SalesTrendsData> => {
      const { data, error } = await supabase.rpc('get_sales_trends', {
        p_restaurant_id: restaurantId as string,
        p_start_date: resolvedStartDate,
        p_end_date: resolvedEndDate,
        p_time_zone: resolvedTimeZone,
      });

      if (error) throw error;
      return parseSalesTrends(data);
    },
    enabled: enabled && !!restaurantId,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
}
