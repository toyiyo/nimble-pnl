import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fromZonedTime } from 'date-fns-tz';

import { supabase } from '@/integrations/supabase/client';
import { useEmployees } from '@/hooks/useEmployees';
import { useNowTick } from '@/hooks/useNowTick';
import { buildIntradayFinancialSeries } from '@/lib/laborPnlAnalytics';
import type { FinancialPoint } from '@/lib/laborPnlAnalytics';
import { computeAvgHourlyRateCents } from '@/lib/staffingCalculator';
import { normalizePunches, identifyWorkSessions } from '@/utils/timePunchProcessing';
import { appendOpenShiftClockOuts } from '@/utils/openShiftPunches';
import { lookaheadPunchFetchRange } from '@/utils/punchWindow';
import { getTodayInTimezone } from '@/lib/timezone';
import type { SplhSaleRow } from '@/lib/splhAnalytics';
import type { TimePunch } from '@/types/timeTracking';

/** Current hour (0..23) in `tz`. Used only to cap "today" at the current hour. */
function currentHourInTz(tz: string): number {
  const value = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', hour12: false })
    .formatToParts(new Date())
    .find((p) => p.type === 'hour')?.value;
  return value ? Number(value) % 24 : 23;
}

interface IntradayData {
  sales: SplhSaleRow[];
  punches: TimePunch[];
}

/**
 * Lazy single-day fetch for the /labor Day view's intraday chart (design §9).
 * Fetches one restaurant-local day of sales + punches only when `enabled`
 * (the range is a single day) and returns the hour-of-day financial series via
 * `buildIntradayFinancialSeries` — an average-rate SHAPE estimate, not
 * payroll-grade (the KPI row still uses the day's payroll-grade total). One day
 * is ~200 rows, so no pagination is needed.
 */
export function useLaborIntradaySeries(
  restaurantId: string | null,
  tz: string,
  dateStr: string,
  targetPct: number,
  enabled: boolean,
): { series: FinancialPoint[]; isLoading: boolean; isError: boolean; error: Error | null } {
  const { employees } = useEmployees(restaurantId, { status: 'all' });
  const avgHourlyRateCents = useMemo(() => computeAvgHourlyRateCents(employees), [employees]);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['labor-intraday', restaurantId, tz, dateStr],
    queryFn: async (): Promise<IntradayData> => {
      const dayStart = fromZonedTime(`${dateStr}T00:00:00`, tz);
      const dayEnd = fromZonedTime(`${dateStr}T23:59:59.999`, tz);
      const { fetchStart, fetchEnd } = lookaheadPunchFetchRange(dayStart, dayEnd);

      const [salesRes, punchesRes] = await Promise.all([
        supabase
          .from('unified_sales')
          .select('sale_date, sale_time, sold_at, total_price')
          .eq('restaurant_id', restaurantId!)
          .eq('item_type', 'sale')
          .is('parent_sale_id', null)
          .is('adjustment_type', null)
          .eq('sale_date', dateStr),
        supabase
          .from('time_punches')
          .select('id, restaurant_id, employee_id, punch_type, punch_time')
          .eq('restaurant_id', restaurantId!)
          .gte('punch_time', fetchStart.toISOString())
          .lte('punch_time', fetchEnd.toISOString())
          .order('employee_id')
          .order('punch_time'),
      ]);
      if (salesRes.error) throw salesRes.error;
      if (punchesRes.error) throw punchesRes.error;
      return {
        sales: (salesRes.data ?? []) as unknown as SplhSaleRow[],
        punches: (punchesRes.data ?? []) as unknown as TimePunch[],
      };
    },
    enabled: enabled && !!restaurantId,
    staleTime: 60000,
    refetchOnWindowFocus: true,
  });

  // Close still-open shifts at "now" before deriving sessions, so the chart's
  // in-progress hours keep advancing while a shift stays open. `nowMs` (a
  // minute ticker) is a real dependency: React Query's structural sharing
  // keeps `data.punches` reference-stable across content-identical refetches,
  // so a memo keyed only on the punches would freeze the synthetic clock-out
  // at first compute and the chart's labor line would collapse mid-shift.
  const nowMs = useNowTick();
  const series = useMemo(() => {
    if (!data) return [];
    const sessions = identifyWorkSessions(
      normalizePunches(appendOpenShiftClockOuts(data.punches, new Date(nowMs))),
    );
    const capHour = dateStr === getTodayInTimezone(tz) ? currentHourInTz(tz) : undefined;
    return buildIntradayFinancialSeries(data.sales, sessions, tz, dateStr, avgHourlyRateCents, targetPct, capHour);
  }, [data, dateStr, tz, avgHourlyRateCents, targetPct, nowMs]);

  return {
    series,
    isLoading: enabled ? isLoading : false,
    isError: enabled ? isError : false,
    error: enabled ? (error as Error | null) : null,
  };
}
