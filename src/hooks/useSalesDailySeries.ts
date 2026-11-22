import { useQuery } from '@tanstack/react-query';

import { supabase } from '@/integrations/supabase/client';
import {
  parseSalesDailySeries,
  SalesPayloadError,
  type SalesDailySeriesData,
} from '@/lib/salesTrends';

/**
 * React Query hook for the `get_sales_daily_series` RPC. The POS Sales panel
 * uses it for the prior-period comparison. The RPC returns only `pos_systems`
 * and `by_day`.
 *
 * Design: docs/superpowers/specs/2026-11-22-sales-daily-series-rpc-design.md
 */

export interface UseSalesDailySeriesOptions {
  startDate?: string | null;
  endDate?: string | null;
  /** Gate the RPC, for example while the panel is collapsed. Defaults to true. */
  enabled?: boolean;
}

/** SQLSTATE `22023` (invalid_parameter_value): a NULL date. A retry cannot
 *  succeed, so the hook does not retry it. */
const INVALID_PARAMETER = '22023';

function shouldRetry(failureCount: number, error: unknown): boolean {
  // A bad payload shape fails the same way on every call.
  if (error instanceof SalesPayloadError) return false;
  const code = (error as { code?: unknown } | null)?.code;
  return failureCount < 1 && code !== INVALID_PARAMETER;
}

export function useSalesDailySeries(
  restaurantId: string | null,
  options: UseSalesDailySeriesOptions = {},
) {
  const { enabled = true } = options;
  // The RPC requires both dates. A blank string is the same as no date.
  const startDate = options.startDate || null;
  const endDate = options.endDate || null;

  return useQuery({
    queryKey: ['sales-daily-series', restaurantId, startDate, endDate],
    queryFn: async (): Promise<SalesDailySeriesData> => {
      const { data, error } = await supabase.rpc('get_sales_daily_series', {
        p_restaurant_id: restaurantId as string,
        p_start_date: startDate as string,
        p_end_date: endDate as string,
      });

      if (error) throw error;
      return parseSalesDailySeries(data);
    },
    enabled: enabled && !!restaurantId && !!startDate && !!endDate,
    staleTime: 60_000,
    retry: shouldRetry,
    refetchOnWindowFocus: true,
  });
}
